import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * GET /api/skills/evaluation-data
 * 
 * 评估数据现在由大模型实时生成，不再从文件读取。
 * 此接口返回空数据，前端应使用 test-runs API 的结果。
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的 token' } }, { status: 401 });
    }

    // 返回空数据，评估结果由 test-runs API 实时生成
    return NextResponse.json({
      metadata: null,
      runs: [],
      run_summary: null,
      comparisons: [],
      notes: ['评估数据现在由大模型实时生成，请点击"开始评估"按钮运行测试'],
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '加载评估数据错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { details: { error: 'Failed to load evaluation data' } },
      { status: 500 }
    );
  }
}
