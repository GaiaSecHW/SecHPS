// instrumentation.ts
// Next.js 启动时执行的代码

import { restoreLocksFromDatabase } from './src/lib/evaluation-lock';
import { prisma } from './src/lib/prisma';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 只在 Node.js runtime 中执行（不在 Edge runtime 中）
    console.log('[Instrumentation] 应用启动，恢复评估锁定状态...');
    
    try {
      await restoreLocksFromDatabase(prisma);
      console.log('[Instrumentation] 评估锁定状态已恢复');
    } catch (error) {
      console.error('[Instrumentation] 恢复评估锁定状态失败:', error);
    }
  }
}