/**
 * 添加/删除 Claude 项目
 */

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { ProjectDiscovery } from '@/services/session-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
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
