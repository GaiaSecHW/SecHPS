import { NextResponse } from 'next/server';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, nodeId, events, type, data } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    let taskInstance = await prisma.taskInstance.findFirst({
      where: { codeswarmTaskId: taskId },
      select: { id: true },
    });

    // Fallback: 通过 CodeswarmTask.platformTaskId 关联（处理绑定竞态）
    if (!taskInstance) {
      try {
        const csTask = await prisma.codeswarmTask.findFirst({
          where: { taskId },
          select: { platformTaskId: true },
        });
        if (csTask?.platformTaskId) {
          taskInstance = { id: csTask.platformTaskId };
        }
      } catch {
        // Non-critical fallback
      }
    }

    // Support both array format and single event format (from Worker daemon)
    const eventList: Array<{ type: string; data?: any; content?: string; message?: string; level?: string; stream?: string }> = [];
    if (events?.length) {
      eventList.push(...events);
    } else if (type && data) {
      eventList.push({ type, data });
    }

    if (eventList.length > 0) {
      // Create event rows with level and stream fields
      const eventRows = eventList.map((event) => {
        const eventData = event.data || event;
        const logLevel = eventData.level || event.level || 'agent';
        const stream = eventData.stream || event.stream || null;
        
        return {
          taskId,
          type: event.type || 'unknown',
          data: JSON.stringify(event),
          level: logLevel,
          stream,
        };
      });

      await prisma.codeswarmEvent.createMany({ data: eventRows });

      // 处理 session_created 事件：更新任务的 sessionId
      for (const event of eventList) {
        if (event.type === 'session_created' && event.message) {
          await prisma.$executeRaw`
            UPDATE "CodeswarmTask" SET "sessionId" = ${event.message}, state = 'running', "updatedAt" = NOW()
            WHERE "taskId" = ${taskId} AND state = 'dispatched'
          `.catch(e => logger.error(LOG_MODULES.CODESWARM, '更新 sessionId/状态 失败', { details: { error: e instanceof Error ? e.message : String(e) } }));
        } else if (event.type === 'phase_start') {
          const eventData = event.data || event;
          if (eventData.phase === 'executing') {
            await prisma.$executeRaw`
              UPDATE "CodeswarmTask" SET state = 'running', "updatedAt" = NOW()
              WHERE "taskId" = ${taskId} AND state = 'dispatched'
            `.catch(e => logger.error(LOG_MODULES.CODESWARM, '更新 running 状态失败', { details: { error: e instanceof Error ? e.message : String(e) } }));
          }
        }
      }

      for (const event of eventList) {
        codeswarmDispatcher.publishTaskEvent(taskId, {
          type: 'task_event',
          data: event,
        }).catch(e => logger.error(LOG_MODULES.CODESWARM, '发布事件失败', { details: { error: e instanceof Error ? e.message : String(e) } }));
      }

      if (taskInstance) {
        const logsToCreate: Array<{ id: string; taskId: string; level: string; message: string; details: string; timestamp: Date }> = [];

        for (const event of eventList) {
          let level = 'info';
          let message = '';
          let details = '';

          const eventData = event.data || event;
          const eventType = event.type;
          const content = eventData.content || eventData.message || '';
          const logLevel = eventData.level || 'agent';

          // Handle log_chunk and agent_log_chunk events
          if (eventType === 'log_chunk' || eventType === 'agent_log_chunk') {
            message = logLevel === 'worker' ? '[Worker]' : '[Agent]';
            details = content;
            level = eventData.stream === 'stderr' ? 'error' : 'info';
          } else if (eventType === 'agent_message_chunk' || eventType === 'task_started' || eventType === 'task_completed') {
            message = eventType === 'task_started' ? '任务开始' : eventType === 'task_completed' ? '任务完成' : 'Agent 输出';
            details = content;
          } else if (eventType === 'tool_call') {
            message = '工具调用';
            const toolName = eventData.tool || '';
            if (toolName && toolName !== 'other') {
              details = toolName;
            } else {
              const inputPreview = eventData.input ? JSON.stringify(eventData.input).slice(0, 500) : '';
              details = [toolName || '未命名工具', inputPreview].filter(Boolean).join(' | ');
            }
          } else if (eventType === 'tool_result' || eventType === 'tool_call_update') {
            message = '工具结果';
            details = eventData.output || content || '';
          } else if (eventType === 'error') {
            message = '错误';
            details = eventData.message || eventData.error || '';
            level = 'error';
          } else if (eventType === 'phase_error') {
            message = '阶段错误';
            details = eventData.message || eventData.error || '';
            level = 'warn';
          } else if (eventType === 'progress') {
            message = '进度';
            details = content;
          } else if (eventType === 'phase_start') {
            const phaseName = eventData.phase || '';
            if (phaseName === 'codedmap') {
              message = '知识图谱预处理';
              details = eventData.message || content || `开始处理知识图谱...`;
            } else {
              message = '阶段开始';
              details = eventData.message || content || phaseName;
            }
          } else if (eventType === 'phase_complete') {
            const phaseName = eventData.phase || '';
            if (phaseName === 'codedmap') {
              message = '知识图谱就绪';
              details = eventData.message || content || '知识图谱处理完成';
              level = eventData.success === false ? 'error' : 'info';
            } else {
              message = '阶段完成';
              details = eventData.message || content || phaseName;
              level = eventData.success === false ? 'error' : 'info';
            }
          } else if (eventType === 'skill_start') {
            message = 'Skill 执行';
            details = eventData.skill
              ? `开始执行 Skill: ${eventData.skill}`
              : (eventData.content || '');
            level = 'info';
          } else if (eventType === 'skill_complete') {
            message = 'Skill 完成';
            details = eventData.skill
              ? `Skill 执行完成: ${eventData.skill}`
              : '';
            level = 'info';
          }

          if (message) {
            logsToCreate.push({
              id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              taskId: taskInstance.id,
              level,
              message,
              details,
              timestamp: new Date(),
            });
          }
        }

        if (logsToCreate.length > 0) {
          await prisma.taskExecutionLog.createMany({ data: logsToCreate, skipDuplicates: true }).catch((e: Error) =>
            logger.error(LOG_MODULES.CODESWARM, '创建执行日志失败', { details: { error: e instanceof Error ? e.message : String(e) } })
          );
        }
      }
    }

    return NextResponse.json({ success: true, count: eventList.length });
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'Event processing error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}