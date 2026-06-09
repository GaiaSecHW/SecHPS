/**
 * Skill 导出工具
 * 将 Skill 数据打包为 .skill 文件格式
 * Skill 现在存储为完整的 Markdown 内容
 *
 * 注意：exportAsSkillFile 和 copySkillMdToClipboard 仅在浏览器环境中可用
 */

import { logger, LOG_MODULES } from '@/lib/logger';

export interface SkillExportData {
  name: string;
  displayName: string;
  description: string;
  techStackId?: string | null;
  vulnerabilityPatternId?: string | null;
  cwe?: string | null;
  severity: string;
  content: string;
}

/**
 * 通用文本复制函数
 * 支持多种环境的 fallback 方案，提供具体错误信息
 * 
 * @param text - 要复制的文本内容
 * @throws {Error} 包含具体错误信息的错误对象
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  // 检查是否在浏览器环境中
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('当前环境不支持复制功能：非浏览器环境');
  }
  
  // 尝试使用现代 Clipboard API
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '未知错误';
      
      // 检查是否是安全上下文问题
      if (!window.isSecureContext) {
        throw new Error(`复制失败：当前页面非安全上下文（HTTPS）。\nClipboard API 仅在 HTTPS 或 localhost 环境下可用。`);
      }
      
      // 检查是否是权限问题
      if (errorMsg.includes('Permission') || errorMsg.includes('denied')) {
        throw new Error(`复制失败：浏览器拒绝剪贴板访问权限。\n请在浏览器设置中允许剪贴板权限。`);
      }
      
      // 其他 Clipboard API 错误，尝试 fallback
      logger.warn(LOG_MODULES.SKILL, `Clipboard API 失败: ${errorMsg}，尝试 fallback 方案`);
    }
  }
  
  // Fallback: 使用 execCommand (兼容旧浏览器和 HTTP 环境)
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    
    textarea.focus();
    textarea.select();
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    
    if (!successful) {
      throw new Error('execCommand 复制命令执行失败');
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : '未知错误';
    throw new Error(`复制失败：所有复制方法均不可用。\n原因：${errorMsg}\n\n可能原因：
1. HTTP 环境（Clipboard API 仅支持 HTTPS）
2. iframe 未设置 allow="clipboard-write"
3. 浏览器阻止剪贴板访问`);
  }
}

/**
 * 生成 SKILL.md 内容
 * 直接返回 content 字段
 */
export function generateSkillMd(skill: SkillExportData): string {
  return skill.content || '';
}

/**
 * 导出为 .md 文件（仅浏览器环境）
 */
export async function exportAsSkillFile(skill: SkillExportData): Promise<void> {
  // 检查是否在浏览器环境中
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    logger.warn(LOG_MODULES.SKILL, 'exportAsSkillFile 仅在浏览器环境中可用');
    return;
  }

  // 生成 SKILL.md
  const skillMd = generateSkillMd(skill);

  // 直接下载为 .md 文件
  const blob = new Blob([skillMd], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${skill.name}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 复制 SKILL.md 到剪贴板（仅浏览器环境）
 * 支持多种环境的 fallback 方案
 * 
 * @throws {Error} 包含具体错误信息的错误对象
 */
export async function copySkillMdToClipboard(skill: SkillExportData): Promise<void> {
  // 检查是否在浏览器环境中
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('当前环境不支持复制功能：非浏览器环境');
  }

  const skillMd = generateSkillMd(skill);
  
  // 尝试使用现代 Clipboard API
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(skillMd);
      logger.info(LOG_MODULES.SKILL, '使用 Clipboard API 成功复制');
      return;
    } catch (err) {
      // Clipboard API 失败，可能是权限问题或不安全上下文
      const errorMsg = err instanceof Error ? err.message : '未知错误';
      
      // 检查是否是安全上下文问题
      if (!window.isSecureContext) {
        throw new Error(`复制失败：当前页面非安全上下文（HTTPS）。\nClipboard API 仅在 HTTPS 或 localhost 环境下可用。\n建议：请在浏览器中直接下载 .md 文件。`);
      }
      
      // 检查是否是权限问题
      if (errorMsg.includes('Permission') || errorMsg.includes('denied')) {
        throw new Error(`复制失败：浏览器拒绝剪贴板访问权限。\n请在浏览器设置中允许剪贴板权限，或使用下载功能。`);
      }
      
      // 其他 Clipboard API 错误，尝试 fallback
      logger.warn(LOG_MODULES.SKILL, `Clipboard API 失败: ${errorMsg}，尝试 fallback 方案`);
    }
  }
  
  // Fallback: 使用 execCommand (兼容旧浏览器和 HTTP 环境)
  try {
    const textarea = document.createElement('textarea');
    textarea.value = skillMd;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    
    // 选中文本
    textarea.focus();
    textarea.select();
    
    // 尝试复制
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    
    if (!successful) {
      throw new Error('execCommand 复制命令执行失败');
    }
    
    logger.info(LOG_MODULES.SKILL, '使用 execCommand fallback 成功复制');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : '未知错误';
    throw new Error(`复制失败：所有复制方法均不可用。\n原因：${errorMsg}\n\n建议解决方案：
1. 如果是 HTTP 环境，请切换到 HTTPS
2. 如果是 iframe，请添加 allow="clipboard-write" 属性
3. 如果浏览器阻止，请手动下载 .md 文件
4. 使用浏览器的下载功能代替复制`);
  }
}
