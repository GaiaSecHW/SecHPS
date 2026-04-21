// src/app/api/code/analyze/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { CodeAnalyzer } from '@/lib/code-analyzer';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/code/analyze - 分析项目代码
export async function POST(request: Request) {
  try {
    // Authenticate and check permission
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CODE_ANALYZE });
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }
    const { payload } = auth;

    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json({ details: { error: '缺少项目ID' } }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ details: { error: '项目不存在' } }, { status: 404 });
    }

    // 检查项目路径
    if (!project.projectPath) {
      return NextResponse.json({ details: { error: '项目路径未配置' } }, { status: 400 });
    }

    // 创建 SSE 流用于进度更新
    const stream = new ReadableStream({
      async start(controller) {
        const sendProgress = (status: string, progress: number) => {
          const data = JSON.stringify({ status, progress });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
        };

        try {
          const analyzer = new CodeAnalyzer(projectId, project.projectPath!);
          const result = await analyzer.analyze(sendProgress);

          const data = JSON.stringify({
            type: 'complete',
            result: {
              projectId: result.projectId,
              fileCount: result.structure.fileCount,
              codeCount: result.structure.codeCount,
              entityCount: result.entities.length,
              callRelationCount: result.callRelations.length,
              dataFlowCount: result.dataFlows.length,
              duration: result.duration,
              errors: result.errors,
            },
          });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          controller.close();
        } catch (error) {
          const data = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : '分析失败',
          });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CODE, '分析项目失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
