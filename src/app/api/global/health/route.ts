import { NextResponse } from 'next/server';

// GET /api/global/health - 健康检查（公开端点，无需认证）
export async function GET(request: Request) {
  try {
    return NextResponse.json({
      healthy: true,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      { healthy: false, error: '健康检查失败' },
      { status: 500 }
    );
  }
}
