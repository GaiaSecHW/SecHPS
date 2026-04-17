import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/workflows/config - Get workflow default configuration
export async function GET(request: Request) {
  try {
    // Verify Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // Get user's active config
    const config = await prisma.opencodeConfig.findFirst({
      where: {
        userId: payload.userId,
        isActive: true,
      },
    });

    if (!config) {
      // Return default values if no config found
      return NextResponse.json({
        startNodeLabel: '开始',
        startNodeDescription: '工作流的起始点',
        endNodeLabel: '结束',
        endNodeDescription: '工作流的结束点',
      });
    }

    // Parse workflow config
    if (config.workflowConfig) {
      try {
        const workflowConfig = JSON.parse(config.workflowConfig);
        return NextResponse.json({
          startNodeLabel: workflowConfig.startNodeLabel || '开始',
          startNodeDescription: workflowConfig.startNodeDescription || '工作流的起始点',
          endNodeLabel: workflowConfig.endNodeLabel || '结束',
          endNodeDescription: workflowConfig.endNodeDescription || '工作流的结束点',
        });
      } catch (e) {
        logger.errorWithUser(LOG_MODULES.WORKFLOW, payload, 'Failed to parse workflow config', undefined, { details: { error: String(e) } });
      }
    }

    // Return default values if workflowConfig is not set
    return NextResponse.json({
      startNodeLabel: '开始',
      startNodeDescription: '工作流的起始点',
      endNodeLabel: '结束',
      endNodeDescription: '工作流的结束点',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, 'Get workflow config error', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
