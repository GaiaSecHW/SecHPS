import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { listTaskFiles, TaskFileInfo } from '@/lib/minio-vulnerability';
import { logger, LOG_MODULES } from '@/lib/logger';

async function getTaskContext(taskId: string): Promise<{ productName: string; taskName: string }> {
  const taskInstance = await prisma.taskInstance.findUnique({
    where: { id: taskId },
    select: { name: true, targetProduct: true, codeswarmTaskId: true },
  });

  if (!taskInstance) {
    return { productName: 'default', taskName: 'local-test' };
  }

  let productName = taskInstance.targetProduct;

  if (!productName && taskInstance.codeswarmTaskId) {
    const codeswarmTask = await prisma.codeswarmTask.findUnique({
      where: { taskId: taskInstance.codeswarmTaskId },
      select: { targetProduct: true },
    });
    productName = codeswarmTask?.targetProduct || 'default';
  }

  if (!productName) {
    productName = 'default';
  }

  const taskName = taskInstance.name || 'local-test';

  return { productName, taskName };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    // taskId 现在直接是 TaskInstance ID（本地测试创建时生成），无需硬编码回退
    const { productName, taskName } = await getTaskContext(taskId);

    const files = await listTaskFiles(taskId, productName, taskName);

    const reportFiles: TaskFileInfo[] = [];
    const fileFiles: TaskFileInfo[] = [];

    for (const file of files) {
      if (file.category === 'report') {
        reportFiles.push(file);
      } else if (file.category === 'file') {
        fileFiles.push(file);
      }
    }

    return NextResponse.json({
      taskId,
      productName,
      taskName,
      reportFiles,
      fileFiles,
      totalFiles: files.length,
    });
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'LocalTestFiles Error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}