import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { getTenantIdForCreate } from '@/lib/tenant-filter';
import { createTaskWithFiles } from '@/lib/task-creation';

export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const formData = await request.formData();
    const name = formData.get('name') as string;
    const agentId = formData.get('agentId') as string;
    const agentName = formData.get('agentName') as string;
    const modelId = formData.get('modelId') as string | null;
    const modelName = formData.get('modelName') as string | null;
    const parameters = formData.get('parameters') as string;
    const notes = formData.get('notes') as string | null;
    const skills = formData.get('skills') as string | null;
    const scripts = formData.get('scripts') as string | null;
    const targetProduct = formData.get('targetProduct') as string | null;
    const file = formData.get('file') as File | null;

    if (!name || !agentId) {
      return NextResponse.json({ error: '缺少必填参数：name 和 agentId' }, { status: 400 });
    }

    // notes 为可选字段，无需校验

    const taskId = randomUUID();

    // 准备文件数据
    const files: { name: string; buffer: Buffer }[] = [];
    if (file && file.size > 0) {
      const arrayBuffer = await file.arrayBuffer();
      files.push({
        name: file.name,
        buffer: Buffer.from(arrayBuffer),
      });
    }

    // 使用共享函数创建任务
    const result = await createTaskWithFiles({
      taskId,
      userId: payload.userId,
      tenantId: tenant.tenantId,
      isPublic: tenant.isIcsTenant,
      agentId,
      agentName,
      name,
      notes: notes || '',
      modelId: modelId || null,
      modelName: modelName || null,
      parameters: parameters || '{}',
      skills,
      scripts,
      targetProduct,
      files: files.length > 0 ? files : null,
    });

    return NextResponse.json({ task: result.task });
  } catch (error) {
    console.error('创建任务失败:', error);
    return NextResponse.json({ error: '创建任务失败' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const skip = (page - 1) * limit;

  try {
    // 构建租户过滤条件
    let where: any = {};

    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant && !payload.roles?.includes('admin')) {
      where.userId = payload.userId;
    }

    const [tasks, total] = await Promise.all([
      prisma.taskInstance.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.taskInstance.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      tasks,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error) {
    console.error('获取任务列表失败:', error);
    return NextResponse.json({ error: '获取任务列表失败' }, { status: 500 });
  }
}