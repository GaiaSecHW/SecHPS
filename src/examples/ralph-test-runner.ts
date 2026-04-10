// src/examples/ralph-test-runner.ts
//
// 示例：使用 Ralph Loop Agent 运行测试并确保通过
//
// 场景：让 AI 执行测试套件，修复失败的测试，直到所有测试通过
// 完成条件：
//   1. 输出包含"所有测试通过"或 "All tests passed"
//   2. 或者测试通过率达到 100%
//   3. 或者迭代次数达到上限

import { createRalphLoopAgent } from '@/services/evaluation';
import type { RalphLoopAgentCallbacks, VerifyCompletionFunction } from '@/services/evaluation';

// ─────────────────────────────────────────────
// 测试完成验证函数
// ─────────────────────────────────────────────

const TEST_PASS_KEYWORDS = [
  '所有测试通过',
  '测试全部通过',
  'all tests passed',
  'tests passed',
  '0 failed',
  '0 failures',
  'PASS',
  '✓ all',
];

const TEST_FAIL_PATTERNS = [
  /(\d+)\s*(failed|failures|failing)/i,
  /failed:\s*(\d+)/i,
  /FAIL\s+\d+/i,
];

/**
 * 解析测试结果：从输出文本中提取测试统计
 */
function parseTestResults(text: string): {
  passed: number;
  failed: number;
  total: number;
} | null {
  // 尝试匹配常见测试输出格式
  // 例如: "15 passed, 2 failed" 或 "Tests: 15 passed, 2 failed"
  const match = text.match(/(\d+)\s*passed[,\s]+(\d+)\s*failed/i);
  if (match) {
    const passed = parseInt(match[1]);
    const failed = parseInt(match[2]);
    return { passed, failed, total: passed + failed };
  }

  // 例如: "Results: 10/12 tests passed"
  const match2 = text.match(/(\d+)\/(\d+)\s*tests?\s*passed/i);
  if (match2) {
    const passed = parseInt(match2[1]);
    const total = parseInt(match2[2]);
    return { passed, failed: total - passed, total };
  }

  return null;
}

const verifyTestCompletion: VerifyCompletionFunction = ({
  result,
  iteration,
  originalPrompt,
}) => {
  const text = result.text;
  const lower = text.toLowerCase();

  // 1. 检查完成关键词
  for (const kw of TEST_PASS_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      return { complete: true, reason: `检测到测试通过信号："${kw}"` };
    }
  }

  // 2. 解析测试统计
  const stats = parseTestResults(text);
  if (stats) {
    if (stats.failed === 0 && stats.passed > 0) {
      return {
        complete: true,
        reason: `所有 ${stats.passed} 个测试通过，0 失败`,
      };
    }
    if (stats.failed > 0) {
      return {
        complete: false,
        reason: `检测到 ${stats.failed} 个失败测试（共 ${stats.total} 个）。请修复这些失败的测试用例。第 ${iteration} 次迭代。`,
      };
    }
  }

  // 3. 检查是否有明显的失败信号
  for (const pattern of TEST_FAIL_PATTERNS) {
    if (pattern.test(text)) {
      const match = text.match(pattern);
      return {
        complete: false,
        reason: `检测到测试失败：${match?.[0]}。请分析失败原因并修复。`,
      };
    }
  }

  // 4. 未检测到明确信号
  const feedbackMsg = buildTestFeedback(iteration, originalPrompt);
  return { complete: false, reason: feedbackMsg };
};

function buildTestFeedback(iteration: number, originalPrompt: string): string {
  if (iteration <= 3) {
    return `第 ${iteration} 次迭代。请运行测试套件，查看测试结果，并输出测试统计（通过数/失败数）。如果所有测试通过，请明确说明"所有测试通过"。`;
  }

  if (iteration <= 8) {
    return `第 ${iteration} 次迭代，尚未检测到明确的测试完成信号。
原始任务：${originalPrompt.slice(0, 200)}

请：
1. 运行完整测试套件
2. 输出每个测试的结果（通过/失败）
3. 如有失败，立即修复并重新运行
4. 所有测试通过后输出"所有测试通过"`;
  }

  return `第 ${iteration} 次迭代，接近上限。请立即输出当前测试状态（已通过 N 个，失败 M 个），并说明"测试完成"或"所有测试通过"。`;
}

// ─────────────────────────────────────────────
// 测试报告生成
// ─────────────────────────────────────────────

interface TestReport {
  success: boolean;
  iterations: number;
  completionReason: string;
  reason?: string;
  totalTokens: number;
  testsPassed?: number;
  testsFailed?: number;
  finalOutput: string;
}

// ─────────────────────────────────────────────
// 主函数
// ─────────────────────────────────────────────

