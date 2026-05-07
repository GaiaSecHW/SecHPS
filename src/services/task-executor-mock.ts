import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import eventBus from '@/lib/event-bus';

const MOCK_LOG_MESSAGES = [
  { level: 'info', message: '任务开始执行', details: '正在初始化执行环境...' },
  { level: 'info', message: '加载 Agent 配置', details: 'Agent: {agentName}' },
  { level: 'info', message: '解析上传文件', details: '文件解析完成' },
  { level: 'info', message: '开始安全扫描', details: '正在扫描目标文件...' },
  { level: 'warning', message: '发现潜在问题', details: '检测到可疑代码片段' },
  { level: 'info', message: '深度分析', details: '正在分析代码逻辑...' },
  { level: 'success', message: '扫描完成', details: '共检查 156 个文件' },
  { level: 'success', message: '生成报告', details: '安全审计报告已生成' },
  { level: 'success', message: '任务执行完成', details: '执行耗时: 2分35秒' },
];

export async function executeTaskMock(
  taskId: string,
  mergedSkills?: string,
  mergedScripts?: string
): Promise<void> {
  const task = await prisma.taskInstance.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error('任务不存在');
  }

  eventBus.emit(`task:${taskId}`, {
    level: 'info',
    message: '任务开始执行',
    details: `Agent: ${task.agentName}`,
    timestamp: new Date(),
  });

  for (let i = 0; i < MOCK_LOG_MESSAGES.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const logData = MOCK_LOG_MESSAGES[i];
    const details = logData.details?.replace('{agentName}', task.agentName) || null;

    await prisma.taskExecutionLog.create({
      data: {
        id: randomUUID(),
        taskId,
        level: logData.level,
        message: logData.message,
        details,
      },
    });

    eventBus.emit(`task:${taskId}`, {
      level: logData.level,
      message: logData.message,
      details,
      timestamp: new Date(),
    });
  }

  await prisma.taskInstance.update({
    where: { id: taskId },
    data: {
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
      executionResult: JSON.stringify({
        success: true,
        scannedFiles: 156,
        vulnerabilitiesFound: 0,
        mergedSkills: mergedSkills ? JSON.parse(mergedSkills) : [],
        mergedScripts: mergedScripts ? JSON.parse(mergedScripts) : [],
      }),
    },
  });

  eventBus.emit(`task:${taskId}`, {
    type: 'completed',
    level: 'success',
    message: '任务执行完成',
    details: '所有步骤已完成',
    timestamp: new Date(),
  });
}