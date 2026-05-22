import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestAsync, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { syncAllAgentHarnessFromGitea, cloneOrPullOrgRepo } from '@/lib/gitea-org-repo';

export async function POST(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const isAdmin = hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE);
    if (!isAdmin) {
      return NextResponse.json(
        { error: '只有管理员可以同步 AgentHarness 仓库' },
        { status: 403 },
      );
    }

    const body = request.headers.get('content-type')?.includes('json')
      ? await request.json().catch(() => null)
      : null;
    const repoName = body?.repoName as string | undefined;

    if (repoName) {
      logger.info(LOG_MODULES.SKILL, '同步单个 AgentHarness 仓库', { repoName, userId: payload.userId });

      const result = await cloneOrPullOrgRepo(repoName);

      if (result.success) {
        logger.info(LOG_MODULES.SKILL, 'AgentHarness 同步成功', { repoName, method: result.method });
        return NextResponse.json({
          success: true,
          message: `AgentHarness 同步成功 (${result.method}): ${repoName}`,
          repoName,
          method: result.method,
        });
      }

      return NextResponse.json({
        success: false,
        error: result.error || '同步失败',
        repoName,
        method: result.method,
      }, { status: 500 });
    }

    logger.info(LOG_MODULES.SKILL, '批量同步所有 AgentHarness 仓库', { userId: payload.userId });

    const result = await syncAllAgentHarnessFromGitea();

    return NextResponse.json({
      success: result.failed === 0,
      message: `同步完成: ${result.success}/${result.total} 成功`,
      total: result.total,
      successCount: result.success,
      failedCount: result.failed,
      errors: result.errors,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, 'AgentHarness 同步 API 错误', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });

    return NextResponse.json({
      success: false,
      error: '服务器内部错误',
    }, { status: 500 });
  }
}