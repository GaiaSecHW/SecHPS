// src/app/api/scans/[id]/progress/route.ts

import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/scans/:id/progress - 获取扫描进度 (SSE)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);

  if (!payload) {
    return new Response(JSON.stringify({ error: '无效的令牌' }), { status: 401 });
  }

  const { id } = await params;

  const scan = await prisma.scanTask.findUnique({ where: { id } });
  if (!scan) {
    return new Response(JSON.stringify({ error: '扫描任务不存在' }), { status: 404 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const sendData = async () => {
        const currentScan = await prisma.scanTask.findUnique({ where: { id } });
        if (!currentScan) {
          controller.close();
          return;
        }

        const data = JSON.stringify({
          taskId: currentScan.id,
          status: currentScan.status,
          progress: currentScan.progress,
          currentSkill: currentScan.currentSkill,
          totalSkills: currentScan.totalSkills,
          completedSkills: currentScan.completedSkills,
          findingsCount: currentScan.findingsCount,
          startedAt: currentScan.startedAt,
          completedAt: currentScan.completedAt,
          error: currentScan.error,
        });

        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));

        if (currentScan.status === 'completed' || currentScan.status === 'failed' || currentScan.status === 'cancelled') {
          controller.close();
        }
      };

      // 立即发送一次
      await sendData();

      // 每2秒轮询一次
      const interval = setInterval(async () => {
        try {
          await sendData();
        } catch (err) {
          controller.close();
          clearInterval(interval);
        }
      }, 2000);

      // 30秒后超时
      setTimeout(() => {
        clearInterval(interval);
        controller.close();
      }, 30000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
