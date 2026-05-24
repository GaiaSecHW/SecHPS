import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { verifyPassword, hashPassword } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

// 修改密码
export async function POST(request: Request) {
  try {
    // Authenticate
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }
    const { payload } = auth;

    const body = await request.json();
    const { currentPassword, newPassword, forceChange } = body;

    // 验证输入
    if (!newPassword) {
      return NextResponse.json(
        { details: { error: '请提供新密码' } },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { details: { error: '新密码长度至少为 6 位' } },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { details: { error: '新密码长度至少为 6 位' } },
        { status: 400 }
      );
    }

    // 获取用户
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      return NextResponse.json({ details: { error: '用户不存在' } }, { status: 404 });
    }

    // 强制改密（首次登录）跳过旧密码验证
    if (!forceChange) {
      if (!currentPassword) {
        return NextResponse.json(
          { details: { error: '请提供当前密码' } },
          { status: 400 }
        );
      }

      const isValidPassword = await verifyPassword(currentPassword, user.passwordHash);
      if (!isValidPassword) {
        return NextResponse.json(
          { details: { error: '当前密码错误' } },
          { status: 400 }
        );
      }
    }

    // 更新密码
    const newPasswordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: payload.userId },
      data: { passwordHash: newPasswordHash, mustChangePassword: false },
    });

    // 记录审计日志
    await prisma.auditLog.create({
          data: {
            id: generateId('audit'),
            userId: payload.userId,
            action: 'password_change',
            resource: payload.userId,
            details: JSON.stringify({ timestamp: new Date().toISOString() }),
          },
        });

    logger.update(LOG_MODULES.AUTH, payload, payload.userId, { action: 'password_change' });

    return NextResponse.json({ message: '密码修改成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUTH, '修改密码失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
