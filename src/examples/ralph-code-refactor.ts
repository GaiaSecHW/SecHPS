// src/examples/ralph-code-refactor.ts
//
// 示例：使用 Ralph Loop Agent 进行代码重构任务
//
// 场景：对项目代码进行重构，直到重构完成并通过验证
// 完成条件：
//   1. AI 输出包含"重构完成"关键词
//   2. 或者修改的文件数量达到预期
//   3. 或者代码质量评分达到阈值

import { createRalphLoopAgent } from '@/services/evaluation';
import type { RalphLoopAgentCallbacks, VerifyCompletionFunction } from '@/services/evaluation';

// ─────────────────────────────────────────────
// 验证函数：代码重构完成检测
// ─────────────────────────────────────────────

const REFACTOR_DONE_KEYWORDS = [
  '重构完成',
  'refactoring complete',
  'refactor done',
  '代码已重构',
  '重构已完成',
  'REFACTOR_COMPLETE',
];

/**
 * 代码重构完成验证
 *
 * 策略：
 * 1. 关键词检测（最简单）
 * 2. 检测修改摘要（如包含多个文件的修改说明）
 * 3. 渐进式反馈（迭代越多，越强调完成信号）
 */
const verifyRefactorCompletion: VerifyCompletionFunction = ({
  result,
  iteration,
  originalPrompt,
}) => {
  const text = result.text;
  const lower = text.toLowerCase();

  // 1. 关键词检测
  for (const kw of REFACTOR_DONE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      return { complete: true, reason: `检测到重构完成信号："${kw}"` };
    }
  }

  // 2. 检测多文件修改摘要（重构通常涉及多个文件）
  const fileEditPattern = /已修改|已更新|edited|updated|modified/gi;
  const fileMatches = text.match(fileEditPattern);
  const hasMultipleEdits = fileMatches && fileMatches.length >= 3;

  // 检测是否有明确的完成总结（包含"总结"或"summary"等词）
  const hasSummary = lower.includes('总结') || lower.includes('summary') || lower.includes('完成说明');

  if (hasMultipleEdits && hasSummary) {
    return {
      complete: true,
      reason: `检测到多文件修改（${fileMatches!.length} 处）且包含完成总结`,
    };
  }

  // 3. 未完成 - 渐进式反馈
  const feedback = buildRefactorFeedback(iteration, originalPrompt, hasMultipleEdits ?? false);
  return { complete: false, reason: feedback };
};

function buildRefactorFeedback(
  iteration: number,
  originalPrompt: string,
  hasPartialWork: boolean
): string {
  const baseMsg = hasPartialWork
    ? '检测到部分重构工作，但尚未完成。'
    : '尚未检测到有效的重构工作。';

  if (iteration === 1) {
    return `${baseMsg} 请开始分析代码并执行重构。完成后请输出"重构完成"并提供修改摘要。`;
  }

  if (iteration <= 5) {
    return `${baseMsg} 继续重构（第 ${iteration} 次迭代）。请确保：
1. 完成所有必要的代码修改
2. 保持功能不变
3. 完成后输出"重构完成"`;
  }

  if (iteration <= 10) {
    return `${baseMsg} 第 ${iteration} 次迭代。
原始任务片段：${originalPrompt.slice(0, 300)}
请立即完成剩余重构工作，并在最后明确说明"重构完成"。`;
  }

  return `第 ${iteration} 次迭代，接近上限。请立即输出当前重构结果摘要和"重构完成"。`;
}

// ─────────────────────────────────────────────
// 主函数
// ─────────────────────────────────────────────

interface RunCodeRefactorOptions {
  evaluationId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  taskDescription: string;
  targetFiles?: string[]; // 需要重构的目标文件（可选）
  modelConfig: {
    providerType: string;
    apiKey: string;
    apiBaseUrl: string;
    models: string;
  };
  maxIterations?: number;
}

/**
 * 启动代码重构 Ralph Loop Agent
 *
 * @example
 * const result = await runCodeRefactor({
 *   evaluationId: 'eval-789',
 *   projectId: 'proj-101',
 *   projectName: 'legacy-service',
 *   projectPath: '/path/to/service',
 *   taskDescription: '将所有 callback 回调函数重构为 async/await 风格，保持功能不变',
 *   modelConfig: { ... },
 * });
 */
export async function runCodeRefactor(options: RunCodeRefactorOptions) {
  const {
    evaluationId,
    projectId,
    projectName,
    projectPath,
    taskDescription,
    targetFiles = [],
    modelConfig,
    maxIterations = 12,
  } = options;

  // 构建完整任务描述（包含目标文件列表）
  let fullTaskDescription = taskDescription;
  if (targetFiles.length > 0) {
    fullTaskDescription += `\n\n目标文件：\n${targetFiles.map((f) => `- ${f}`).join('\n')}`;
  }

  const agent = createRalphLoopAgent(modelConfig, projectPath, {
    maxIterations,
    maxTokens: 200_000,
    maxCost: 10.0,
    verifyCompletion: verifyRefactorCompletion,
    onIterationStart: (iter) => {
      console.log(`[CodeRefactor] ▶ 第 ${iter} 次迭代开始`);
    },
    onIterationEnd: (iter, duration) => {
      console.log(`[CodeRefactor] ✓ 第 ${iter} 次迭代结束，耗时 ${(duration / 1000).toFixed(1)}s`);
    },
  });

  const iterationStats: Array<{ iteration: number; duration: number }> = [];

  const callbacks: RalphLoopAgentCallbacks = {
    onChunk: (text) => process.stdout.write(text),
    onToolCall: (name) => console.log(`\n  🔧 ${name}`),
    onToolResult: (name, r) => console.log(`  📦 ${name}: ${r.success ? '✓' : '✗'}`),
    onComplete: () => {},
    onError: (err) => console.error('[CodeRefactor] ❌', err.message),
    onRalphComplete: (r) => {
      console.log('\n═══════════════════════════════════');
      console.log('代码重构 Ralph Loop 完成');
      console.log(`  完成方式: ${r.completionReason === 'verified' ? '验证通过 ✓' : '达到上限 ⚠'}`);
      console.log(`  总迭代: ${r.iterations} 次`);
      console.log(`  总 Token: ${r.totalUsage.totalTokens.toLocaleString()}`);
      console.log('═══════════════════════════════════');
    },
  };

  const result = await agent.loop({
    evaluationId,
    projectId,
    context: {
      projectName,
      files: targetFiles.map((f) => ({ name: f, type: 'code', size: 0 })),
      taskDescription: fullTaskDescription,
      initialMessage: fullTaskDescription,
    },
    callbacks,
  });

  return {
    success: result.completionReason === 'verified',
    iterations: result.iterations,
    completionReason: result.completionReason,
    reason: result.reason,
    totalTokens: result.totalUsage.totalTokens,
    iterationStats,
  };
}
