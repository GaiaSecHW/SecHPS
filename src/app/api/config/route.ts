import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// Validate JSON string field
function validateJsonField(value: string | null | undefined, fieldName: string): { valid: boolean; error?: string } {
  if (!value) return { valid: true }; // null/undefined allowed
  try {
    JSON.parse(value);
    return { valid: true };
  } catch {
    return { valid: false, error: `${fieldName} 格式无效，必须是合法的 JSON` };
  }
}

// Validate JSON object field (already parsed)
function validateJsonObject(value: unknown, fieldName: string): { valid: boolean; error?: string } {
  if (value === undefined || value === null) return { valid: true };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: `${fieldName} 格式无效，必须是 JSON 对象` };
  }
  return { valid: true };
}

// GET /api/config - Get all configs for authenticated user
export async function GET(request: Request) {
  try {
    // Verify Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // Check permission
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
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
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取配置列表失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// POST /api/config - Create a new config
export async function POST(request: Request) {
  try {
    // Verify Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // Check permission
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    const body = await request.json();
    const { name, baseURL, projectUploadDir, taskDescription, description, isActive, mcpServers, keybinds, modelPreferences, progressQuestion, customSystemPrompt, maxConcurrentEvaluations, defaultToolPermissions } = body;

    if (!name) {
      return NextResponse.json({ details: { error: '配置名称是必需的' } }, { status: 400 });
    }

    // Validate URL format if provided
    if (baseURL) {
      try {
        new URL(baseURL);
      } catch {
        return NextResponse.json(
          { details: { error: '无效的 baseURL 格式' } },
          { status: 400 }
        );
      }
    }

    // Validate maxConcurrentEvaluations
    const concurrentLimit = maxConcurrentEvaluations ? parseInt(maxConcurrentEvaluations) : 3;
    if (concurrentLimit < 1 || concurrentLimit > 10) {
      return NextResponse.json(
        { details: { error: '并发限制必须在 1-10 之间' } },
        { status: 400 }
      );
    }

    // Validate JSON object fields
    const jsonObjectFields = [
      { value: mcpServers, name: 'mcpServers' },
      { value: keybinds, name: 'keybinds' },
    ];
    for (const field of jsonObjectFields) {
      const validation = validateJsonObject(field.value, field.name);
      if (!validation.valid) {
        return NextResponse.json({ details: { error: validation.error } }, { status: 400 });
      }
    }

    // Validate JSON string fields
    const jsonStringFields = [
      { value: defaultToolPermissions, name: 'defaultToolPermissions' },
    ];
    for (const field of jsonStringFields) {
      const validation = validateJsonField(field.value, field.name);
      if (!validation.valid) {
        return NextResponse.json({ details: { error: validation.error } }, { status: 400 });
      }
    }

    // Create config
    const config = await prisma.opencodeConfig.create({
      data: {
        userId: payload.userId,
        name,
        baseURL: baseURL || 'http://localhost:54321',
        projectUploadDir: projectUploadDir || null,
        taskDescription,
        description,
        isActive: isActive !== undefined ? isActive : true,
        mcpServers: mcpServers ? JSON.stringify(mcpServers) : null,
        keybinds: keybinds ? JSON.stringify(keybinds) : null,
        // modelPreferences 是字符串格式 "providerID/modelID"，直接存储
        modelPreferences: modelPreferences || null,
        customSystemPrompt: customSystemPrompt || null,
        progressQuestion: progressQuestion || null,
        maxConcurrentEvaluations: concurrentLimit,
        defaultToolPermissions: defaultToolPermissions || null,
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
    logger.errorNoUser(LOG_MODULES.CONFIG, '创建配置失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
