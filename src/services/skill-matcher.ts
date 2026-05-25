import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 根据漏洞分类 value 列表和技术栈匹配 Skills
 */
export async function matchSkillsByCategoryValues(
  categoryValues: string[],
  techStack: string[] | null
): Promise<string[]> {
  if (categoryValues.length === 0) return [];

  logger.info(LOG_MODULES.SKILL, '开始匹配漏洞分类', {
    categoryValues,
    techStack: techStack || null
  });

  // 将 value 转换为 category ID
  const categories = await prisma.vulnerabilityCategory.findMany({
    where: { value: { in: categoryValues } },
    select: { id: true, value: true, label: true },
  });

  logger.info(LOG_MODULES.SKILL, '找到漏洞分类', {
    count: categories.length,
    categories: categories.map(c => `${c.label}(${c.value})`).join(', ')
  });

  const categoryIds = categories.map(c => c.id);
  if (categoryIds.length === 0) {
    logger.warn(LOG_MODULES.SKILL, '未找到匹配的漏洞分类，请检查分类 value 是否正确');
    return [];
  }

  // 查找关联的 VulnerabilityPattern
  const patterns = await prisma.vulnerabilityPattern.findMany({
    where: { categoryId: { in: categoryIds } },
    select: { id: true, name: true, categoryId: true },
  });

  logger.info(LOG_MODULES.SKILL, '找到漏洞模式', { count: patterns.length });

  if (patterns.length === 0) {
    logger.warn(LOG_MODULES.SKILL, '漏洞分类下没有漏洞模式，请检查 VulnerabilityPattern 表');
    return [];
  }

  const patternIds = patterns.map(p => p.id);

  // 查找关联的 Skills（包含更多信息用于调试）
  const skills = await prisma.skill.findMany({
    where: {
      vulnerabilityTreeId: { in: patternIds },
    },
    select: {
      id: true,
      name: true,
      categoryId: true,
      isActive: true,
      isLatest: true,
      vulnerabilityTreeId: true,
    },
  });

  logger.info(LOG_MODULES.SKILL, '找到关联的 Skills (未过滤状态)', { count: skills.length });

  if (skills.length === 0) {
    logger.warn(LOG_MODULES.SKILL, '漏洞模式下没有关联的 Skills，请检查 Skill 表的 vulnerabilityTreeId 字段');
    return [];
  }

  // 调试：显示每个 Skill 的状态
  skills.forEach(s => {
    logger.debug(LOG_MODULES.SKILL, `Skill 状态`, {
      name: s.name,
      isActive: s.isActive,
      isLatest: s.isLatest,
      categoryId: s.categoryId || '无'
    });
  });

  // 过滤：isActive + isLatest
  const activeSkills = skills.filter(s => s.isActive && s.isLatest);
  logger.info(LOG_MODULES.SKILL, '过滤后 (isActive + isLatest)', { count: activeSkills.length });

  if (activeSkills.length === 0) {
    logger.warn(LOG_MODULES.SKILL, '没有激活且最新的 Skills，请检查 Skill 表的 isActive 和 isLatest 字段');
    return [];
  }

  // 技术栈过滤
  if (!techStack || techStack.length === 0) {
    logger.info(LOG_MODULES.SKILL, '无技术栈限制，返回所有 Skills', { count: activeSkills.length });
    return activeSkills.map(s => s.id);
  }

  const matchedSkills = activeSkills.filter(s => !s.categoryId || techStack.includes(s.categoryId));
  logger.info(LOG_MODULES.SKILL, '技术栈过滤后', { count: matchedSkills.length });

  if (matchedSkills.length === 0) {
    const skillTechStacks = [...new Set(activeSkills.map(s => s.categoryId).filter(Boolean))];
    logger.warn(LOG_MODULES.SKILL, '技术栈不匹配', {
      skillTechStacks,
      projectTechStack: techStack
    });
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