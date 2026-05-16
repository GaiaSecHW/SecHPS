import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import { gitSkillSync } from '@/services/git-skill-sync';

const DEFAULT_CATEGORY_ID = 'cat-code-audit';

function parseSkillMarkdown(content: string): { name: string; displayName: string; description: string; cwe?: string } | null {
  try {
    let name = '';
    let description = '';
    let bodyContent = content;

    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const nameMatch = frontmatter.match(/name:\s*(.+)/);
      const descMatch = frontmatter.match(/description:\s*(?:\n([\s\S]*?)\n\s*\S|$)|description:\s*(.+)/);
      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1] ? descMatch[1].trim() : (descMatch[2] ? descMatch[2].trim() : '');
      bodyContent = content.substring(frontmatterMatch[0].length);
    }

    const titleMatch = bodyContent.match(/^#\s+(.+)\s*\n/);
    let displayName = titleMatch ? titleMatch[1].trim() : '';

    if (!name) {
      const firstLine = bodyContent.split('\n')[0];
      name = firstLine.replace(/^#\s+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || 'imported-skill';
    }
    if (!displayName) displayName = name;
    if (!description) {
      const lines = bodyContent.split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('>')) {
          description = line.substring(0, 200);
          break;
        }
      }
      if (!description) description = displayName;
    }

    const cweMatch = content.match(/CWE-(\d+)/i);
    return { name, displayName, description, cwe: cweMatch ? `CWE-${cweMatch[1]}` : undefined };
  } catch {
    return null;
  }
}

export async function syncSkillsFromHarness(
  filesMap: Map<string, Buffer>,
  userId: string,
  tenantId: string | null,
): Promise<void> {
  // 找所有 skills/{skillName}/SKILL.md 路径
  const skillEntries: { skillName: string; skillMdContent: string; skillFiles: Map<string, Buffer> }[] = [];

  for (const [filePath, content] of filesMap.entries()) {
    const normalized = filePath.replace(/\\/g, '/');
    const match = normalized.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i);
    if (!match) continue;

    const skillName = match[1];
    const skillMdContent = content.toString('utf-8');

    // 收集该技能文件夹下的所有文件
    const prefix = normalized.substring(0, normalized.indexOf(`skills/${skillName}/`)) + `skills/${skillName}/`;
    const skillFiles = new Map<string, Buffer>();
    for (const [p, buf] of filesMap.entries()) {
      const np = p.replace(/\\/g, '/');
      if (np.toLowerCase().startsWith(prefix.toLowerCase())) {
        skillFiles.set(np.substring(prefix.length), buf);
      }
    }

    skillEntries.push({ skillName, skillMdContent, skillFiles });
  }

  if (skillEntries.length === 0) return;

  console.log(`[SkillHarnessSync] 发现 ${skillEntries.length} 个 SKILL，开始同步`);

  for (const { skillName, skillMdContent, skillFiles } of skillEntries) {
    try {
      // 大小写不敏感去重
      const existing = await prisma.skill.findFirst({
        where: { name: { equals: skillName, mode: 'insensitive' }, userId },
      });
      if (existing) {
        console.log(`[SkillHarnessSync] 跳过已存在的 SKILL: ${skillName}`);
        continue;
      }

      const parsed = parseSkillMarkdown(skillMdContent);
      if (!parsed) {
        console.error(`[SkillHarnessSync] 解析 SKILL.md 失败: ${skillName}`);
        continue;
      }

      const skill = await prisma.skill.create({
        data: {
          id: generateId('skill'),
          name: skillName,
          displayName: parsed.displayName,
          description: parsed.description,
          content: skillMdContent,
          categoryId: DEFAULT_CATEGORY_ID,
          cwe: parsed.cwe || null,
          userId,
          tenantId,
          isPublic: false,
          isBuiltin: false,
          version: 1,
          isLatest: true,
          updatedAt: new Date(),
        },
      });

      const gitResult = await gitSkillSync.uploadSkill(skillName, skillFiles);
      if (!gitResult.success) {
        console.error(`[SkillHarnessSync] Git 上传 SKILL 失败: ${skillName}`, gitResult.errors);
      }

      console.log(`[SkillHarnessSync] 成功创建 SKILL: ${skillName} (id: ${skill.id})`);
    } catch (err) {
      console.error(`[SkillHarnessSync] 处理 SKILL ${skillName} 失败:`, err);
    }
  }
}
