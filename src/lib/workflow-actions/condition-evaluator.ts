// src/lib/workflow-actions/condition-evaluator.ts

import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, ConditionEvaluateConfig, getNestedValue } from './index';

/**
 * 安全的条件表达式评估器
 */
export function evaluateCondition(
  expression: string,
  variables: Record<string, unknown>
): boolean {
  try {
    // 替换变量引用
    const processedExpression = replaceVariableReferences(expression, variables);

    // 安全评估表达式
    return safeEvaluate(processedExpression);
  } catch (error) {
    console.error('[Condition] Evaluation error:', error);
    return false;
  }
}

/**
 * 执行条件评估（作为工作流动作）
 */
export async function executeConditionEvaluate(
  config: ConditionEvaluateConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    logs.push(`[Condition] Expression: ${config.expression}`);

    const result = evaluateCondition(config.expression, {
      ...context.variables,
      ...config.variables,
    });

    logs.push(`[Condition] Result: ${result}`);

    return {
      success: true,
      output: { result, expression: config.expression },
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[Condition] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      output: { result: false },
      error: error instanceof Error ? error.message : '条件评估失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

/**
 * 替换变量引用
 * 支持 $variable、${variable}、{{variable}} 语法
 */
function replaceVariableReferences(
  expression: string,
  variables: Record<string, unknown>
): string {
  let result = expression;

  // 替换 ${variable} 和 {{variable}}
  result = result.replace(/\$\{([^}]+)\}/g, (_, path) => {
    const value = getNestedValue(variables, path);
    return formatValue(value);
  });

  result = result.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const value = getNestedValue(variables, path);
    return formatValue(value);
  });

  // 替换 $variable（简单变量名）
  result = result.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    const value = variables[name];
    return formatValue(value);
  });

  return result;
}

/**
 * 格式化值为表达式字符串
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * 安全评估表达式
 * 支持基本比较和逻辑运算
 */
function safeEvaluate(expression: string): boolean {
  // 清理表达式
  const cleaned = expression.trim();

  // 处理布尔字面量
  if (cleaned === 'true') return true;
  if (cleaned === 'false') return false;

  // 处理简单的比较表达式
  const comparisonOperators = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'];
  for (const op of comparisonOperators) {
    if (cleaned.includes(op)) {
      return evaluateComparison(cleaned, op);
    }
  }

  // 处理逻辑运算
  if (cleaned.includes('&&')) {
    const parts = cleaned.split('&&').map(p => p.trim());
    return parts.every(part => safeEvaluate(part));
  }

  if (cleaned.includes('||')) {
    const parts = cleaned.split('||').map(p => p.trim());
    return parts.some(part => safeEvaluate(part));
  }

  // 处理否定
  if (cleaned.startsWith('!')) {
    return !safeEvaluate(cleaned.slice(1).trim());
  }

  // 处理括号
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    return safeEvaluate(cleaned.slice(1, -1));
  }

  // 处理存在性检查
  if (cleaned.startsWith('exists ')) {
    const varName = cleaned.slice(7).trim();
    return varName !== 'null' && varName !== 'undefined';
  }

  // 处理包含检查
  if (cleaned.includes('includes')) {
    return evaluateIncludes(cleaned);
  }

  // 默认：尝试解析为布尔值
  try {
    const parsed = JSON.parse(cleaned);
    return Boolean(parsed);
  } catch {
    // 非空字符串视为 true
    return cleaned.length > 0;
  }
}

/**
 * 评估比较表达式
 */
function evaluateComparison(expression: string, operator: string): boolean {
  const [left, right] = expression.split(operator).map(s => s.trim());

  const leftValue = parseValue(left);
  const rightValue = parseValue(right);

  switch (operator) {
    case '===':
      return leftValue === rightValue;
    case '!==':
      return leftValue !== rightValue;
    case '==':
      // 宽松相等
      return leftValue == rightValue;
    case '!=':
      return leftValue != rightValue;
    case '>=':
      return Number(leftValue) >= Number(rightValue);
    case '<=':
      return Number(leftValue) <= Number(rightValue);
    case '>':
      return Number(leftValue) > Number(rightValue);
    case '<':
      return Number(leftValue) < Number(rightValue);
    default:
      return false;
  }
}

/**
 * 解析值
 */
function parseValue(str: string): unknown {
  const trimmed = str.trim();

  // 布尔值
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed === 'undefined') return undefined;

  // 数字
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // 字符串（带引号）
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // 其他情况作为字符串
  return trimmed;
}

/**
 * 评估包含表达式
 */
function evaluateIncludes(expression: string): boolean {
  // 处理 "array.includes(value)" 或 "string.includes(substring)"
  const match = expression.match(/(.+)\.includes\((.+)\)/);
  if (!match) return false;

  const [, target, value] = match;
  const targetValue = parseValue(target.trim());
  const searchValue = parseValue(value.trim());

  if (Array.isArray(targetValue)) {
    return targetValue.includes(searchValue);
  }

  if (typeof targetValue === 'string') {
    return targetValue.includes(String(searchValue));
  }

  return false;
}

/**
 * 验证条件配置
 */
export function validateConditionConfig(config: ConditionEvaluateConfig): boolean {
  if (!config.expression) return false;
  return true;
}
