import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, verifyPassword, hashPassword } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// 修改密码
export async function POST(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // 验证输入
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { details: { error: '请提供当前密码和新密码' } },
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

    // 验证当前密码
    const isValidPassword = await verifyPassword(currentPassword, user.passwordHash);

    if (!isValidPassword) {
      return NextResponse.json(
        { details: { error: '当前密码错误' } },
        { status: 400 }
      );
    }

    // 更新密码
    const newPasswordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: payload.userId },
      data: { passwordHash: newPasswordHash },
    });

    // 记录审计日志
    await prisma.auditLog.create({
          data: {
            id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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
