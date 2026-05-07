import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'task-files');

export async function POST(request: NextRequest) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  try {
    const formData = await request.formData();
    const name = formData.get('name') as string;
    const agentId = formData.get('agentId') as string;
    const agentName = formData.get('agentName') as string;
    const parameters = formData.get('parameters') as string;
    const notes = formData.get('notes') as string | null;
    const file = formData.get('file') as File | null;

    if (!name || !agentId) {
      return NextResponse.json({ error: '缺少必填参数' }, { status: 400 });
    }

    const taskId = randomUUID();
    let filePath: string | null = null;

    if (file && file.size > 0) {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }

      const fileExt = file.name.split('.').pop() || 'zip';
      const fileName = `${taskId}_${file.name}`;
      filePath = path.join(UPLOAD_DIR, fileName);

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(filePath, buffer);
    }

    const task = await prisma.taskInstance.create({
      data: {
        id: taskId,
        userId: auth.payload.userId,
        name,
        agentId,
        agentName,
        parameters: parameters || '{}',
        filePath,
        notes,
        status: 'pending',
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ task });
  } catch (error) {
    console.error('创建任务失败:', error);
    return NextResponse.json({ error: '创建任务失败' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const skip = (page - 1) * limit;

  try {
    const where = auth.payload.roles?.includes('admin') ? {} : { userId: auth.payload.userId };

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