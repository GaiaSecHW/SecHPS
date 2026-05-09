import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { uploadFileToGitea, deleteFileFromGitea, isGiteaConfigured, getGiteaRepoUrl } from '@/lib/gitea';
import AdmZip from 'adm-zip';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function extractAndUploadArchive(appId: string, fileBuffer: Buffer, archiveName: string): Promise<string | null> {
  try {
    const zip = new AdmZip(fileBuffer);
    const zipEntries = zip.getEntries();
    
    console.log(`[agent-apps PUT] 解压 ${archiveName}, 共 ${zipEntries.length} 个文件`);
    
    const uploadedFiles: string[] = [];
    
    for (const entry of zipEntries) {
      if (!entry.isDirectory) {
        const entryName = entry.entryName;
        const content = entry.getData();
        
        try {
          const result = await uploadFileToGitea(appId, entryName, content);
          if (result) {
            uploadedFiles.push(entryName);
            console.log(`[agent-apps PUT] 上传文件: ${entryName}`);
          }
        } catch (uploadError) {
          console.error(`[agent-apps PUT] 上传失败 ${entryName}:`, uploadError);
        }
      }
    }
    
    console.log(`[agent-apps PUT] 解压上传完成，共上传 ${uploadedFiles.length} 个文件`);
    return `${getGiteaRepoUrl()}/src/branch/main/agent-apps/${appId}`;
  } catch (extractError) {
    console.error('[agent-apps PUT] 解压失败:', extractError);
    return null;
  }
}

export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    console.log('[agent-apps PUT] Auth failed:', auth.error);
    return authErrorResponse(auth);
  }

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

    const existing = await prisma.agentApp.findFirst({
      where: {
        id: appId,
        userId: auth.payload.userId,
      },
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
              }
            }
          }

          agentHarnessPath = `${getGiteaRepoUrl()}/src/branch/main/${appId}`;
        }
      } catch (giteaError) {
        console.error('[agent-apps PUT] Gitea 更新失败:', giteaError);
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
  const auth = authenticateRequest(request);
  if (!auth.success) {
    console.log('[agent-apps DELETE] Auth failed:', auth.error);
    return authErrorResponse(auth);
  }

  try {
    const params = await context.params;
    const appId = params.id;
    
    console.log('[agent-apps DELETE] Delete request:', { appId, userId: auth.payload.userId });
    
    const existing = await prisma.agentApp.findFirst({
      where: {
        id: appId,
        userId: auth.payload.userId,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 });
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