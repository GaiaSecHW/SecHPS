/**
 * system-prompt-builder.ts
 * 构建注入到评估 System Prompt 的经验片段
 */

import { prisma } from '@/lib/prisma';

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
  });

  if (experiences.length === 0) {
    return { prompt: '', count: 0, experiences: [] };
  }

  const lines: string[] = [
    '## ⚠️ 已知执行经验（直接使用，跳过失败尝试）',
    '',
  ];

  for (const exp of experiences) {
    let patterns: string[] = [];
    try { patterns = JSON.parse(exp.errorPatterns) as string[]; } catch { /* ignore */ }

    lines.push(`### ${exp.title}`);
    if (patterns.length > 0) {
      lines.push(`触发: ${patterns.join(' / ')}`);
    }
    lines.push(`直达方案: ${exp.directSolution}`);
    lines.push('');
  }

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
