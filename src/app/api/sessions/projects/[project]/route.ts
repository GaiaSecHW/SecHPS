/**
 * 删除 Claude 项目
 */

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { ProjectDiscovery } from '@/services/session-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ project: string }> }
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
    const { project: projectName } = await params;
    const decodedProjectName = decodeURIComponent(projectName);

    const projectDiscovery = new ProjectDiscovery();
    await projectDiscovery.deleteProject(decodedProjectName);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, '删除项目错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
