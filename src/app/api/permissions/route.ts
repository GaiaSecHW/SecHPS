import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 获取所有权限
export async function GET(request: Request) {
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
    if (!hasPermission(payload.permissions, PERMISSIONS.PERMISSION_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取所有权限
    const permissions = await prisma.permission.findMany({
      include: {
        roles: true,
      },
    });

    return NextResponse.json({ permissions });
  } catch (error) {
    console.error('Get permissions error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建权限
export async function POST(request: Request) {
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
    if (!hasPermission(payload.permissions, PERMISSIONS.PERMISSION_CREATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const { name, module, action, resource, description } = body;

    if (!name || !module || !action) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    // 检查权限是否已存在
    const existingPermission = await prisma.permission.findFirst({
      where: {
        module,
        action,
        resource: resource || null,
      },
    });

    if (existingPermission) {
      return NextResponse.json({ error: '权限已存在' }, { status: 400 });
    }

    // 创建权限
    const permission = await prisma.permission.create({
      data: {
        name,
        module,
        action,
        resource,
        description,
      },
    });

    return NextResponse.json({ permission }, { status: 201 });
  } catch (error) {
    console.error('Create permission error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
