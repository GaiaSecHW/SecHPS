import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/workflows/config - Get workflow default configuration (全局配置)
export async function GET(request: Request) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }

    // OpencodeConfig 是全局配置，直接查询活跃配置
    const config = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
    });

    const fallbackDefaults = {
      startNodeLabel: '开始',
      startNodeDescription: '工作流的起始点',
      endNodeLabel: '结束',
      endNodeDescription: '工作流的结束点',
    };

    if (!config) {
      return NextResponse.json(fallbackDefaults);
    }

    if (config.workflowConfig) {
      try {
        const workflowConfig = JSON.parse(config.workflowConfig);
        return NextResponse.json({
          startNodeLabel: workflowConfig.startNodeLabel ?? fallbackDefaults.startNodeLabel,
          startNodeDescription: workflowConfig.startNodeDescription ?? fallbackDefaults.startNodeDescription,
          endNodeLabel: workflowConfig.endNodeLabel ?? fallbackDefaults.endNodeLabel,
          endNodeDescription: workflowConfig.endNodeDescription ?? fallbackDefaults.endNodeDescription,
        });
      } catch (e) {
        logger.errorNoUser(LOG_MODULES.WORKFLOW, 'Failed to parse workflow config', { details: { error: String(e) } });
      }
    }

    return NextResponse.json(fallbackDefaults);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, 'Get workflow config error', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
