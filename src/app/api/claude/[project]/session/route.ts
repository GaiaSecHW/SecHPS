/**
 * 创建新会话
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { SessionManager } from '@/services/session-manager';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ project: string }> }
) {
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

    const { project: projectName } = await params;
    const decodedProjectName = decodeURIComponent(projectName);
    const projectPath = decodedProjectName.replace(/-/g, '/');

    const sessionManager = new SessionManager(projectPath);
    const session = await sessionManager.createSession({ cwd: projectPath });

    return NextResponse.json({ session });
  } catch (error) {
    console.error('创建会话错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
