/**
 * 添加/删除 Claude 项目
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { ProjectDiscovery } from '@/services/session-manager';

export async function POST(request: Request) {
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

    const body = await request.json();
    const { path } = body;

    if (!path) {
      return NextResponse.json({ error: '项目路径不能为空' }, { status: 400 });
    }

    const projectDiscovery = new ProjectDiscovery();
    const project = await projectDiscovery.addProjectManually(path);

    return NextResponse.json({ project });
  } catch (error) {
    console.error('添加项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
