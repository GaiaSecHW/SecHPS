import { NextResponse } from 'next/server';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';
import eventBus from '@/lib/event-bus';
import { executeVulnerabilityParseAsync, vulnParseInProgress } from '@/lib/vulnerability-parse';

async function createParseLog(
  taskInstanceId: string,
  level: 'info' | 'success' | 'error' | 'warn',
  message: string,
  details?: string
) {
  const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await prisma.taskExecutionLog.upsert({
    where: { id },
    create: {
      id,
      taskId: taskInstanceId,
      level,
      message,
      details: details || null,
      timestamp: new Date(),
    },
    update: {},
  });
  eventBus.emit(`task:${taskInstanceId}`, {
    type: level === 'error' ? 'error' : level === 'success' ? 'success' : 'info',
    level,
    message,
    details: details || null,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, nodeId, status, result, error, reportContent } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    // Worker owns 业务完成判定：以 Report/AUDIT_REPORT.* 为准（参见 docs/plans/2026-06-01-audit-report-completion-design.md）。
    // Server 信任 Worker 上报的 status，不再用 reportContent 反推 completed，避免非最终报告导致假完成。
    const finalState = status === 'completed' ? 'completed' : 'failed';

    // Atomically update CodeswarmTask + TaskInstance + Worker.currentTasks in one transaction
    const txResult = await prisma.$transaction(async (tx) => {
      // 先查询 CodeswarmTask 获取 workerId（用于递减 Worker.currentTasks）
      const codeswarmTask = await tx.codeswarmTask.findUnique({
        where: { taskId },
        select: { id: true, workerId: true },
      });

      if (!codeswarmTask) {
        return { alreadyTerminal: true, taskInstance: null, workerId: null };
      }

      const updateResult = await tx.$executeRaw`
        UPDATE "CodeswarmTask"
        SET state = ${finalState},
            result = ${result || null},
            error = ${error || null},
            "reportContent" = ${reportContent || null},
            "completedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE "taskId" = ${taskId}
          AND (state = 'running' OR state = 'dispatched')
      `;

      if (updateResult === 0) {
        return { alreadyTerminal: true, taskInstance: null, workerId: codeswarmTask.workerId };
      }

      // 在同一事务内递减 Worker.currentTasks（条件更新防止负数）
      if (codeswarmTask.workerId) {
        await tx.codeswarmWorker.updateMany({
          where: {
            id: codeswarmTask.workerId,
            currentTasks: { gt: 0 },
          },
          data: { currentTasks: { decrement: 1 } },
        });
      }

      const taskInstance = await tx.taskInstance.findFirst({
        where: { codeswarmTaskId: taskId },
        select: { id: true },
      });

      if (taskInstance) {
        await tx.taskInstance.update({
          where: { id: taskInstance.id },
          data: {
            status: finalState,
            completedAt: new Date(),
            updatedAt: new Date(),
            errorMessage: error || null,
            executionResult: result || null,
            reportPath: reportContent || null,
          },
        });
      }

      return { alreadyTerminal: false, taskInstance, workerId: codeswarmTask.workerId };
    });

    if (txResult.alreadyTerminal) {
      // 任务已处于终态（超时/取消/掉线重调度），result 回调被忽略
      // 重要：不再调用 onTaskCompleted()，因为超时/掉线处理已释放了 Worker 槽位
      // 避免双重递减导致 currentTasks 虚低
      logger.warn(LOG_MODULES.CODESWARM, `Result for task ${taskId} ignored — task already in terminal state (timeout/cancelled), Worker slot already released`);
      return NextResponse.json({ success: true, taskId, status: 'ignored', reason: 'task_already_terminal' });
    }

    const taskInstance = txResult.taskInstance;

    if (taskInstance) {
      const completeLogId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-complete`;
      await prisma.taskExecutionLog.upsert({
        where: { id: completeLogId },
        create: {
          id: completeLogId,
          taskId: taskInstance.id,
          level: finalState === 'completed' ? 'success' : 'error',
          message: finalState === 'completed' ? '任务执行完成' : '任务执行失败',
          details: error || '所有步骤已完成',
          timestamp: new Date(),
        },
        update: {},
      });

      eventBus.emit(`task:${taskInstance.id}`, {
        type: finalState,
        level: finalState === 'completed' ? 'success' : 'error',
        message: finalState === 'completed' ? '任务执行完成' : '任务执行失败',
        details: error || '所有步骤已完成',
        timestamp: new Date().toISOString(),
      });
    }

    // Worker.currentTasks 的 DB decrement 已在事务中完成，这里只更新内存
    // 使用事务返回的 workerId 查找 nodeId 进行内存递减
    if (nodeId) {
      codeswarmDispatcher.decrementWorkerMemoryLoad(nodeId);
      codeswarmDispatcher.tryDispatchNext().catch(e =>
        logger.warn(LOG_MODULES.CODESWARM, '触发下一任务分发失败', { details: { error: e instanceof Error ? e.message : String(e) } })
      );
    }

    await codeswarmDispatcher.publishTaskEvent(taskId, {
      type: 'task_completed',
      status: finalState,
    });

    if (finalState === 'completed') {
      const taskInstanceForParse = await prisma.taskInstance.findFirst({
        where: { codeswarmTaskId: taskId },
        select: { id: true, projectPath: true, name: true, targetProduct: true },
      });

      if (taskInstanceForParse?.projectPath && !vulnParseInProgress.has(taskId)) {
        vulnParseInProgress.add(taskId);
        let productName = taskInstanceForParse.targetProduct;

        if (!productName) {
          const codeswarmTask = await prisma.codeswarmTask.findUnique({
            where: { taskId },
            select: { targetProduct: true },
          });
          productName = codeswarmTask?.targetProduct || 'default';
        }

        const taskName = taskInstanceForParse.name || 'unnamed-task';

        await createParseLog(taskInstanceForParse.id, 'info', '收到 Worker 完成回调', `codeswarmTaskId: ${taskId}, 产品: ${productName}, 任务: ${taskName}`);

        executeVulnerabilityParseAsync(
          taskId,
          taskInstanceForParse.projectPath,
          taskInstanceForParse.id,
          { productName, taskName }
        ).catch((err) => {
          logger.error(LOG_MODULES.CODESWARM, `[VulnParse:${taskId}] 异步解析异常`, {
            details: { error: err instanceof Error ? err.message : String(err) },
          });
        });
      } else if (vulnParseInProgress.has(taskId)) {
        logger.warn(LOG_MODULES.CODESWARM, `[VulnParse:${taskId}] 已在处理中，跳过重复触发`);
      }
    }

    return NextResponse.json({ success: true, taskId, status: finalState });
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'Result callback error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: 'Failed to record result' },
      { status: 500 }
    );
  }
}