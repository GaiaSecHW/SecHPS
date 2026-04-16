import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

// GET /api/global/health - 健康检查（公开端点，无需认证）
export async function GET(request: Request) {
  try {
    return NextResponse.json({
      healthy: true,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.errorNoUser('SYSTEM', '健康检查失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { healthy: false, error: '健康检查失败' },
      { status: 500 }
    );
  }
}
