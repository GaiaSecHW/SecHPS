/**
 * 添加/删除 Claude 项目
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { ProjectDiscovery } from '@/services/session-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

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

    logger.create(LOG_MODULES.PROJECT, payload, path, { details: { project } });
    return NextResponse.json({ project });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, '添加项目错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
