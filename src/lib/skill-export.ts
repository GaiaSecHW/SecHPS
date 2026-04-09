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
 * 导出为 .skill 文件（实际上是包含所有资源的目录结构）
 * 由于浏览器限制，我们导出为 ZIP 文件
 */
export async function exportAsSkillFile(skill: SkillExportData): Promise<void> {
  // 生成 SKILL.md
  const skillMd = generateSkillMd(skill);

  // 创建文件内容映射
  const files: Record<string, string> = {
    'SKILL.md': skillMd,
  };

  // 使用 JSZip 创建 ZIP 文件
  // 注意：需要安装 jszip: npm install jszip
  try {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // 添加文件到 ZIP
    Object.entries(files).forEach(([filename, content]) => {
      zip.file(filename, content);
    });

    // 生成 ZIP 文件
    const blob = await zip.generateAsync({ type: 'blob' });

    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${skill.name}.skill`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    // 如果 JSZip 不可用，回退到单独下载 SKILL.md
    console.warn('JSZip 不可用，回退到下载 SKILL.md');
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
}

/**
 * 复制 SKILL.md 到剪贴板
 */
export async function copySkillMdToClipboard(skill: SkillExportData): Promise<void> {
  const skillMd = generateSkillMd(skill);
  await navigator.clipboard.writeText(skillMd);
}
