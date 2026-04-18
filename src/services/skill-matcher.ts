import { prisma } from '@/lib/prisma';

/**
 * 根据漏洞类别和技术栈匹配 Skills
 * 
 * @param category - 漏洞类别（如 "sql-injection"）
 * @param techStack - 项目技术栈数组（如 ["typescript", "react"]）
 * @returns 匹配的 Skill ID 列表
 */
export async function matchSkillsByCategory(
  category: string,
  techStack: string[] | null
): Promise<string[]> {
  // 查询符合条件的 Skills
  const skills = await prisma.skill.findMany({
    where: {
      category,
      isActive: true,
      isLatest: true,
    },
    select: {
      id: true,
      techStack: true,
    },
  });

  // 如果没有技术栈要求，返回所有匹配的 Skill ID
  if (!techStack || techStack.length === 0) {
    return skills.map(skill => skill.id);
  }

  // 过滤技术栈匹配的 Skills
  const matchedSkillIds: string[] = [];

  for (const skill of skills) {
    // Skill 无技术栈 = 通用 Skill，适合所有项目
    if (!skill.techStack) {
      matchedSkillIds.push(skill.id);
      continue;
    }

    // 解析 Skill 的技术栈 JSON
    let skillTechStack: string[] = [];
    try {
      skillTechStack = JSON.parse(skill.techStack);
      if (!Array.isArray(skillTechStack)) {
        skillTechStack = [];
      }
    } catch {
      // JSON 解析失败，跳过此 Skill
      continue;
    }

    // Skill 无技术栈 = 通用 Skill
    if (skillTechStack.length === 0) {
      matchedSkillIds.push(skill.id);
      continue;
    }

    // 检查是否有匹配
    const hasMatch = skillTechStack.some(skillTech =>
      techStack.some(projectTech =>
        skillTech.toLowerCase() === projectTech.toLowerCase() ||
        skillTech.toLowerCase().includes(projectTech.toLowerCase()) ||
        projectTech.toLowerCase().includes(skillTech.toLowerCase())
      )
    );

    if (hasMatch) {
      matchedSkillIds.push(skill.id);
    }
  }

  return matchedSkillIds;
}