/**
 * 删除 Claude 项目
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { ProjectDiscovery } from '@/services/session-manager';

export async function DELETE(
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

    const projectDiscovery = new ProjectDiscovery();
    await projectDiscovery.deleteProject(decodedProjectName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
