// src/lib/workflow-actions/transform-executor.ts

import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, TransformConfig, getNestedValue } from './index';

/**
 * 执行数据转换
 */
export async function executeTransform(
  config: TransformConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    logs.push(`[Transform] Type: ${config.type}`);
    logs.push(`[Transform] Expression: ${config.expression}`);

    let output: unknown;

    switch (config.type) {
      case 'jsonpath':
        output = executeJsonPath(config.expression, config.input, logs);
        break;

      case 'jq':
        output = executeJqLike(config.expression, config.input, logs);
        break;

      case 'template':
        output = executeTemplate(config.expression, config.input, context.variables, logs);
        break;

      case 'script':
        output = await executeTransformScript(config.expression, config.input, context.variables, logs);
        break;

      default:
        return {
          success: false,
          output: null,
          error: `不支持的转换类型: ${config.type}`,
          duration: Date.now() - startTime,
          logs,
        };
    }

    logs.push(`[Transform] Completed`);

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[Transform] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : '数据转换失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

/**
 * JSONPath 查询（简化实现）
 * 支持 $.store.book[0].title, $.store.book[*].author 等
 */
function executeJsonPath(expression: string, input: unknown, logs: string[]): unknown {
  logs.push(`[Transform] JSONPath query: ${expression}`);

  // 移除 $ 前缀
  let path = expression.replace(/^\$\.?/, '');

  if (!path) {
    return input;
  }

  // 分割路径
  const parts = path.split(/\.|\[|\]/).filter(Boolean);
  let current: unknown = input;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // 处理通配符
    if (part === '*') {
      if (Array.isArray(current)) {
        return current;
      }
      if (typeof current === 'object') {
        return Object.values(current as Record<string, unknown>);
      }
      return undefined;
    }

    // 处理数组索引
    const index = parseInt(part, 10);
    if (!isNaN(index)) {
      if (Array.isArray(current)) {
        current = current[index];
      } else {
        return undefined;
      }
    } else {
      // 处理对象属性
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
  }

  return current;
}

/**
 * jq 风格转换（简化实现）
 * 支持 .key, .[], map, select, sort, reverse, unique 等
 */
function executeJqLike(expression: string, input: unknown, logs: string[]): unknown {
  logs.push(`[Transform] jq-like expression: ${expression}`);

  let current: unknown = input;
  const tokens = expression.split('|').map(t => t.trim());

  for (const token of tokens) {
    if (!token || token === '.') {
      continue;
    }

    // 属性访问
    if (token.startsWith('.')) {
      const path = token.slice(1);
      current = executeJsonPath(`$.${path}`, current, logs);
      continue;
    }

    // 数组操作
    if (token === '[]' || token === '.[]') {
      if (Array.isArray(current)) {
        current = current.flat();
      }
      continue;
    }

    // map
    if (token.startsWith('map(')) {
      const inner = token.match(/map\((.+)\)/)?.[1];
      if (inner && Array.isArray(current)) {
        current = current.map(item => executeJsonPath(`$.${inner}`, item, logs));
      }
      continue;
    }

    // select
    if (token.startsWith('select(')) {
      const condition = token.match(/select\((.+)\)/)?.[1];
      if (condition && Array.isArray(current)) {
        current = current.filter(item => evaluateSimpleCondition(item, condition));
      }
      continue;
    }

    // sort
    if (token === 'sort' || token.startsWith('sort(')) {
      if (Array.isArray(current)) {
        current = [...current].sort((a, b) => {
          if (typeof a === 'number' && typeof b === 'number') {
            return a - b;
          }
          return String(a).localeCompare(String(b));
        });
      }
      continue;
    }

    // reverse
    if (token === 'reverse') {
      if (Array.isArray(current)) {
        current = [...current].reverse();
      }
      continue;
    }

    // unique
    if (token === 'unique') {
      if (Array.isArray(current)) {
        current = [...new Set(current.map((item: any) => JSON.stringify(item)))].map((item: string) => JSON.parse(item));
      }
      continue;
    }

    // length
    if (token === 'length') {
      if (Array.isArray(current)) {
        current = current.length;
      } else if (typeof current === 'string') {
        current = current.length;
      } else if (typeof current === 'object') {
        current = Object.keys(current || {}).length;
      }
      continue;
    }

    // keys
    if (token === 'keys') {
      if (typeof current === 'object' && current !== null) {
        current = Object.keys(current);
      }
      continue;
    }

    // values
    if (token === 'values') {
      if (typeof current === 'object' && current !== null) {
        current = Object.values(current);
      }
      continue;
    }
  }

  return current;
}

/**
 * 模板转换
 * 支持 ${variable}, {{variable}} 语法
 */
function executeTemplate(
  template: string,
  input: unknown,
  variables: Record<string, unknown>,
  logs: string[]
): unknown {
  logs.push(`[Transform] Template processing`);

  const allVariables = { ...variables, input, $: input };

  let result = template;

  // 替换 ${variable}
  result = result.replace(/\$\{([^}]+)\}/g, (_, path) => {
    const value = getNestedValue(allVariables, path);
    return value !== undefined ? String(value) : '';
  });

  // 替换 {{variable}}
  result = result.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const value = getNestedValue(allVariables, path);
    return value !== undefined ? String(value) : '';
  });

  return result;
}

/**
 * 脚本转换
 */
async function executeTransformScript(
  code: string,
  input: unknown,
  variables: Record<string, unknown>,
  logs: string[]
): Promise<unknown> {
  logs.push(`[Transform] Script execution`);

  const vm = await import('vm');

  const context = vm.createContext({
    input,
    variables,
    $: input,
    output: null,
    JSON,
    Object,
    Array,
    String,
    Number,
    Math,
    Date,
  });

  const wrappedCode = `
    ${code}
    output;
  `;

  const script = new vm.Script(wrappedCode, { timeout: 5000 } as any);
  return script.runInContext(context, { timeout: 5000 } as any);
}

/**
 * 简单条件评估
 */
function evaluateSimpleCondition(item: unknown, condition: string): boolean {
  // 支持 .property == value 格式
  const comparisonMatch = condition.match(/\.?\s*(\w+)\s*(===|==|!=|!==|>=|<=|>|<)\s*(.+)/);
  if (comparisonMatch) {
    const [, prop, op, valueStr] = comparisonMatch;
    const itemValue = typeof item === 'object' && item !== null
      ? (item as Record<string, unknown>)[prop]
      : undefined;

    let compareValue: unknown = valueStr.trim();
    const compareStr = String(compareValue);
    if (compareStr.startsWith('"') || compareStr.startsWith("'")) {
      compareValue = compareStr.slice(1, -1);
    } else if (!isNaN(Number(compareStr))) {
      compareValue = Number(compareStr);
    } else if (compareStr === 'true') {
      compareValue = true;
    } else if (compareStr === 'false') {
      compareValue = false;
    }

    switch (op) {
      case '===':
      case '==':
        return itemValue === compareValue;
      case '!==':
      case '!=':
        return itemValue !== compareValue;
      case '>=':
        return Number(itemValue) >= Number(compareValue);
      case '<=':
        return Number(itemValue) <= Number(compareValue);
      case '>':
        return Number(itemValue) > Number(compareValue);
      case '<':
        return Number(itemValue) < Number(compareValue);
    }
  }

  return true;
}

/**
 * 验证转换配置
 */
export function validateTransformConfig(config: TransformConfig): boolean {
  if (!config.expression) return false;
  if (!['jsonpath', 'jq', 'template', 'script'].includes(config.type)) return false;
  return true;
}
