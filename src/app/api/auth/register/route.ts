import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@/types/permissions';
import type { Permission } from '@prisma/client';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password, name, email } = body;

    // 验证输入（用户名和密码为必填项）
    if (!username || !password) {
      return NextResponse.json(
        { error: '请输入用户名和密码' },
        { status: 400 }
      );
    }

    // 检查用户名是否已存在
    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUsername) {
      return NextResponse.json(
        { error: '用户名已存在' },
        { status: 400 }
      );
    }

    // 如果提供了邮箱，检查邮箱是否已存在
    if (email) {
      const existingEmail = await prisma.user.findUnique({
        where: { email },
      });

      if (existingEmail) {
        return NextResponse.json(
          { error: '邮箱已被使用' },
          { status: 400 }
        );
      }
    }

    // 哈希密码
    const passwordHash = await hashPassword(password);

    // 创建用户
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        name: name || username,
        email: email || `${username}@local`, // 如果没有提供邮箱，使用默认邮箱
      },
    });

    // 分配默认角色（USER）
    const defaultRole = await prisma.role.findUnique({
      where: { name: ROLES.USER },
    });

    if (defaultRole) {
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: defaultRole.id,
        },
      });
    }

    // 创建默认 AI4WEB 配置
    await prisma.opencodeConfig.create({
      data: {
        userId: user.id,
        name: 'Default',
        baseURL: 'http://localhost:54321',
      },
    });

    return NextResponse.json(
      {
        message: '注册成功',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
