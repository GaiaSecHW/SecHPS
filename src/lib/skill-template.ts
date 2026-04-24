// src/lib/skill-template.ts
/**
 * Skill 输出模板工具函数
 * 
 * 统一获取 Skill 标准输出模板，避免重复代码
 */

import { prisma } from '@/lib/prisma';

/**
 * 获取 Skill 标准输出模板
 * 
 * 从 OpencodeConfig 表获取激活配置中的 skillOutputTemplate
 * 
 * @returns 模板字符串，如果未配置则返回 undefined
 */
export async function getSkillOutputTemplate(): Promise<string | undefined> {
  const config = await prisma.opencodeConfig.findFirst({
    where: { isActive: true },
    select: { skillOutputTemplate: true },
  });
  return config?.skillOutputTemplate || undefined;
}