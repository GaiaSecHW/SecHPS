import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestAsync, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { buildTenantFilter } from '@/lib/tenant-filter';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { ArchiveExtractError, extractArchiveToMap } from '@/lib/archive-extract';
import { syncSkillsFromHarness } from '@/lib/skill-harness-sync';
import {
  sanitizeRepoName,
  checkOrgRepoExists,
  createOrgRepo,
  pushOrUpdateOrgRepo,
  deleteOrgRepo,
  isConfigured as isGiteaOrgConfigured,
  getRepoUrl,
} from '@/lib/gitea-org-repo';

export async function GET(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    let apps;
    const include = {
      Tenant: {
        select: {
          name: true,
        },
      },
      User: {
        select: {
          name: true,
          username: true,
        },
      },
    };

    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      apps = await prisma.agentApp.findMany({
        include,
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
        include,
        orderBy: { createdAt: 'desc' },
      });
    }

    // Attach metrics per app
    const appIds = apps.map((a: any) => a.id);
    const metrics = appIds.length > 0
      ? await prisma.$queryRawUnsafe(`
          SELECT
            ti."agentId" AS "agentId",
            COUNT(ti.id)::int AS "runCount",
            COUNT(ti.id) FILTER (WHERE ti.status = 'completed')::int AS "successCount",
            MAX(ti."completedAt") AS "lastRunAt",
            COUNT(v.id) FILTER (WHERE v.vulnerable IS TRUE AND v.status IN ('confirmed','fixed','verified'))::int AS "vulnCount",
            COUNT(v.id)::int AS "alertCount",
            COUNT(v.id) FILTER (WHERE v.vulnerable IS TRUE AND v.status IN ('confirmed','fixed'))::int AS "confirmedVuln",
            COUNT(v.id) FILTER (WHERE v.vulnerable IS FALSE AND v.status IN ('confirmed','fixed'))::int AS "confirmedNonVuln"
          FROM "TaskInstance" ti
          LEFT JOIN "Vulnerability" v ON v."taskId" = ti.id
          WHERE ti."agentId" = ANY($1::text[])
          GROUP BY ti."agentId"
        `, appIds) as any[]
      : [];

    const metricsMap = new Map(metrics.map((m: any) => [m.agentId, m]));

    const appsWithMetrics = apps.map((app: any) => {
      const m = metricsMap.get(app.id);
      const confirmedVuln = m?.confirmedVuln || 0;
      const confirmedNonVuln = m?.confirmedNonVuln || 0;
      const falsePositiveRate = (confirmedVuln + confirmedNonVuln) > 0
        ? confirmedVuln / (confirmedVuln + confirmedNonVuln)
        : null;
      return {
        ...app,
        _metrics: m
          ? {
              runCount: m.runCount,
              successRate: m.runCount > 0 ? m.successCount / m.runCount : null,
              lastRunAt: m.lastRunAt ?? null,
              vulnCount: m.vulnCount,
              alertCount: m.alertCount,
              falsePositiveRate,
            }
          : { runCount: 0, successRate: null, lastRunAt: null, vulnCount: 0, alertCount: 0, falsePositiveRate: null },
      };
    });

    return NextResponse.json({ apps: appsWithMetrics });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取应用列表失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '获取应用列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  logger.info(LOG_MODULES.AGENT, `Creating agent app, userId: ${payload.userId}, username: ${payload.username}`);

  try {
    const formData = await request.formData();

    const name = formData.get('name') as string;
    const engine = formData.get('engine') as string;
    const defaultAgentName = (formData.get('defaultAgentName') as string) || undefined;
    const startCommand = formData.get('startCommand') as string | null;
    const inputRequirements = formData.get('inputRequirements') as string | null;
    const requireCodedmap = formData.get('requireCodedmap') === 'true';
    const isPublic = formData.get('isPublic') === 'true';
    const frontendTenantId = formData.get('tenantId') as string | null;
    const fileType = formData.get('agentHarnessFileType') as string | null;
    const agentHarnessFile = formData.get('agentHarnessFile') as File | null;
    const filesJson = formData.get('filesJson') as string | null;

    if (!name || !engine) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    if (!agentHarnessFile) {
      return NextResponse.json({ error: '请上传 AgentHarness 文件' }, { status: 400 });
    }

    if (isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
      return NextResponse.json(
        { error: '只有 ICSL 租户或管理员可以创建公共资源' },
        { status: 403 }
      );
    }

    let tenantId: string | null;
    if (isPublic) {
      tenantId = null;
    } else if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      tenantId = frontendTenantId || null;
      if (!tenantId) {
        return NextResponse.json({ error: '请选择租户或勾选公开' }, { status: 400 });
      }
    } else {
      tenantId = tenant.tenantId;
    }

    const appId = crypto.randomUUID();
    const filesMap = new Map<string, Buffer>();
    let repoName: string;

    if (fileType === 'archive' && agentHarnessFile && agentHarnessFile.size > 0) {
      repoName = sanitizeRepoName(agentHarnessFile.name);
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
    } else if (fileType === 'folder' && filesJson) {
      const filesInfo: { key: string; relativePath: string }[] = JSON.parse(filesJson);
      const folderName = filesInfo[0]?.relativePath.split('/')[0] || 'unknown';
      repoName = sanitizeRepoName(folderName);
      
      for (const info of filesInfo) {
        const file = formData.get(info.key) as File;
        if (file) {
          const fileBuffer = Buffer.from(await file.arrayBuffer());
          const relativePath = info.relativePath.replace(/^[^\/]+\//, '');
          filesMap.set(relativePath, fileBuffer);
        }
      }
    } else {
      return NextResponse.json({ error: '无效的文件类型' }, { status: 400 });
    }

    if (!isGiteaOrgConfigured()) {
      return NextResponse.json({ error: 'Gitea 组织仓库服务未配置' }, { status: 500 });
    }

    const existingApp = await prisma.agentApp.findFirst({
      where: { agentHarnessPath: repoName },
    });
    if (existingApp) {
      return NextResponse.json({ error: `仓库名 ${repoName} 已被其他应用使用，请更换文件名` }, { status: 400 });
    }

    const repoExists = await checkOrgRepoExists(repoName);
    if (repoExists) {
      return NextResponse.json({ error: `仓库 ${repoName} 已存在，请使用其他文件名` }, { status: 400 });
    }

    try {
      const repo = await createOrgRepo(repoName);
      if (!repo) {
        throw new Error('创建仓库失败');
      }

      if (filesMap.size > 0) {
        const result = await pushOrUpdateOrgRepo(repoName, filesMap);
        if (!result.success) {
          throw new Error('上传文件失败');
        }
        logger.info(LOG_MODULES.SKILL, `AgentHarness 上传成功: ${repoName} (method: ${result.method})`);
      }
    } catch (giteaError) {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, 'Gitea 创建仓库失败', repoName, {
        details: { repoName, error: giteaError instanceof Error ? giteaError.message : String(giteaError) }
      });
      return NextResponse.json({
        error: giteaError instanceof Error ? giteaError.message : 'Gitea 创建仓库失败',
      }, { status: 500 });
    }

    const agentHarnessPath = repoName;

    logger.info(LOG_MODULES.AGENT, `Before create, userId: ${payload.userId}, appId: ${appId}, tenantId: ${tenantId}`);

    const app = await prisma.agentApp.create({
      data: {
        id: appId,
        userId: payload.userId,
        name,
        engine,
        agentHarnessPath,
        defaultAgentName: defaultAgentName || undefined,
        startCommand: startCommand || null,
        inputRequirements: inputRequirements || null,
        requireCodedmap,
        status: 'active',
        tenantId,
        isPublic,
        updatedAt: new Date(),
      },
    });

    logger.info(LOG_MODULES.SKILL, 'AgentApp 创建成功', { appId, name });

    // 异步同步 SKILL，不阻塞响应
    syncSkillsFromHarness(filesMap, payload.userId, tenantId).catch(err =>
      logger.error(LOG_MODULES.AGENT, '自动同步失败', { details: { error: err instanceof Error ? err.message : String(err) } })
    );

    return NextResponse.json({ app });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '创建应用失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '创建应用失败' }, { status: 500 });
  }
}