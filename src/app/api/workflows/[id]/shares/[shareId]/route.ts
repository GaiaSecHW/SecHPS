import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 取消分享工作流
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_SHARE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id, shareId } = await params;

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 检查工作流是否存在且属于当前用户（管理员可取消所有分享）
    const workflow = await prisma.workflow.findFirst({
      where: {
        id,
        ...(isAdmin ? {} : { userId: payload.userId }),
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在或无权访问' }, { status: 404 });
    }

    // 检查分享记录是否存在
    const share = await prisma.workflowShare.findUnique({
      where: { id: shareId },
    });

    if (!share) {
      return NextResponse.json({ error: '分享记录不存在' }, { status: 404 });
    }

    // 检查分享记录是否属于该工作流
    if (share.workflowId !== id) {
      return NextResponse.json({ error: '分享记录不属于该工作流' }, { status: 400 });
    }

    // 删除分享记录
    await prisma.workflowShare.delete({
      where: { id: shareId },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        userId: payload.userId,
        action: 'workflow_unshare',
        resource: id,
        details: JSON.stringify({
          shareId,
          sharedWith: share.sharedWith,
        }),
      },
    });

    return NextResponse.json({
      message: '取消分享成功',
    });
  } catch (error) {
    console.error('Delete workflow share error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
