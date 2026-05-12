import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { buildTenantFilter, getTenantIdForCreate } from '@/lib/tenant-filter';
import { prisma } from '@/lib/prisma';
import { uploadFileToGitea, isGiteaConfigured, getGiteaRepoUrl, GiteaAuthError } from '@/lib/gitea';
import AdmZip from 'adm-zip';

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  console.log('[agent-apps GET] Auth info:', { 
    userId: payload.userId, 
    tenantId: payload.tenantId,
    isPlatformAdmin: tenant?.isPlatformAdmin,
    isIcsTenant: tenant?.isIcsTenant 
  });

  try {
    let apps;
    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      console.log('[agent-apps GET] Fetching all apps (admin)');
      apps = await prisma.agentApp.findMany({
        orderBy: { createdAt: 'desc' },
      });
    } else {
      console.log('[agent-apps GET] Fetching filtered apps');
      const filter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        isPublicField: 'isPublic',
      });
      apps = await prisma.agentApp.findMany({
        where: {
          OR: [{ ...filter }, { userId: payload.userId }],
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    console.log('[agent-apps GET] Found apps:', apps?.length);
    return NextResponse.json({ apps });
  } catch (error) {
    console.error('获取应用列表失败:', error);
    return NextResponse.json({ error: '获取应用列表失败', details: error instanceof Error ? error.message : 'Unknown' }, { status: 500 });
  }
}

async function extractAndUploadArchive(appId: string, fileBuffer: Buffer, archiveName: string): Promise<string | null> {
  try {
    const zip = new AdmZip(fileBuffer);
    const zipEntries = zip.getEntries();
    
    console.log(`[agent-apps] 解压 ${archiveName}, 共 ${zipEntries.length} 个文件`);
    
    const filesToUpload: Array<{ name: string; content: Buffer }> = [];
    
    for (const entry of zipEntries) {
      if (!entry.isDirectory) {
        filesToUpload.push({
          name: entry.entryName,
          content: entry.getData(),
        });
      }
    }
    
    console.log(`[agent-apps] 开始串行上传 ${filesToUpload.length} 个文件 (避免 Gitea push reject)...`);
    
    let successCount = 0;
    for (const file of filesToUpload) {
      try {
        await uploadFileToGitea(appId, file.name, file.content);
        console.log(`[agent-apps] 上传成功: ${file.name}`);
        successCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (uploadError) {
        console.error(`[agent-apps] 上传失败 ${file.name}:`, uploadError);
        throw uploadError;
      }
    }
    
    console.log(`[agent-apps] 解压上传完成，成功上传 ${successCount}/${filesToUpload.length} 个文件`);
    return `${getGiteaRepoUrl()}/src/branch/main/${appId}`;
  } catch (extractError) {
    console.error('[agent-apps] 解压失败:', extractError);
    throw extractError;
  }
}

export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const formData = await request.formData();

    console.log('[agent-apps POST] FormData entries:');
    for (const [key, value] of formData.entries()) {
      console.log(`  ${key}:`, value instanceof File ? `File(${value.name}, ${value.size} bytes)` : value);
    }

    const name = formData.get('name') as string;
    const engine = formData.get('engine') as string;
    const defaultAgentName = formData.get('defaultAgentName') as string;
    const startCommand = formData.get('startCommand') as string | null;
    const notes = formData.get('notes') as string | null;
    const isPublic = formData.get('isPublic') === 'true';
    const fileType = formData.get('agentHarnessFileType') as string | null;
    const agentHarnessFile = formData.get('agentHarnessFile') as File | null;
    const filesJson = formData.get('filesJson') as string | null;

    console.log('[agent-apps POST] Extracted fields:', { name, engine, defaultAgentName, startCommand, notes, isPublic, fileType });

    if (!name || !engine || !defaultAgentName) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    if (!agentHarnessFile) {
      return NextResponse.json({ error: '请上传 AgentHarness 文件' }, { status: 400 });
    }

    if (isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
      return NextResponse.json(
        { error: '只有 ICSL 租户可以创建公共资源' },
        { status: 403 }
      );
    }

    const tenantId = getTenantIdForCreate(tenant, isPublic);
    const appId = crypto.randomUUID();

    let agentHarnessPath = `/agent-apps/${appId}/agent-harness`;
    let giteaUploaded = false;

    if (isGiteaConfigured()) {
      try {
        if (fileType === 'archive' && agentHarnessFile && agentHarnessFile.size > 0) {
          const fileBuffer = Buffer.from(await agentHarnessFile.arrayBuffer());
          const fileName = agentHarnessFile.name;
          
          const result = await extractAndUploadArchive(appId, fileBuffer, fileName);
          if (result) {
            agentHarnessPath = result;
            giteaUploaded = true;
            console.log('[agent-apps POST] Gitea 解压上传成功:', result);
          }
        } else if (fileType === 'folder' && filesJson) {
          const filesInfo: { key: string; relativePath: string }[] = JSON.parse(filesJson);

          const uploadPromises = filesInfo.map(async (info) => {
            const file = formData.get(info.key) as File;
            if (file) {
              const fileBuffer = Buffer.from(await file.arrayBuffer());
              const relativePath = info.relativePath.replace(/^[^\/]+\//, '');
              
              try {
                const result = await uploadFileToGitea(appId, relativePath, fileBuffer);
                if (result) {
                  console.log(`[agent-apps POST] Gitea 文件上传: ${relativePath}`);
                  return { success: true, name: relativePath };
                }
              } catch (uploadError) {
                console.error(`[agent-apps POST] Gitea 上传失败 ${relativePath}:`, uploadError);
                throw uploadError;
              }
            }
            return { success: false };
          });
          
          const results = await Promise.all(uploadPromises);
          if (results.some(r => r.success)) {
            giteaUploaded = true;
          }

          agentHarnessPath = `${getGiteaRepoUrl()}/src/branch/main/${appId}`;
        }
      } catch (giteaError) {
        console.error('[agent-apps POST] Gitea 上传失败:', giteaError);
        
        if (giteaError instanceof GiteaAuthError) {
          return NextResponse.json({ 
            error: 'Gitea 认证失败', 
            details: 'GITEA_TOKEN 无效或权限不足，请检查 Gitea 配置。需要具有 repo 写权限的 Access Token。'
          }, { status: 401 });
        }
        
        return NextResponse.json({ 
          error: 'Gitea 上传失败', 
          details: giteaError instanceof Error ? giteaError.message : 'Unknown error'
        }, { status: 500 });
      }
    }

    const app = await prisma.agentApp.create({
      data: {
        id: appId,
        userId: payload.userId,
        name,
        engine,
        agentHarnessPath,
        defaultAgentName,
        startCommand: startCommand || null,
        notes: notes || null,
        status: 'active',
        tenantId,
        isPublic,
        updatedAt: new Date(),
      },
    });

    console.log('[agent-apps POST] Created app:', app);
    return NextResponse.json({ app, giteaUploaded });
  } catch (error) {
    console.error('创建应用失败:', error);
    return NextResponse.json({ error: '创建应用失败', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
