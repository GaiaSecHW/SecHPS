// src/lib/workflow-actions/ai-executor.ts

import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, AiProcessConfig, replaceVariables, getNestedValue, safeJsonParse } from './index';
import { createClaudeAgentService } from '@/services/ai';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 执行 AI 处理
 */
export async function executeAiProcess(
  config: AiProcessConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return {
        success: false,
        output: null,
        error: '模型配置不存在，请先配置 AI 模型',
        duration: Date.now() - startTime,
        logs,
      };
    }

    logs.push(`[AI] Provider: ${modelConfig.providerType}`);
    logs.push(`[AI] Model: ${config.model || modelConfig.defaultModel}`);

    // 构建提示词
    let prompt = replaceVariables(config.prompt, context.variables);

    // 处理输入映射
    if (config.inputMapping) {
      for (const [key, path] of Object.entries(config.inputMapping)) {
        const value = getNestedValue(context.variables, path);
        if (value !== undefined) {
          prompt = prompt.replace(`{${key}}`, JSON.stringify(value));
        }
      }
    }

    logs.push(`[AI] Prompt length: ${prompt.length} chars`);

    // 添加系统提示
    if (config.systemPrompt) {
      prompt = `System: ${config.systemPrompt}\n\n---\n\nHuman: ${prompt}`;
    }

    // 创建 Claude Agent Service
    const service = createClaudeAgentService({
      apiKey: modelConfig.apiKey,
      model: config.model || modelConfig.defaultModel || 'claude-sonnet-4-20250514',
      maxTokens: config.maxTokens || 4096,
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash', 'Skill'],
    });

    // 调用 AI
    let responseText = '';
    await new Promise<void>((resolve, reject) => {
      service.sendPrompt(prompt, {
        onChunk: (text) => {
          responseText += text;
        },
        onComplete: () => {
          resolve();
        },
        onError: (error) => {
          reject(error);
        },
      });
    });

    logs.push(`[AI] Response length: ${responseText.length} chars`);

    // 解析输出
    let output: unknown = responseText;
    if (config.outputParsing === 'json') {
      output = safeJsonParse(responseText, responseText);
    }

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[AI] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    logger.error(LOG_MODULES.WORKFLOW, 'AI处理失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'AI 处理失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

/**
 * 获取模型配置
 */
async function getModelConfig(): Promise<{
  providerType: string;
  apiKey: string;
  apiBaseUrl: string;
  defaultModel?: string;
} | null> {
  // 从数据库获取
  try {
    const { prisma } = await import('@/lib/prisma');
    const config = await prisma.modelConfig.findFirst({
      where: { isActive: true, isDefault: true },
    });

    if (config) {
      return {
        providerType: config.providerType,
        apiKey: config.apiKey,
        apiBaseUrl: config.apiBaseUrl,
        defaultModel: JSON.parse(config.models)[0] || 'claude-sonnet-4-20250514',
      };
    }
  } catch {
    // 忽略数据库错误
  }

  return null;
}

/**
 * 验证 AI 处理配置
 */
export function validateAiProcessConfig(config: AiProcessConfig): boolean {
  if (!config.prompt) return false;
  return true;
}
