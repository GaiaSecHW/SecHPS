// src/lib/workflow-actions/index.ts

/**
 * 工作流动作执行器
 * 提供各种动作的真实执行能力
 */

import type { ExecutionContext } from '@/types/workflow';

// ============ 类型定义 ============

/**
 * 动作执行结果
 */
export interface ActionResult {
  success: boolean;
  output: unknown;
  error?: string;
  duration: number;
  logs?: string[];
}

/**
 * API 调用配置
 */
export interface ApiCallConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  auth?: {
    type: 'bearer' | 'basic' | 'api-key';
    token?: string;
    username?: string;
    password?: string;
    key?: string;
    header?: string;
  };
}

/**
 * AI 处理配置
 */
export interface AiProcessConfig {
  provider?: 'claude' | 'openai' | 'ccr-proxy';
  model?: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  inputMapping?: Record<string, string>;
  outputParsing?: 'json' | 'text' | 'markdown';
}

/**
 * 文件操作配置
 */
export interface FileOperationConfig {
  operation: 'read' | 'write' | 'append' | 'delete' | 'list' | 'exists' | 'mkdir' | 'rmdir';
  path: string;
  content?: string | Buffer;
  encoding?: 'utf-8' | 'binary' | 'json';
  recursive?: boolean;
}

/**
 * 脚本执行配置
 */
export interface ScriptExecuteConfig {
  language: 'javascript' | 'typescript';
  code: string;
  timeout?: number;
  memory?: number;
  input?: unknown;
}

/**
 * 条件评估配置
 */
export interface ConditionEvaluateConfig {
  expression: string;
  variables: Record<string, unknown>;
  allowedFunctions?: string[];
}

/**
 * 数据转换配置
 */
export interface TransformConfig {
  type: 'jsonpath' | 'jq' | 'template' | 'script';
  expression: string;
  input: unknown;
}

// ============ 执行器接口 ============

/**
 * 动作执行器接口
 */
export interface ActionExecutor<TConfig = unknown> {
  name: string;
  execute(config: TConfig, context: ExecutionContext): Promise<ActionResult>;
  validate(config: TConfig): boolean;
}

// ============ 辅助函数 ============

/**
 * 替换变量占位符
 * 支持 ${variable} 和 {{variable}} 语法
 */
export function replaceVariables(
  template: string,
  variables: Record<string, unknown>
): string {
  return template
    .replace(/\$\{([^}]+)\}/g, (_, key) => {
      const value = getNestedValue(variables, key);
      return value !== undefined ? String(value) : '';
    })
    .replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const value = getNestedValue(variables, key);
      return value !== undefined ? String(value) : '';
    });
}

/**
 * 获取嵌套对象值
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * 安全的 JSON 解析
 */
export function safeJsonParse(str: string, defaultValue: unknown = null): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

// 导出执行器
export { executeApiCall } from './api-executor';
export { executeAiProcess } from './ai-executor';
export { executeFileOperation } from './file-executor';
export { executeScript } from './script-executor';
export { evaluateCondition } from './condition-evaluator';
export { executeTransform } from './transform-executor';
