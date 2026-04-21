// src/app/api/tools/[id]/validate/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/tools/:id/validate - 验证工具参数
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_EXECUTE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;
    const body = await request.json();

    const tool = await prisma.tool.findUnique({ where: { id } });

    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    const parameters = JSON.parse(tool.parameters);
    const errors: string[] = [];

    // 验证必填参数
    for (const [key, schema] of Object.entries(parameters)) {
      const paramSchema = schema as Record<string, unknown>;
      if (paramSchema.required && (body[key] === undefined || body[key] === null || body[key] === '')) {
        errors.push(`参数 "${key}" 是必填的`);
      }
      // 类型验证
      if (body[key] !== undefined && paramSchema.type) {
        const actualType = typeof body[key];
        if (actualType !== paramSchema.type) {
          errors.push(`参数 "${key}" 类型错误，期望 ${paramSchema.type}，实际 ${actualType}`);
        }
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({
        valid: false,
        errors,
      }, { status: 400 });
    }

    return NextResponse.json({
      valid: true,
      message: '参数验证通过',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '验证参数错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
