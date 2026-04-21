import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// 取消分享工作流
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_SHARE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id, shareId } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 检查工作流是否存在且属于当前用户（管理员可取消所有分享）
    const workflow = await prisma.workflow.findFirst({
      where: {
        id,
        ...(userIsAdmin ? {} : { userId: payload.userId }),
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
        id: generateId('audit'),
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
    logger.errorNoUser(LOG_MODULES.WORKFLOW, '删除工作流分享错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
