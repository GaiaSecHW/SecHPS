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
 */
export async function copySkillMdToClipboard(skill: SkillExportData): Promise<void> {
  // 检查是否在浏览器环境中
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    logger.warn(LOG_MODULES.SKILL, 'copySkillMdToClipboard 仅在浏览器环境中可用');
    return;
  }

  const skillMd = generateSkillMd(skill);
  await navigator.clipboard.writeText(skillMd);
}
