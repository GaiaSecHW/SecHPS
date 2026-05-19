/**
 * system-token-tracker.ts
 * 系统级 Token 使用统计服务
 * 
 * 用于统计系统自身消耗的 Token（如 skill 创建、优化、自动进化等）
 * 使用虚拟的"系统项目"来记录这些消耗
 */

import { prisma } from '@/lib/prisma';

// 系统项目的固定 ID
export const SYSTEM_PROJECT_ID = 'system-00000000-0000-0000-0000-000000000001';
export const SYSTEM_USER_ID = 'system-00000000-0000-0000-0000-000000000000';

// 系统调用的类型
export type SystemCallType = 
  | 'skill-generate'      // Skill 生成
  | 'skill-optimize'      // Skill 优化
  | 'skill-test'          // Skill 测试
  | 'experience-gen'      // 自主进化经验生成
  | 'log-analysis'        // 日志分析
  | 'other';              // 其他

/**
 * 初始化系统项目和用户
 * 在首次统计 token 时调用
 */
export async function ensureSystemProject(): Promise<void> {
  try {
    // 检查系统用户是否存在
    const systemUser = await prisma.user.findUnique({
      where: { id: SYSTEM_USER_ID },
    });
    
    if (!systemUser) {
      // 创建系统用户
      await prisma.user.create({
        data: {
          id: SYSTEM_USER_ID,
          email: 'system@SecHPS.internal',
          username: 'system',
          passwordHash: '', // 系统用户不需要密码
          name: '系统',
          isActive: true,
          updatedAt: new Date(),
        },
      });
      console.log('[SystemTokenTracker] 创建系统用户');
    }
    
    // 检查系统项目是否存在
    const systemProject = await prisma.project.findUnique({
      where: { id: SYSTEM_PROJECT_ID },
    });
    
    if (!systemProject) {
      // 创建系统项目
      await prisma.project.create({
        data: {
          id: SYSTEM_PROJECT_ID,
          userId: SYSTEM_USER_ID,
          name: '系统消耗',
          displayName: '系统 Token 消耗统计',
          description: '用于统计系统自身消耗的 Token（如 Skill 创建、优化、自动进化等）',
          status: 'idle',
          updatedAt: new Date(),
        },
      });
      console.log('[SystemTokenTracker] 创建系统项目');
    }
  } catch (error) {
    console.error('[SystemTokenTracker] 初始化系统项目失败:', error);
  }
}

/**
 * 记录系统 Token 使用
 * 
 * @param callType - 调用类型
 * @param modelName - 模型名称
 * @param inputTokens - 输入 token 数
 * @param outputTokens - 输出 token 数
 * @param estimatedCost - 预估费用（人民币）
 * @param description - 描述（可选）
 * @param userId - 用户 ID（可选，默认为系统用户）
 * @param username - 用户名（可选）
 */
export async function trackSystemTokenUsage(
  callType: SystemCallType,
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  estimatedCost: number = 0,
  description?: string,
  userId?: string,
  username?: string
): Promise<void> {
  try {
    // 确保系统项目存在
    await ensureSystemProject();
    
    // 记录到 TokenUsage 表
    await prisma.tokenUsage.create({
      data: {
        id: `token-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        userId: userId || SYSTEM_USER_ID,
        username: username || 'system',
        evaluationId: null, // 系统调用没有评估 ID
        projectId: SYSTEM_PROJECT_ID,
        apiProvider: 'system',
        modelName,
        callType,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cachedTokens: 0,
        requestStartedAt: new Date(),
        requestCompletedAt: new Date(),
        estimatedCost,
        status: 'success',
        errorMessage: null,
      },
    });
    
    console.log('[SystemTokenTracker] 记录系统 Token:', {
      callType,
      modelName,
      inputTokens,
      outputTokens,
      estimatedCost,
    });
  } catch (error) {
    console.error('[SystemTokenTracker] 记录 Token 使用失败:', error);
  }
}

/**
 * 从 API 响应中提取 Token 使用量
 * 
 * @param response - API 响应对象（Claude 或 OpenAI 格式）
 * @returns Token 使用量或 null
 */
export function extractTokenUsageFromResponse(response: any): {
  inputTokens: number;
  outputTokens: number;
} | null {
  try {
    if (!response || !response.usage) {
      return null;
    }
    
    const usage = response.usage;
    
    // Claude API 格式：input_tokens, output_tokens
    if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
      return {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
      };
    }
    
    // OpenAI 格式：prompt_tokens, completion_tokens
    if (usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined) {
      return {
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
      };
    }
    
    // 嵌套在 choices 中
    if (response.choices?.[0]?.usage) {
      const choiceUsage = response.choices[0].usage;
      if (choiceUsage.prompt_tokens !== undefined || choiceUsage.completion_tokens !== undefined) {
        return {
          inputTokens: choiceUsage.prompt_tokens || 0,
          outputTokens: choiceUsage.completion_tokens || 0,
        };
      }
    }
    
    console.warn('[SystemTokenTracker] 未知的 usage 格式:', usage);
    return null;
  } catch (error) {
    console.error('[SystemTokenTracker] 提取 Token 使用量失败:', error);
    return null;
  }
}

/**
 * 计算费用（人民币）
 * 使用统一的定价：输入 ¥6/百万，输出 ¥22/百万
 */
export function calculateSystemCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * 6;
  const outputCost = (outputTokens / 1_000_000) * 22;
  return inputCost + outputCost;
}