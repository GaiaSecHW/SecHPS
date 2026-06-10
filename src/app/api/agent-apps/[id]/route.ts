import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { ArchiveExtractError, extractArchiveToMap } from '@/lib/archive-extract';
import { syncSkillsFromHarness } from '@/lib/skill-harness-sync';
import {
  pushOrUpdateOrgRepo,
  deleteOrgRepo,
  isConfigured as isGiteaOrgConfigured,
} from '@/lib/gitea-org-repo';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
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
    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant) {
      // 普通租户用户：自己的 + 公开的 + 同租户的
      whereCondition.OR = [
        { userId: payload.userId },
        { isPublic: true },
        { tenantId: tenant.tenantId },
      ];
    }

    const app = await prisma.agentApp.findFirst({
      where: whereCondition,
      include: {
        Tenant: { select: { name: true } },
        User: { select: { name: true, username: true } },
      },
    });

    if (!app) {
      return NextResponse.json({ error: '应用不存在或无权限访问' }, { status: 404 });
    }

    return NextResponse.json({ app });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '获取应用详情失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '获取应用详情失败' }, { status: 500 });
  }
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
      return NextResponse.json({ error: '应用不存在或无权限更新公共资源' }, { status: 404 });
    }

    let agentHarnessPath = existing.agentHarnessPath;
    let giteaUploaded = false;
    let syncedFilesMap: Map<string, Buffer> | null = null;

    if (updateFiles) {
      const filesMap = new Map<string, Buffer>();

      if (fileType === 'archive' && agentHarnessFile) {
        const fileBuffer = Buffer.from(await agentHarnessFile.arrayBuffer());
        try {
          const extractedFiles = await extractArchiveToMap(agentHarnessFile.name, fileBuffer);
          for (const [filePath, content] of extractedFiles) {
            filesMap.set(filePath, content);
          }
        } catch (error) {
          if (error instanceof ArchiveExtractError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
          }
          throw error;
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

      if (filesMap.size > 0 && agentHarnessPath && isGiteaOrgConfigured()) {
        try {
          const result = await pushOrUpdateOrgRepo(agentHarnessPath, filesMap);
          giteaUploaded = result.success;
          syncedFilesMap = filesMap;
          logger.info(LOG_MODULES.SKILL, `AgentHarness 更新: ${agentHarnessPath} (method: ${result.method}, success: ${result.success})`);
        } catch (uploadError) {
          logger.errorWithUser(LOG_MODULES.SKILL, payload, 'Gitea 更新 AgentApp 文件失败', appId, {
            details: { appId, repoName: agentHarnessPath, error: uploadError instanceof Error ? uploadError.message : String(uploadError) }
          });
        }
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

    logger.info(LOG_MODULES.SKILL, 'AgentApp 更新成功', { appId, name, giteaUploaded });

    if (syncedFilesMap) {
      syncSkillsFromHarness(syncedFilesMap, payload.userId, existing.tenantId).catch(err =>
        logger.error(LOG_MODULES.AGENT, '自动同步失败', { details: { error: err instanceof Error ? err.message : String(err) } })
      );
    }

    return NextResponse.json({ app, giteaUploaded });
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

    const repoName = existing.agentHarnessPath;
    
    if (!repoName) {
      logger.info(LOG_MODULES.SKILL, `AgentApp 无仓库路径，跳过仓库删除: ${appId}`);
    } else if (!isGiteaOrgConfigured()) {
      logger.warn(LOG_MODULES.SKILL, `Gitea 配置不完整，无法删除仓库: ${repoName}`);
    } else {
      try {
        const deleted = await deleteOrgRepo(repoName);
        if (deleted) {
          logger.info(LOG_MODULES.SKILL, `Gitea 仓库删除成功: ${repoName}`);
        } else {
          logger.warn(LOG_MODULES.SKILL, `Gitea 仓库删除返回失败: ${repoName}`);
        }
      } catch (giteaError) {
        logger.errorWithUser(LOG_MODULES.SKILL, payload, 'Gitea 删除仓库失败', appId, {
          details: { appId, repoName, error: giteaError instanceof Error ? giteaError.message : String(giteaError) }
        });
      }
    }

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