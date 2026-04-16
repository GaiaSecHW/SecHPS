/**
 * system-prompt-builder.ts
 * 构建注入到评估 System Prompt 的经验片段
 */

import { prisma } from '@/lib/prisma';

/** 预注入经验的最大数量 */
export const MAX_PRE_INJECTED = 3;

export interface InjectedExperienceSummary {
  id: string;
  title: string;
  errorCategory: string;
  hitCount: number;
}

export interface BuildExperienceResult {
  prompt: string;
  count: number;
  experiences: InjectedExperienceSummary[];
}

/**
 * 获取所有已注入的经验，构建 System Prompt 片段
 */
export async function buildExperiencePrompt(): Promise<string> {
  const result = await buildExperiencePromptWithMeta();
  return result.prompt;
}

/**
 * 同 buildExperiencePrompt，但同时返回注入的经验列表（用于日志/SSE）
 */
export async function buildExperiencePromptWithMeta(): Promise<BuildExperienceResult> {
  const experiences = await prisma.autonomousEvolutionExperience.findMany({
    where: { isInjected: true },
    orderBy: { hitCount: 'desc' },
    take: MAX_PRE_INJECTED,
  });

  if (experiences.length === 0) {
    console.log('[经验预注入] 无已标记注入的经验，跳过预注入');
    return { prompt: '', count: 0, experiences: [] };
  }

  console.log(`[经验预注入] ========== 预注入 Top ${experiences.length} 高频经验 ==========`);
  
  const lines: string[] = [
    '## ⚠️ 已知执行经验（直接使用，跳过失败尝试）',
    '',
  ];

  for (let i = 0; i < experiences.length; i++) {
    const exp = experiences[i];
    let patterns: string[] = [];
    try { patterns = JSON.parse(exp.errorPatterns) as string[]; } catch { /* ignore */ }

    lines.push(`### ${exp.title}`);
    if (patterns.length > 0) {
      lines.push(`触发: ${patterns.join(' / ')}`);
    }
    lines.push(`直达方案: ${exp.directSolution}`);
    lines.push('');

    console.log(`[经验预注入] Top ${i + 1}: "${exp.title}"`);
    console.log(`[经验预注入]   - ID: ${exp.id}`);
    console.log(`[经验预注入]   - 分类: ${exp.errorCategory}`);
    console.log(`[经验预注入]   - 命中次数: ${exp.hitCount}`);
    console.log(`[经验预注入]   - 触发特征: ${patterns.join(', ') || '无'}`);
    console.log(`[经验预注入]   - 直达方案: ${exp.directSolution.substring(0, 50)}...`);
  }

  console.log(`[经验预注入] ========== 共预注入 ${experiences.length} 条经验 ==========`);
  console.log(`[经验预注入] 注入位置: System Prompt 开头（高关注度）`);

  return {
    prompt: lines.join('\n'),
    count: experiences.length,
    experiences: experiences.map(e => ({
      id: e.id,
      title: e.title,
      errorCategory: e.errorCategory,
      hitCount: e.hitCount,
    })),
  };
}
