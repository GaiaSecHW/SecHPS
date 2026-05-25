/**
 * Context Window 自动更新工具
 *
 * 当 API 调用因 token 超限报错时，自动解析错误并更新数据库的 contextWindow
 */

import { prisma } from '@/lib/prisma';
import { parseContextWindowFromError } from '@/lib/error-parser';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 从错误中提取 contextWindow 并更新数据库
 * 
 * @param modelConfigId - ModelConfig 的 ID
 * @param error - API 错误对象或字符串
 * @returns 更新后的 contextWindow 值，如果无法解析则返回 null
 */
export async function updateContextWindowFromError(
  modelConfigId: string,
  error: Error | string | any
): Promise<number | null> {
  // 解析错误提取 contextWindow
  const contextWindow = parseContextWindowFromError(error);
  
  if (!contextWindow) {
    logger.info(LOG_MODULES.MODEL, '无法从错误中提取 contextWindow');
    return null;
  }
  
  logger.info(LOG_MODULES.MODEL, `从错误中提取 contextWindow: ${contextWindow}`);
  
  try {
    // 更新数据库
    const updated = await prisma.modelConfig.update({
      where: { id: modelConfigId },
      data: {
        contextWindow,
        updatedAt: new Date(),
      },
    });
    
    logger.info(LOG_MODULES.MODEL, `已更新 ModelConfig ${modelConfigId} 的 contextWindow 为 ${updated.contextWindow}`);
    return updated.contextWindow;
  } catch (dbError) {
    logger.error(LOG_MODULES.MODEL, '更新数据库失败', { details: { error: dbError instanceof Error ? dbError.message : String(dbError) } });
    return null;
  }
}

/**
 * 检查错误是否为 context 超限错误
 */
export function isContextOverflowError(error: Error | string | any): boolean {
  const errorStr = typeof error === 'string' 
    ? error 
    : (error?.message || error?.error?.message || error?.error || JSON.stringify(error));
  
  if (!errorStr || typeof errorStr !== 'string') return false;
  
  // 检测 context 超限相关的关键词
  const keywords = [
    'context length',
    'context window',
    'token limit',
    'max context',
    'too long',
    'overflow',
  ];
  
  return keywords.some(kw => errorStr.toLowerCase().includes(kw.toLowerCase()));
}