interface RunTestSuiteOptions {
  evaluationId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  testCommand?: string; // 测试命令，如 "npm test" 或 "pytest"
  taskDescription: string;
  modelConfig: {
    providerType: string;
    apiKey: string;
    apiBaseUrl: string;
    models: string;
  };
  maxIterations?: number;
  onProgress?: (message: string) => void;
}

/**
 * 启动测试运行 Ralph Loop Agent
 *
 * @example
 * const report = await runTestSuite({
 *   evaluationId: 'eval-test-001',
 *   projectId: 'proj-202',
 *   projectName: 'api-service',
 *   projectPath: '/path/to/service',
 *   testCommand: 'npm test',
 *   taskDescription: '运行所有单元测试，修复失败的测试用例，直到所有测试通过',
 *   modelConfig: { ... },
 * });
 * console.log(report.success ? '✅ 全部测试通过' : '❌ 测试未全部通过');
 */
export async function runTestSuite(options: RunTestSuiteOptions): Promise<TestReport> {
  const {
    evaluationId,
    projectId,
    projectName,
    projectPath,
    testCommand = 'npm test',
    taskDescription,
    modelConfig,
    maxIterations = 10,
    onProgress,
  } = options;

  // 构建完整任务描述
  const fullTaskDescription = `${taskDescription}

测试命令：\`${testCommand}\`

要求：
1. 运行测试命令查看当前测试状态
2. 分析失败的测试用例，找出根本原因
3. 修复代码或测试用例（根据实际情况判断）
4. 重新运行测试，确认修复效果
5. 所有测试通过后，输出"所有测试通过"和测试统计`;

  const agent = createRalphLoopAgent(modelConfig, projectPath, {
    maxIterations,
    maxTokens: 120_000,
    maxCost: 6.0,
    verifyCompletion: verifyTestCompletion,
    onIterationStart: (iter) => {
      const msg = `▶ 第 ${iter}/${maxIterations} 次测试迭代开始`;
      console.log(`[TestRunner] ${msg}`);
      onProgress?.(msg);
    },
    onIterationEnd: (iter, duration) => {
      const msg = `✓ 第 ${iter} 次迭代完成（${(duration / 1000).toFixed(1)}s）`;
      console.log(`[TestRunner] ${msg}`);
      onProgress?.(msg);
    },
  });

  let finalOutput = '';

  const callbacks: RalphLoopAgentCallbacks = {
    onChunk: (text) => {
      finalOutput += text;
      process.stdout.write(text);
    },
    onToolCall: (name, params) => {
      if (name === 'Bash') {
        const cmd = (params.command as string) || '';
        console.log(`\n  🔧 执行命令: ${cmd.slice(0, 80)}`);
        onProgress?.(`执行: ${cmd.slice(0, 50)}...`);
      }
    },
    onToolResult: (name, r) => {
      console.log(`  📦 ${name}: ${r.success ? '✓' : '✗'}`);
    },
    onComplete: () => {},
    onError: (err) => {
      console.error('[TestRunner] ❌ 错误:', err.message);
      onProgress?.(`错误: ${err.message}`);
    },
    onRalphComplete: (r) => {
      const statusIcon = r.completionReason === 'verified' ? '✅' : '⚠️';
      const msg = `${statusIcon} Ralph 完成 - ${r.completionReason}（共 ${r.iterations} 次迭代）`;
      console.log(`\n[TestRunner] ${msg}`);
      onProgress?.(msg);
    },
  };

  const result = await agent.loop({
    evaluationId,
    projectId,
    context: {
      projectName,
      files: [],
      taskDescription: fullTaskDescription,
      initialMessage: fullTaskDescription,
    },
    callbacks,
  });

  // 尝试从最终输出中解析测试统计
  const testStats = parseTestResults(finalOutput);

  return {
    success: result.completionReason === 'verified',
    iterations: result.iterations,
    completionReason: result.completionReason,
    reason: result.reason,
    totalTokens: result.totalUsage.totalTokens,
    testsPassed: testStats?.passed,
    testsFailed: testStats?.failed,
    finalOutput,
  };
}

/**
 * 格式化测试报告（用于日志或展示）
 */
export function formatTestReport(report: TestReport): string {
  const lines = [
    '═══════════════════════════════════════════',
    '  Ralph Loop Agent - 测试运行报告',
    '═══════════════════════════════════════════',
    `  状态: ${report.success ? '✅ 成功' : '❌ 未完成'}`,
    `  完成方式: ${report.completionReason}`,
    report.reason ? `  说明: ${report.reason}` : '',
    `  迭代次数: ${report.iterations}`,
    `  Token 用量: ${report.totalTokens.toLocaleString()}`,
    report.testsPassed !== undefined ? `  测试通过: ${report.testsPassed}` : '',
    report.testsFailed !== undefined ? `  测试失败: ${report.testsFailed}` : '',
    '═══════════════════════════════════════════',
  ].filter(Boolean);

  return lines.join('\n');
}
