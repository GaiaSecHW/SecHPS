import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/auth';
import { gitSkillSync } from '@/services/git-skill-sync';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    // 只有管理员可以手动触发同步
    const isAdmin = hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE);
    if (!isAdmin) {
      return NextResponse.json(
        { error: '只有管理员可以同步 Skill 仓库' },
        { status: 403 }
      );
    }

    logger.info(LOG_MODULES.SKILL, '开始同步 Skill 仓库', { userId: payload.userId });

    // 执行 git pull
    const result = await gitSkillSync.syncFromRemote();

    if (result.success) {
      logger.info(LOG_MODULES.SKILL, 'Skill 仓库同步成功', { 
        userId: payload.userId, 
        message: result.message 
      });

      // 获取本地 skill 列表
      const localSkills = gitSkillSync.listLocalSkills();

      return NextResponse.json({
        success: true,
        message: result.message,
        localSkillsCount: localSkills.length,
        localSkills: localSkills.slice(0, 20), // 只返回前20个
      });
    } else {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, 'Skill 仓库同步失败', 'sync', {
        details: { error: result.message }
      });

      return NextResponse.json({
        success: false,
        error: result.message,
      }, { status: 500 });
    }
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, 'Skill 同步 API 错误', {
      details: { error: error instanceof Error ? error.message : String(error) }
    });

    return NextResponse.json({
      success: false,
      error: '服务器内部错误',
    }, { status: 500 });
  }
}