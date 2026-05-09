import { prisma } from '@/lib/prisma';

/**
 * 根据漏洞分类 value 列表和技术栈匹配 Skills
 */
export async function matchSkillsByCategoryValues(
  categoryValues: string[],
  techStack: string[] | null
): Promise<string[]> {
  if (categoryValues.length === 0) return [];

  console.log(`[SkillMatcher] 开始匹配漏洞分类: ${categoryValues.join(', ')}`);
  console.log(`[SkillMatcher] 项目技术栈: ${techStack ? techStack.join(', ') : '无'}`);

  // 将 value 转换为 category ID
  const categories = await prisma.vulnerabilityCategory.findMany({
    where: { value: { in: categoryValues } },
    select: { id: true, value: true, label: true },
  });
  
  console.log(`[SkillMatcher] 找到 ${categories.length} 个漏洞分类:`, categories.map(c => `${c.label}(${c.value})`).join(', '));
  
  const categoryIds = categories.map(c => c.id);
  if (categoryIds.length === 0) {
    console.log(`[SkillMatcher] ⚠️ 未找到匹配的漏洞分类，请检查分类 value 是否正确`);
    return [];
  }

  // 查找关联的 VulnerabilityPattern
  const patterns = await prisma.vulnerabilityPattern.findMany({
    where: { categoryId: { in: categoryIds } },
    select: { id: true, name: true, categoryId: true },
  });
  
  console.log(`[SkillMatcher] 找到 ${patterns.length} 个漏洞模式`);
  
  if (patterns.length === 0) {
    console.log(`[SkillMatcher] ⚠️ 漏洞分类下没有漏洞模式，请检查 VulnerabilityPattern 表`);
    return [];
  }

  const patternIds = patterns.map(p => p.id);

  // 查找关联的 Skills（包含更多信息用于调试）
  const skills = await prisma.skill.findMany({
    where: {
      vulnerabilityPatternId: { in: patternIds },
    },
    select: { 
      id: true, 
      name: true, 
      techStackId: true, 
      isActive: true, 
      isLatest: true,
      vulnerabilityPatternId: true,
    },
  });
  
  console.log(`[SkillMatcher] 找到 ${skills.length} 个关联的 Skills (未过滤状态)`);
  
  if (skills.length === 0) {
    console.log(`[SkillMatcher] ⚠️ 漏洞模式下没有关联的 Skills，请检查 Skill 表的 vulnerabilityPatternId 字段`);
    return [];
  }

  // 调试：显示每个 Skill 的状态
  skills.forEach(s => {
    console.log(`[SkillMatcher]   - ${s.name}: isActive=${s.isActive}, isLatest=${s.isLatest}, techStackId=${s.techStackId || '无'}`);
  });

  // 过滤：isActive + isLatest
  const activeSkills = skills.filter(s => s.isActive && s.isLatest);
  console.log(`[SkillMatcher] 过滤后 (isActive + isLatest): ${activeSkills.length} 个`);

  if (activeSkills.length === 0) {
    console.log(`[SkillMatcher] ⚠️ 没有激活且最新的 Skills，请检查 Skill 表的 isActive 和 isLatest 字段`);
    return [];
  }

  // 技术栈过滤
  if (!techStack || techStack.length === 0) {
    console.log(`[SkillMatcher] 无技术栈限制，返回所有 ${activeSkills.length} 个 Skills`);
    return activeSkills.map(s => s.id);
  }

  const matchedSkills = activeSkills.filter(s => !s.techStackId || techStack.includes(s.techStackId));
  console.log(`[SkillMatcher] 技术栈过滤后: ${matchedSkills.length} 个`);
  
  if (matchedSkills.length === 0) {
    const skillTechStacks = [...new Set(activeSkills.map(s => s.techStackId).filter(Boolean))];
    console.log(`[SkillMatcher] ⚠️ 技术栈不匹配，Skills 的技术栈: ${skillTechStacks.join(', ')}, 项目技术栈: ${techStack.join(', ')}`);
  }

  return matchedSkills.map(s => s.id);
}

/** @deprecated use matchSkillsByCategoryValues */
export async function matchSkillsByCategory(
  category: string,
  techStack: string[] | null
): Promise<string[]> {
  return matchSkillsByCategoryValues([category], techStack);
}