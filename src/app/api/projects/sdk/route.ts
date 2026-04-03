import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

// SDK 项目列表（OpenCode 已移除，返回空数据）
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // OpenCode 已移除，返回空数据
    return NextResponse.json({ projects: [] });
  } catch (error) {
    console.error('获取 SDK 项目列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
