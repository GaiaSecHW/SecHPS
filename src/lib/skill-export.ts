/**
 * Skill 导出工具
 * 将 Skill 数据打包为 .skill 文件格式
 * Skill 现在存储为完整的 Markdown 内容
 */

export interface SkillExportData {
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe?: string | null;  // 允许 null
  severity: string;
  content: string;  // 完整的 Markdown 内容
}

/**
 * 生成 SKILL.md 内容
 * 直接返回 content 字段
 */
export function generateSkillMd(skill: SkillExportData): string {
  return skill.content || '';
}

/**
 * 导出为 .md 文件
 */
export async function exportAsSkillFile(skill: SkillExportData): Promise<void> {
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
 * 复制 SKILL.md 到剪贴板
 */
export async function copySkillMdToClipboard(skill: SkillExportData): Promise<void> {
  const skillMd = generateSkillMd(skill);
  await navigator.clipboard.writeText(skillMd);
}
