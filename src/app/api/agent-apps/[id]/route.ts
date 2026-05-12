import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { uploadFileToGitea, deleteFileFromGitea, isGiteaConfigured, getGiteaRepoUrl, GiteaAuthError } from '@/lib/gitea';
import AdmZip from 'adm-zip';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function extractAndUploadArchive(appId: string, fileBuffer: Buffer, archiveName: string): Promise<string | null> {
  try {
    const zip = new AdmZip(fileBuffer);
    const zipEntries = zip.getEntries();
    
    console.log(`[agent-apps PUT] 解压 ${archiveName}, 共 ${zipEntries.length} 个文件`);
    
    const filesToUpload: Array<{ name: string; content: Buffer }> = [];
    
    for (const entry of zipEntries) {
      if (!entry.isDirectory) {
        filesToUpload.push({
          name: entry.entryName,
          content: entry.getData(),
        });
      }
    }
    
    console.log(`[agent-apps PUT] 开始并行上传 ${filesToUpload.length} 个文件...`);
    
    const uploadPromises = filesToUpload.map(async (file) => {
      try {
        const result = await uploadFileToGitea(appId, file.name, file.content);
        console.log(`[agent-apps PUT] 上传成功: ${file.name}`);
        return { success: true, name: file.name };
      } catch (uploadError) {
        console.error(`[agent-apps PUT] 上传失败 ${file.name}:`, uploadError);
        throw uploadError;
      }
    });
    
    const results = await Promise.all(uploadPromises);
    const successCount = results.filter(r => r.success).length;
    
    console.log(`[agent-apps PUT] 解压上传完成，成功上传 ${successCount}/${filesToUpload.length} 个文件`);
    return `${getGiteaRepoUrl()}/src/branch/main/${appId}`;
  } catch (extractError) {
    console.error('[agent-apps PUT] 解压失败:', extractError);
    throw extractError;
  }
}

export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    console.log('[agent-apps PUT] Auth failed:', auth.error);
    return authErrorResponse(auth);
  }

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const params = await context.params;
    const appId = params.id;

    let name: string;
    let engine: string;
    let startCommand: string | null;
    let notes: string | null;
    let updateFiles = false;
    let fileType: string | null = null;
    let agentHarnessFile: File | null = null;
    let filesJson: string | null = null;
    let formData: FormData | null = null;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json();
      name = body.name;
      engine = body.engine;
      startCommand = body.startCommand || null;
      notes = body.notes || null;
    } else if (contentType.includes('multipart/form-data')) {
      formData = await request.formData();
      name = formData.get('name') as string;
      engine = formData.get('engine') as string;
      startCommand = formData.get('startCommand') as string | null;
      notes = formData.get('notes') as string | null;
      fileType = formData.get('agentHarnessFileType') as string | null;
      agentHarnessFile = formData.get('agentHarnessFile') as File | null;
      filesJson = formData.get('filesJson') as string | null;
      updateFiles = agentHarnessFile !== null && agentHarnessFile.size > 0;
    } else {
      return NextResponse.json({ error: '不支持的 Content-Type' }, { status: 400 });
    }

    console.log('[agent-apps PUT] Update request:', { appId, name, engine, startCommand, notes, updateFiles, fileType });

    if (!name || !engine) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const whereCondition: Record<string, unknown> = { id: appId };
    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      // 平台管理员和 ICS 租户可操作任何应用
    } else {
      // 普通租户用户：必须是自己创建的应用
      whereCondition.userId = payload.userId;
    }

    const existing = await prisma.agentApp.findFirst({
      where: whereCondition,
    });

    if (!existing) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 });
    }

    let agentHarnessPath = existing.agentHarnessPath;
    let giteaUploaded = false;

    if (updateFiles && isGiteaConfigured()) {
      try {
        if (fileType === 'archive' && agentHarnessFile && formData) {
          const fileBuffer = Buffer.from(await agentHarnessFile.arrayBuffer());
          const fileName = agentHarnessFile.name;
          
          const result = await extractAndUploadArchive(appId, fileBuffer, fileName);
          if (result) {
            agentHarnessPath = result;
            giteaUploaded = true;
            console.log('[agent-apps PUT] Gitea 解压上传成功:', result);
          }
        } else if (fileType === 'folder' && filesJson && formData) {
          const filesInfo = JSON.parse(filesJson);
          
          for (const info of filesInfo) {
            const file = formData.get(info.key) as File;
            if (file) {
              const fileBuffer = Buffer.from(await file.arrayBuffer());
              const relativePath = info.relativePath.replace(/^[^\/]+\//, '');
              
              try {
                const result = await uploadFileToGitea(appId, relativePath, fileBuffer);
                if (result) {
                  console.log(`[agent-apps PUT] Gitea 文件更新: ${relativePath}`);
                  giteaUploaded = true;
                }
              } catch (uploadError) {
                console.error(`[agent-apps PUT] Gitea 更新失败:`, uploadError);
                throw uploadError;
              }
            }
          }

          agentHarnessPath = `${getGiteaRepoUrl()}/src/branch/main/${appId}`;
        }
      } catch (giteaError) {
        console.error('[agent-apps PUT] Gitea 更新失败:', giteaError);
        
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

    const app = await prisma.agentApp.update({
      where: { id: appId },
      data: {
        name,
        engine,
        startCommand: startCommand || null,
        notes: notes || null,
        agentHarnessPath,
        updatedAt: new Date(),
      },
    });

    console.log('[agent-apps PUT] Updated app:', app);
    return NextResponse.json({ app, giteaUploaded });
  } catch (error) {
    console.error('更新应用失败:', error);
    return NextResponse.json({ error: '更新应用失败', details: error instanceof Error ? error.message : 'Unknown' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    console.log('[agent-apps DELETE] Auth failed:', auth.error);
    return authErrorResponse(auth);
  }

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const params = await context.params;
    const appId = params.id;

    console.log('[agent-apps DELETE] Delete request:', { appId, userId: payload.userId });

    const whereCondition: Record<string, unknown> = { id: appId };
    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      // 平台管理员和 ICS 租户可操作任何应用
    } else {
      // 普通租户用户：必须是自己创建的应用（不能删除 public 资源）
      whereCondition.userId = payload.userId;
      whereCondition.isPublic = false;  // 防止普通租户删除公共资源
    }

    const existing = await prisma.agentApp.findFirst({
      where: whereCondition,
    });

    if (!existing) {
      return NextResponse.json({ error: '应用不存在或无权限删除公共资源' }, { status: 404 });
    }

    if (isGiteaConfigured()) {
      try {
        await deleteFileFromGitea(appId);
        console.log('[agent-apps DELETE] Gitea 文件已删除');
      } catch (giteaError) {
        console.error('[agent-apps DELETE] Gitea 删除失败:', giteaError);
      }
    }

    await prisma.agentApp.delete({
      where: { id: appId },
    });

    console.log('[agent-apps DELETE] Deleted app:', appId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除应用失败:', error);
    return NextResponse.json({ error: '删除应用失败', details: error instanceof Error ? error.message : 'Unknown' }, { status: 500 });
  }
}