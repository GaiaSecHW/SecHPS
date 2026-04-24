import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/workflows/config - Get workflow default configuration
export async function GET(request: Request) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }
    const payload = auth.payload;

    // Get user's active config
    const config = await prisma.opencodeConfig.findFirst({
      where: {
        userId: payload.userId,
        isActive: true,
      },
    });

    if (!config) {
      // Return empty values if no config found (user can set their own)
      return NextResponse.json({
        startNodeLabel: '',
        startNodeDescription: '',
        endNodeLabel: '',
        endNodeDescription: '',
      });
    }

    // Parse workflow config
    if (config.workflowConfig) {
      try {
        const workflowConfig = JSON.parse(config.workflowConfig);
        // Use ?? to allow empty strings, only fallback on null/undefined
        return NextResponse.json({
          startNodeLabel: workflowConfig.startNodeLabel ?? '',
          startNodeDescription: workflowConfig.startNodeDescription ?? '',
          endNodeLabel: workflowConfig.endNodeLabel ?? '',
          endNodeDescription: workflowConfig.endNodeDescription ?? '',
        });
      } catch (e) {
        logger.errorWithUser(LOG_MODULES.WORKFLOW, payload, 'Failed to parse workflow config', undefined, { details: { error: String(e) } });
      }
    }

    // Return empty values if workflowConfig is not set
    return NextResponse.json({
      startNodeLabel: '',
      startNodeDescription: '',
      endNodeLabel: '',
      endNodeDescription: '',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, 'Get workflow config error', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
