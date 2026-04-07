import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/config - Get all configs for authenticated user
export async function GET(request: Request) {
  try {
    // Verify Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // Check permission
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // Get configs for user
    const configs = await prisma.opencodeConfig.findMany({
      where: {
        userId: payload.userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ configs });
  } catch (error) {
    console.error('Get configs error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/config - Create a new config
export async function POST(request: Request) {
  try {
    // Verify Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // Check permission
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const { name, baseURL, projectUploadDir, taskDescription, description, isActive, mcpServers, keybinds, modelPreferences, progressQuestion, customSystemPrompt } = body;

    if (!name) {
      return NextResponse.json({ error: '配置名称是必需的' }, { status: 400 });
    }

    // Validate URL format if provided
    if (baseURL) {
      try {
        new URL(baseURL);
      } catch {
        return NextResponse.json(
          { error: '无效的 baseURL 格式' },
          { status: 400 }
        );
      }
    }

    // Create config
    const config = await prisma.opencodeConfig.create({
      data: {
        userId: payload.userId,
        name,
        baseURL: baseURL || 'http://localhost:54321',
        projectUploadDir,
        taskDescription,
        description,
        isActive: isActive !== undefined ? isActive : true,
        mcpServers: mcpServers ? JSON.stringify(mcpServers) : null,
        keybinds: keybinds ? JSON.stringify(keybinds) : null,
        // modelPreferences 是字符串格式 "providerID/modelID"，直接存储
        modelPreferences: modelPreferences || null,
        customSystemPrompt: customSystemPrompt || null,
        progressQuestion: progressQuestion || null,
      },
    });

    // Record audit log
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'config_create',
        resource: config.id,
        details: JSON.stringify({ name, baseURL }),
      },
    });

    return NextResponse.json({ config }, { status: 201 });
  } catch (error) {
    console.error('Create config error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
