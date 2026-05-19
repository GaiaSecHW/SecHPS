import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { uploadAgentHarness, deleteAgentHarness } from '@/lib/minio-client';
import AdmZip from 'adm-zip';
import { logger, LOG_MODULES } from '@/lib/logger';
import { syncSkillsFromHarness } from '@/lib/skill-harness-sync';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const params = await context.params;
    const appId = params.id;

    let name: string;
    let engine: string;
    let defaultAgentName: string | undefined;
    let startCommand: string | null;
    let inputRequirements: string | null;
    let isPublic: boolean = false;
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
      defaultAgentName = body.defaultAgentName || undefined;
      startCommand = body.startCommand || null;
      inputRequirements = body.inputRequirements || null;
      isPublic = body.isPublic || false;
    } else if (contentType.includes('multipart/form-data')) {
      formData = await request.formData();
      name = formData.get('name') as string;
      engine = formData.get('engine') as string;
      defaultAgentName = (formData.get('defaultAgentName') as string) || undefined;
      startCommand = formData.get('startCommand') as string | null;
      inputRequirements = formData.get('inputRequirements') as string | null;
      isPublic = formData.get('isPublic') === 'true';
      fileType = formData.get('agentHarnessFileType') as string | null;
      agentHarnessFile = formData.get('agentHarnessFile') as File | null;
      filesJson = formData.get('filesJson') as string | null;
      updateFiles = agentHarnessFile !== null && agentHarnessFile.size > 0;
    } else {
      return NextResponse.json({ error: '不支持的 Content-Type' }, { status: 400 });
    }

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
    let minioUploaded = false;
    let syncedFilesMap: Map<string, Buffer> | null = null;

    // MinIO 方式更新文件
    if (updateFiles) {
      const filesMap = new Map<string, Buffer>();

      if (fileType === 'archive' && agentHarnessFile) {
        const fileBuffer = Buffer.from(await agentHarnessFile.arrayBuffer());
        const zip = new AdmZip(fileBuffer);
        const zipEntries = zip.getEntries();

        for (const entry of zipEntries) {
          if (!entry.isDirectory) {
            filesMap.set(entry.entryName, entry.getData());
          }
        }
      } else if (fileType === 'folder' && filesJson && formData) {
        const filesInfo = JSON.parse(filesJson);

        for (const info of filesInfo) {
          const file = formData.get(info.key) as File;
          if (file) {
            const fileBuffer = Buffer.from(await file.arrayBuffer());
            const relativePath = info.relativePath.replace(/^[^\/]+\//, '');
            filesMap.set(relativePath, fileBuffer);
          }
        }
      }

      if (filesMap.size > 0) {
        try {
          await deleteAgentHarness(appId);
          await uploadAgentHarness(appId, filesMap);
          minioUploaded = true;
          syncedFilesMap = filesMap;
        } catch (uploadError) {
          logger.errorWithUser(LOG_MODULES.SKILL, payload, 'MinIO 更新 AgentApp 失败', appId, {
            details: { appId, error: uploadError instanceof Error ? uploadError.message : String(uploadError) }
          });
        }

        agentHarnessPath = `${appId}/`;
      }
    }

    const app = await prisma.agentApp.update({
      where: { id: appId },
      data: {
        name,
        engine,
        defaultAgentName: defaultAgentName || undefined,
        startCommand: startCommand || null,
        inputRequirements: inputRequirements || null,
        isPublic,
        agentHarnessPath,
        updatedAt: new Date(),
      },
    });

    logger.info(LOG_MODULES.SKILL, 'AgentApp 更新成功', { appId, name, minioUploaded });

    // 异步同步 SKILL，不阻塞响应
    if (syncedFilesMap) {
      syncSkillsFromHarness(syncedFilesMap, payload.userId, existing.tenantId).catch(err =>
        console.error('[SkillHarnessSync] 自动同步失败:', err)
      );
    }

    return NextResponse.json({ app, minioUploaded });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '更新应用失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '更新应用失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const params = await context.params;
    const appId = params.id;

    const whereCondition: Record<string, unknown> = { id: appId };
    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      // 平台管理员和 ICS 租户可操作任何应用
    } else {
      // 普通租户用户：必须是自己创建的应用（不能删除 public 资源）
      whereCondition.userId = payload.userId;
      whereCondition.isPublic = false;
    }

    const existing = await prisma.agentApp.findFirst({
      where: whereCondition,
    });

    if (!existing) {
      return NextResponse.json({ error: '应用不存在或无权限删除公共资源' }, { status: 404 });
    }

    // MinIO 方式删除文件（异步，不阻塞响应）
    deleteAgentHarness(appId).then(() => {
      logger.info(LOG_MODULES.SKILL, `MinIO 删除 AgentApp 成功: ${appId}`);
    }).catch(err => {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, 'MinIO 删除 AgentApp 文件失败', appId, {
        details: { appId, error: err instanceof Error ? err.message : String(err) }
      });
    });

    await prisma.agentApp.delete({
      where: { id: appId },
    });

    logger.info(LOG_MODULES.SKILL, 'AgentApp 删除成功', { appId });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '删除应用失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '删除应用失败' }, { status: 500 });
  }
}