// src/lib/workflow-actions/script-executor.ts

import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, ScriptExecuteConfig } from './index';

/**
 * 执行脚本（安全沙箱）
 */
export async function executeScript(
  config: ScriptExecuteConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    logs.push(`[Script] Language: ${config.language}`);
    logs.push(`[Script] Timeout: ${config.timeout || 5000}ms`);

    // 安全检查：禁止危险操作
    const dangerousPatterns = [
      /require\s*\(\s*['"]child_process['"]\s*\)/,
      /require\s*\(\s*['"]fs['"]\s*\)/,
      /process\.exit/,
      /eval\s*\(/,
      /Function\s*\(/,
      /import\s+.*from\s+['"]child_process['"]/,
      /import\s+.*from\s+['"]fs['"]/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(config.code)) {
        return {
          success: false,
          output: null,
          error: '脚本包含不允许的操作',
          duration: Date.now() - startTime,
          logs,
        };
      }
    }

    let output: unknown;

    if (config.language === 'javascript' || config.language === 'typescript') {
      output = await executeJavaScript(config, context.variables, logs);
    } else {
      return {
        success: false,
        output: null,
        error: `不支持的语言: ${config.language}`,
        duration: Date.now() - startTime,
        logs,
      };
    }

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[Script] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : '脚本执行失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

/**
 * 执行 JavaScript（使用隔离环境）
 */
async function executeJavaScript(
  config: ScriptExecuteConfig,
  variables: Record<string, unknown>,
  logs: string[]
): Promise<unknown> {
  // 准备输入变量
  const inputJson = JSON.stringify(config.input || variables);

  // 构建安全的执行代码
  const wrappedCode = `
    (function() {
      // 提供安全的全局变量
      const input = ${inputJson};
      const variables = ${inputJson};
      const console = {
        log: function(...args) { return JSON.stringify({ logs: args }); },
        error: function(...args) { return JSON.stringify({ error: args }); },
        warn: function(...args) { return JSON.stringify({ warn: args }); }
      };

      // 用户代码
      ${config.code}

      // 返回结果（如果代码定义了 result 变量）
      if (typeof result !== 'undefined') {
        return result;
      }
      return { executed: true };
    })()
  `;

  // 使用 Node.js 执行（带超时）
  const timeout = config.timeout || 5000;

  try {
    // 使用 vm 模块创建隔离环境
    const vm = await import('vm');
    const context = vm.createContext({
      input: JSON.parse(inputJson),
      variables: JSON.parse(inputJson),
      console: {
        log: (...args: unknown[]) => logs.push(`[Script] ${args.map(a => JSON.stringify(a)).join(' ')}`),
        error: (...args: unknown[]) => logs.push(`[Script] ERROR: ${args.map(a => JSON.stringify(a)).join(' ')}`),
        warn: (...args: unknown[]) => logs.push(`[Script] WARN: ${args.map(a => JSON.stringify(a)).join(' ')}`),
      },
      JSON,
      Math,
      Date,
      Object,
      Array,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      TypeError,
      SyntaxError,
    });

    const script = new vm.Script(wrappedCode, { timeout });
    const result = script.runInContext(context, { timeout });

    logs.push(`[Script] Execution completed`);
    return result;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new Error(`脚本执行超时 (${timeout}ms)`);
      }
      throw error;
    }
    throw new Error('脚本执行失败');
  }
}

/**
 * 验证脚本配置
 */
export function validateScriptConfig(config: ScriptExecuteConfig): boolean {
  if (!config.code) return false;
  if (!['javascript', 'typescript'].includes(config.language)) return false;
  return true;
}
