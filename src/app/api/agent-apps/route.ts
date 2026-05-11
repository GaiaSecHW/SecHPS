import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { buildTenantFilter, getTenantIdForCreate } from '@/lib/tenant-filter';
import { prisma } from '@/lib/prisma';
import { uploadFileToGitea, isGiteaConfigured, getGiteaRepoUrl } from '@/lib/gitea';
import AdmZip from 'adm-zip';

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    let apps;
    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      apps = await prisma.agentApp.findMany({
        orderBy: { createdAt: 'desc' },
      });
    } else {
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

    return NextResponse.json({ apps });
  } catch (error) {
    console.error('获取应用列表失败:', error);
    return NextResponse.json({ error: '获取应用列表失败' }, { status: 500 });
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
    
    console.log(`[agent-apps] 开始并行上传 ${filesToUpload.length} 个文件...`);
    
    const uploadPromises = filesToUpload.map(async (file) => {
      try {
        const result = await uploadFileToGitea(appId, file.name, file.content);
        console.log(`[agent-apps] 上传成功: ${file.name}`);
        return { success: true, name: file.name };
      } catch (uploadError) {
        console.error(`[agent-apps] 上传失败 ${file.name}:`, uploadError);
        return { success: false, name: file.name };
      }
    });
    
    const results = await Promise.all(uploadPromises);
    const successCount = results.filter(r => r.success).length;
    
    console.log(`[agent-apps] 解压上传完成，成功上传 ${successCount}/${filesToUpload.length} 个文件`);
    return `${getGiteaRepoUrl()}/src/branch/main/${appId}`;
  } catch (extractError) {
    console.error('[agent-apps] 解压失败:', extractError);
    return null;
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
    const startCommand = formData.get('startCommand') as string | null;
    const notes = formData.get('notes') as string | null;
    const isPublic = formData.get('isPublic') === 'true';
    const fileType = formData.get('agentHarnessFileType') as string | null;
    const agentHarnessFile = formData.get('agentHarnessFile') as File | null;
    const filesJson = formData.get('filesJson') as string | null;

    console.log('[agent-apps POST] Extracted fields:', { name, engine, startCommand, notes, isPublic, fileType });

    if (!name || !engine) {
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
          const filesInfo = JSON.parse(filesJson);
          
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
      }
    }

    const app = await prisma.agentApp.create({
      data: {
        id: appId,
        userId: payload.userId,
        name,
        engine,
        agentHarnessPath,
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
