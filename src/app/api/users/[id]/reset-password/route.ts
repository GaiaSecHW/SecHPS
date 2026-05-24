import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { hashPassword } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

// 密码复杂度验证
function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: '密码至少需要8个字符' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: '密码需要包含小写字母' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: '密码需要包含大写字母' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: '密码需要包含数字' };
  }
  return { valid: true };
}

/**
 * 管理员重置用户密码
 * POST /api/users/[id]/reset-password
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.USER_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;
    const body = await request.json();
    const { newPassword, mustChangePassword } = body;

    // 验证新密码
    if (!newPassword) {
      return NextResponse.json({ error: '请提供新密码' }, { status: 400 });
    }

    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // 检查目标用户是否存在
    const targetUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    // 不允许重置自己的密码（应该通过 /api/users/password 自己修改）
    if (targetUser.id === payload.userId) {
      return NextResponse.json(
        { error: '不能通过此接口重置自己的密码，请使用修改密码功能' },
        { status: 400 }
      );
    }

    // 哈希新密码
    const passwordHash = await hashPassword(newPassword);

    // 更新密码
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        ...(mustChangePassword ? { mustChangePassword: true } : {}),
      },
    });

    // 记录审计日志
    await prisma.auditLog.create({
          data: {
            id: generateId('audit'),
            userId: payload.userId,
            action: 'admin_reset_password',
            resource: id,
            details: JSON.stringify({
              targetUsername: targetUser.username,
              targetEmail: targetUser.email,
            }),
          },
        });

    // 记录跨用户操作日志
    logger.info(LOG_MODULES.USER, '管理员重置用户密码', {
      userId: payload.userId,
      username: payload.username,
      targetUserId: id,
      targetUsername: targetUser.username,
    });

    return NextResponse.json({
      message: '密码重置成功',
      username: targetUser.username,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.USER, '重置密码失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
