// instrumentation.ts
// Next.js 服务启动钩子 - 恢复评估状态和触发队列调度
// 使用动态导入避免 Edge Runtime 加载 Node.js 模块

import { PrismaClient } from '@prisma/client';
import { setSystemStartTime } from './src/lib/system-info';

const LOG_PREFIX = '[Instrumentation]';

// 记录服务启动时间
const startTime = new Date();
setSystemStartTime(startTime);
console.log(`${LOG_PREFIX} 服务启动时间: ${startTime.toISOString()}`);

// 直接创建 Prisma 客户端（避免动态导入返回 undefined）
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: ['error'],
});

/**
 * 服务启动时执行
 * 1. 恢复项目锁状态（从数据库读取活跃评估）
 * 2. 检查异常中断的评估（running但没有实际执行）
 * 3. 自动恢复被中断的评估（断点恢复）
 * 4. 触发队列调度（启动排队的评估）
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log(`${LOG_PREFIX} 应用启动，恢复评估锁定状态...`);
    
    // 动态导入 Node.js 模块（避免 Edge Runtime 错误）
    const { restoreLocksFromDatabase } = await import('./src/lib/evaluation-lock');
    const { processQueue } = await import('./src/services/evaluation-queue');
    const { recoverInterruptedEvaluations } = await import('./src/services/evaluation-recovery');
    
    try {
      // Step 1: 恢复项目锁状态
      await restoreLocksFromDatabase(prisma);
      console.log(`${LOG_PREFIX} 评估锁定状态已恢复`);
      
      // Step 2: 检查异常中断的评估
      console.log(`${LOG_PREFIX} 检查活跃评估...`);
      
      const runningEvaluations = await prisma.evaluationSession.findMany({
        where: {
          status: { in: ['preparing', 'running'] },
        },
        take: 50,
        select: {
          id: true,
          status: true,
          projectId: true,
        },
      });

      // 单独查询项目名称（避免 include 触发 Prisma findMany bug）
      const runningProjectIds = [...new Set(runningEvaluations.map(e => e.projectId))];
      const runningProjects = runningProjectIds.length > 0
        ? await prisma.project.findMany({ where: { id: { in: runningProjectIds } }, select: { id: true, name: true } })
        : [];
      const runningProjectMap = new Map(runningProjects.map(p => [p.id, p]));

      console.log(`${LOG_PREFIX} 发现 ${runningEvaluations.length} 个活跃评估`);

      if (runningEvaluations.length > 0) {
        runningEvaluations.forEach((session, index) => {
          const projectName = runningProjectMap.get(session.projectId)?.name || '未知';
          console.log(`  ${index + 1}. ${session.id} - ${projectName} - 状态: ${session.status}`);
        });
      }
      
      // Step 3: 自动恢复被中断的评估（断点恢复）
      console.log(`${LOG_PREFIX} 开始断点恢复检查...`);
      
      // 延迟触发断点恢复（不阻塞服务启动）
      // 服务启动后 10 秒再恢复，确保 API 路由和数据库连接已就绪
      setTimeout(async () => {
        console.log(`${LOG_PREFIX} ========== 开始断点恢复 ==========`);
        try {
          const recoveryResult = await recoverInterruptedEvaluations();
          console.log(`${LOG_PREFIX} ========== 断点恢复完成 ==========`);
          console.log(`${LOG_PREFIX} 恢复结果: 恢复=${recoveryResult.recovered}, 失败=${recoveryResult.failed}, 跳过=${recoveryResult.skipped}`);
          
          if (recoveryResult.details.length > 0) {
            recoveryResult.details.forEach((detail, index) => {
              console.log(`  ${index + 1}. ${detail.evaluationId} - 从节点 ${detail.nextNodeToExecute + 1} 恢复 (${detail.recoveryReason})`);
            });
          }
        } catch (err) {
          console.error(`${LOG_PREFIX} 断点恢复失败:`, err);
        }
      }, 10000);
      
      // Step 4: 检查排队评估并触发调度
      console.log(`${LOG_PREFIX} 检查排队评估...`);
      
      const queuedEvaluations = await prisma.evaluationSession.findMany({
        where: { status: 'queued' },
        take: 50,
        select: {
          id: true,
          projectId: true,
          startedAt: true,
        },
        orderBy: { startedAt: 'asc' },
      });

      // 单独查询排队评估的项目名称
      const queuedProjectIds = [...new Set(queuedEvaluations.map(e => e.projectId))];
      const queuedProjects = queuedProjectIds.length > 0
        ? await prisma.project.findMany({ where: { id: { in: queuedProjectIds } }, select: { id: true, name: true } })
        : [];
      const queuedProjectMap = new Map(queuedProjects.map(p => [p.id, p]));

      console.log(`${LOG_PREFIX} 发现 ${queuedEvaluations.length} 个排队评估`);

      if (queuedEvaluations.length > 0) {
        queuedEvaluations.forEach((session, index) => {
          const projectName = queuedProjectMap.get(session.projectId)?.name || '未知';
          console.log(`  ${index + 1}. ${session.id} - ${projectName} - 入队时间: ${session.startedAt?.toISOString() || '未知'}`);
        });
        
        // 延迟触发队列调度（不阻塞服务启动）
        // 服务启动后 15 秒再调度，确保断点恢复已完成
        console.log(`${LOG_PREFIX} 将在 15 秒后触发队列调度（不阻塞启动）...`);
        setTimeout(() => {
          console.log(`${LOG_PREFIX} ========== 开始队列调度 ==========`);
          processQueue()
            .then(() => console.log(`${LOG_PREFIX} ========== 队列调度完成 ==========`))
            .catch((err) => console.error(`${LOG_PREFIX} 队列调度失败:`, err));
        }, 15000);
      }
      
      console.log(`${LOG_PREFIX} 评估状态恢复完成，服务继续启动...`);

      // Step 6: 初始化 Git Skill 同步
      console.log(`${LOG_PREFIX} 初始化 Git Skill 同步...`);
      const { initGitSkillSync } = await import('./src/services/git-skill-sync');
      await initGitSkillSync();
      console.log(`${LOG_PREFIX} Git Skill 同步初始化完成`);
      
      // Step 7: 初始化 Git AgentApp 同步
      console.log(`${LOG_PREFIX} 初始化 Git AgentApp 同步...`);
      const { initGitAgentAppSync } = await import('./src/services/git-agent-app-sync');
      await initGitAgentAppSync();
      console.log(`${LOG_PREFIX} Git AgentApp 同步初始化完成`);
      
    } catch (error) {
      console.error(`${LOG_PREFIX} 评估状态恢复失败:`, error);
    }
  }
}