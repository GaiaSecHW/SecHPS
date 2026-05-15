import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, apiKeyAuthErrorResponse } from '@/lib/api-key-auth';
import type { ApiKeyAuthSuccess } from '@/lib/api-key-auth';
import { badRequest, notFound, internalError } from '@/lib/api-errors';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { createTaskWithFiles } from '@/lib/task-creation';

/**
 * POST /api/v1/tasks - Create a new task
 * Supports both multipart/form-data (with file uploads) and JSON (with fileUrls)
 */
export async function POST(request: NextRequest) {
  // 1. Authenticate (don't pass requiredAgentId, we'll check manually)
  const auth = await authenticateApiKey(request);
  if (!auth.success) return apiKeyAuthErrorResponse(auth);
  const { apiKey } = auth as ApiKeyAuthSuccess;

  const contentType = request.headers.get('content-type') || '';
  const taskId = randomUUID();

  try {
    let agentId: string;
    let name: string;
    let notes: string;
    let modelId: string | null = null;
    let modelName: string | null = null;
    let parameters = '{}';
    let files: { name: string; buffer: Buffer }[] | null = null;

    if (contentType.includes('multipart/form-data')) {
      // Method 1: multipart/form-data with file uploads
      const formData = await request.formData();
      agentId = formData.get('agentId') as string;
      name = formData.get('name') as string;
      notes = formData.get('notes') as string;
      modelId = (formData.get('modelId') as string) || null;
      modelName = (formData.get('modelName') as string) || null;
      parameters = (formData.get('parameters') as string) || '{}';

      // Collect all files (supports multiple files)
      const fileEntries = formData.getAll('file') as File[];
      if (fileEntries.length > 0) {
        files = [];
        for (const f of fileEntries) {
          if (f.size > 0) {
            const buf = Buffer.from(await f.arrayBuffer());
            files.push({ name: f.name, buffer: buf });
          }
        }
        if (files.length === 0) files = null;
      }
    } else {
      // Method 2: JSON with fileUrls
      const body = await request.json();
      agentId = body.agentId;
      name = body.name;
      notes = body.notes;
      modelId = body.modelId || null;
      modelName = body.modelName || null;
      parameters = body.parameters || '{}';

      // Download files from fileUrls
      const fileUrls: string[] = body.fileUrls || [];
      if (fileUrls.length > 0) {
        files = [];
        for (const url of fileUrls) {
          try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
            const arrayBuf = await resp.arrayBuffer();
            // Extract filename from URL path
            const urlPath = new URL(url).pathname;
            const fileName = urlPath.split('/').pop() || 'file';
            files.push({ name: fileName, buffer: Buffer.from(arrayBuf) });
          } catch (e) {
            return badRequest(`Failed to download file: ${url}`);
          }
        }
      }
    }

    // Validate required fields
    if (!name || !agentId) return badRequest('name and agentId are required');
    if (!notes) return badRequest('notes is required');

    // Check Agent access permission
    if (!apiKey.allowedAgentIds.includes(agentId)) {
      return apiKeyAuthErrorResponse({ success: false, error: 'Access denied to this agent', code: 'FORBIDDEN', statusCode: 403 });
    }

    // Query AgentApp to get agentName
    const agentApp = await prisma.agentApp.findUnique({
      where: { id: agentId },
      select: { name: true },
    });
    if (!agentApp) return notFound('Agent not found');
    const agentName = agentApp.name;

    // Use shared function to create task
    const result = await createTaskWithFiles({
      taskId,
      userId: apiKey.userId,
      tenantId: apiKey.tenantId,
      isPublic: false,
      agentId,
      agentName,
      name,
      notes,
      modelId,
      modelName,
      parameters,
      skills: null,
      scripts: null,
      files,
    });

    return NextResponse.json({
      taskId: result.task.id,
      status: 'pending',
      createdAt: result.task.createdAt,
    }, { status: 201 });

  } catch (error) {
    console.error('[v1] Task creation failed:', error);
    return internalError('Task creation failed');
  }
}

/**
 * GET /api/v1/tasks - List tasks with pagination
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (!auth.success) return apiKeyAuthErrorResponse(auth);
  const { apiKey } = auth as ApiKeyAuthSuccess;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const skip = (page - 1) * limit;
  const status = searchParams.get('status');

  const where: any = { tenantId: apiKey.tenantId };
  if (status) where.status = status;

  try {
    const [tasks, total] = await Promise.all([
      prisma.taskInstance.findMany({
        where,
        select: {
          id: true,
          name: true,
          agentId: true,
          status: true,
          createdAt: true,
          completedAt: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.taskInstance.count({ where }),
    ]);

    return NextResponse.json({
      tasks: tasks.map(t => ({
        taskId: t.id,
        name: t.name,
        agentId: t.agentId,
        status: t.status,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        totalTokens: t.totalTokens,
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[v1] Task list failed:', error);
    return internalError('Failed to list tasks');
  }
}
