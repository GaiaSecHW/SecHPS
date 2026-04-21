import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// SDK 项目列表（OpenCode 已移除，返回空数据）
export async function GET(request: Request) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }
    const payload = auth.payload;

    // OpenCode 已移除，返回空数据
    return NextResponse.json({ projects: [] });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, '获取 SDK 项目列表错误', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
