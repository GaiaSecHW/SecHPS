// src/app/api/code/analyze/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { CodeAnalyzer } from '@/lib/code-analyzer';

// POST /api/code/analyze - 分析项目代码
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { files: true },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 检查项目路径
    if (!project.projectPath) {
      return NextResponse.json({ error: '项目路径未配置' }, { status: 400 });
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
    console.error('分析项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
