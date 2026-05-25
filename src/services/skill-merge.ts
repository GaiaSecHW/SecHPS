// src/services/skill-merge.ts
/**
 * Skill 合并执行服务
 * 
 * 实现三种合并策略：
 * 1. content-merge - 内容合并：将多个 Skills 的内容合并为一个
 * 2. replace - 替代合并：使用一个 Skill 作为主版本，其他标记为废弃
 * 3. techStack-split - 技术栈区分：保持 Skills 分离，但分配不同的技术栈
 * 
 * 版本管理：
 * - 合并后的 Skill 版本号递增
 * - parentId 引用原始 Skills
 * - isLatest 标记最新版本
 * 
 * Soft Deprecation：
 * - 废弃的 Skills 设置 isLatest=false
 * - 数据完整保留（不删除）
 * - 创建 SkillMergeRecord 审计记录
 */

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import type { Skill, SkillMergeRecord } from '@prisma/client';
import { saveSkillToDisk } from './skill-files';
import { aggregateObservationStats } from './skill-observation-stats';
import { getSkillOutputTemplate } from '@/lib/skill-template';

/**
 * 合并策略类型
 */
export type MergeStrategy = 'content-merge' | 'replace' | 'techStack-split';

/**
 * 合并选项
 */
export interface MergeOptions {
  strategy: MergeStrategy;
  targetSkillId: string;  // Primary skill for replace, or new skill base for content-merge
  sourceSkillIds: string[];  // Skills to merge/deprecate
  mergeReason: string;  // User-provided reason: similarity | duplicate | consolidation | user_request
  userId: string;  // User performing merge
  newSkillName?: string;  // Optional: new skill name for content-merge
  newSkillDisplayName?: string;  // Optional: new skill display name for content-merge
}

/**
 * 合并结果
 */
export interface MergeResult {
  success: boolean;
  mergedSkill?: Skill;  // The resulting skill
  deprecatedSkills?: Skill[];  // Skills that were deprecated
  updatedSkills?: Skill[];  // Skills that were updated (techStack-split)
  mergeRecord?: SkillMergeRecord;  // Audit record
  error?: string;
}

/**
 * 合并详情（存储在 mergeDetails JSON）
 */
export interface MergeDetails {
  strategy: MergeStrategy;
  originalTargetSkill: {
    id: string;
    name: string;
    displayName: string;
    version: number;
    content: string;
    categoryId: string | null;
  };
  originalSourceSkills: Array<{
    id: string;
    name: string;
    displayName: string;
    version: number;
    content: string;
    categoryId: string | null;
  }>;
  mergedContent?: string;  // For content-merge
  techStackAssignments?: Array<{  // For techStack-split
    skillId: string;
    skillName: string;
    assignedTechStack: string[];
  }>;
  mergedAt: string;
  mergedBy: string;
}

/**
 * 执行 Skill 合并
 */
export async function executeSkillMerge(options: MergeOptions): Promise<MergeResult> {
  try {
    // 验证输入
    if (!options.targetSkillId) {
      return { success: false, error: '缺少目标 Skill ID' };
    }
    if (!options.sourceSkillIds || options.sourceSkillIds.length === 0) {
      return { success: false, error: '缺少源 Skill IDs' };
    }
    if (!options.mergeReason) {
      return { success: false, error: '缺少合并原因' };
    }

    // 获取目标 Skill
    const targetSkill = await prisma.skill.findUnique({
      where: { id: options.targetSkillId },
    });

    if (!targetSkill) {
      return { success: false, error: '目标 Skill 不存在' };
    }

    // 获取源 Skills
    const sourceSkills = await prisma.skill.findMany({
      where: { id: { in: options.sourceSkillIds } },
    });

    if (sourceSkills.length !== options.sourceSkillIds.length) {
      const missingIds = options.sourceSkillIds.filter(
        id => !sourceSkills.find(s => s.id === id)
      );
      return { success: false, error: `源 Skills 不存在: ${missingIds.join(', ')}` };
    }

    // 检查权限：跨用户合并需要同意
    const targetOwnerId = targetSkill.userId;
    const sourceOwnerIds = sourceSkills.map(s => s.userId);
    const allOwnerIds = [targetOwnerId, ...sourceOwnerIds];
    const uniqueOwnerIds = [...new Set(allOwnerIds.filter(id => id !== null))];

    if (uniqueOwnerIds.length > 1) {
      // 跨用户合并，需要检查同意状态
      // 这里暂时返回错误，实际应该检查 SkillMergeRecord 的 consent 字段
      return {
        success: false,
        error: '跨用户合并需要所有所有者同意。请先创建合并请求并等待审批。',
      };
    }

    // 根据策略执行合并
    switch (options.strategy) {
      case 'content-merge':
        return await executeContentMerge(options, targetSkill, sourceSkills);
      case 'replace':
        return await executeReplaceMerge(options, targetSkill, sourceSkills);
      case 'techStack-split':
        return await executeTechStackSplit(options, targetSkill, sourceSkills);
      default:
        return { success: false, error: `未知的合并策略: ${options.strategy}` };
    }
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '合并执行失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

/**
 * content-merge 策略：内容合并
 * 将多个 Skills 的内容合并为一个新 Skill
 */
async function executeContentMerge(
  options: MergeOptions,
  targetSkill: Skill,
  sourceSkills: Skill[]
): Promise<MergeResult> {
  try {
    // 1. 合并 frontmatter 字段
    const mergedName = options.newSkillName || `${targetSkill.name}-merged`;
    const mergedDisplayName = options.newSkillDisplayName || `${targetSkill.displayName} (合并版)`;
    
    // 合并描述：取最长的描述或拼接
    const descriptions = [targetSkill.description, ...sourceSkills.map(s => s.description)];
    const mergedDescription = descriptions.reduce((a, b) => a.length >= b.length ? a : b);

    // 合并严重程度：取最高的
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
    const severities = [targetSkill.severity || 'medium', ...sourceSkills.map(s => s.severity || 'medium')];
    const mergedSeverity = severities.reduce((a, b) => {
      const aIndex = severityOrder.indexOf(a);
      const bIndex = severityOrder.indexOf(b);
      return aIndex <= bIndex ? a : b;
    });
    
    // 合并 CWE：取第一个非空的
    const cwes = [targetSkill.cwe, ...sourceSkills.map(s => s.cwe)].filter(c => c);
    const mergedCwe = cwes[0] || null;

    // 2. 合并内容：使用分隔符
    const separator = '\n\n---\n\n';
    const contentParts = [
      `# ${mergedDisplayName}\n\n> 此 Skill 由以下 Skills 合并而成：\n> - ${targetSkill.displayName} (v${targetSkill.version})\n${sourceSkills.map(s => `> - ${s.displayName} (v${s.version})`).join('\n')}\n\n`,
      targetSkill.content || '',
      ...sourceSkills.map(s => s.content || ''),
    ];
    const mergedContent = contentParts.join(separator);
    
    // 3. 计算新版本号：取最大版本号 + 1
    const maxVersion = Math.max(targetSkill.version, ...sourceSkills.map(s => s.version));
    const newVersion = maxVersion + 1;
    
    // 4. 创建合并后的 Skill
    const mergedSkill = await prisma.skill.create({
      data: {
        id: `skill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: mergedName,
        displayName: mergedDisplayName,
        description: mergedDescription,
        severity: mergedSeverity,
        cwe: mergedCwe,
        content: mergedContent,
        categoryId: targetSkill.categoryId,
        vulnerabilityTreeId: targetSkill.vulnerabilityTreeId,
        userId: targetSkill.userId,  // 继承目标 Skill 的所有者
        isBuiltin: false,
        isActive: true,
        version: newVersion,
        parentId: targetSkill.id,  // 引用目标 Skill 作为父版本
        isLatest: true,
        // 继承统计数据（取平均值或最大值）
        successRate: targetSkill.successRate,
        avgDuration: targetSkill.avgDuration,
        execCount: targetSkill.execCount,
        referenceCount: targetSkill.referenceCount,
        vulnerabilityCount: targetSkill.vulnerabilityCount,
        updatedAt: new Date(),
      },
    });
    
    // 5. 标记原 Skills 为废弃（isLatest=false）
    const deprecatedSkills: Skill[] = [];
    
    // 标记目标 Skill
    const deprecatedTarget = await prisma.skill.update({
      where: { id: targetSkill.id },
      data: { isLatest: false },
    });
    deprecatedSkills.push(deprecatedTarget);
    
    // 标记源 Skills
    for (const sourceSkill of sourceSkills) {
      const deprecatedSource = await prisma.skill.update({
        where: { id: sourceSkill.id },
        data: { isLatest: false },
      });
      deprecatedSkills.push(deprecatedSource);
    }
    
    // 6. 创建 SkillMergeRecord 审计记录
    const mergeDetails: MergeDetails = {
      strategy: 'content-merge',
      originalTargetSkill: {
        id: targetSkill.id,
        name: targetSkill.name,
        displayName: targetSkill.displayName,
        version: targetSkill.version,
        content: targetSkill.content || '',
        categoryId: targetSkill.categoryId,
      },
      originalSourceSkills: sourceSkills.map(s => ({
        id: s.id,
        name: s.name,
        displayName: s.displayName,
        version: s.version,
        content: s.content || '',
        categoryId: s.categoryId,
      })),
      mergedContent: mergedContent,
      mergedAt: new Date().toISOString(),
      mergedBy: options.userId,
    };
    
    // 为每个源 Skill 创建合并记录
    const mergeRecords: SkillMergeRecord[] = [];
    for (const sourceSkill of sourceSkills) {
      const mergeRecord = await prisma.skillMergeRecord.create({
        data: {
          id: `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          sourceSkillId: sourceSkill.id,
          targetSkillId: mergedSkill.id,
          mergeReason: options.mergeReason,
          mergeDetails: JSON.stringify(mergeDetails),
          status: 'completed',
          mergedBy: options.userId,
          mergedAt: new Date(),
          completedAt: new Date(),
          sourceOwnerConsent: true,  // 同一用户合并默认同意
          targetOwnerConsent: true,
          updatedAt: new Date(),
        },
      });
      mergeRecords.push(mergeRecord);
    }
    
    // 为目标 Skill 也创建合并记录
    const targetMergeRecord = await prisma.skillMergeRecord.create({
      data: {
        id: `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        sourceSkillId: targetSkill.id,
        targetSkillId: mergedSkill.id,
        mergeReason: options.mergeReason,
        mergeDetails: JSON.stringify(mergeDetails),
        status: 'completed',
        mergedBy: options.userId,
        mergedAt: new Date(),
        completedAt: new Date(),
        sourceOwnerConsent: true,
        targetOwnerConsent: true,
        updatedAt: new Date(),
      },
    });
    mergeRecords.push(targetMergeRecord);
    
    // 7. 保存到磁盘（包含标准输出模板）
    const template = await getSkillOutputTemplate();
    await saveSkillToDisk(mergedSkill, template);
    
    // 8. 更新观测统计（合并后重新聚合）
    await updateObservationStatsAfterMerge(mergedSkill.id, [
      targetSkill.id,
      ...sourceSkills.map(s => s.id),
    ]);
    
    logger.info(LOG_MODULES.SKILL, `content-merge 完成: ${mergedSkill.name} v${mergedSkill.version}`);
    
    return {
      success: true,
      mergedSkill,
      deprecatedSkills,
      mergeRecord: mergeRecords[0],  // 返回第一个记录
    };
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, 'content-merge 执行失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

/**
 * replace 策略：替代合并
 * 使用目标 Skill 作为主版本，源 Skills 标记为废弃
 */
async function executeReplaceMerge(
  options: MergeOptions,
  targetSkill: Skill,
  sourceSkills: Skill[]
): Promise<MergeResult> {
  try {
    // 1. 创建目标 Skill 的新版本（标记为合并版本）
    const newVersion = targetSkill.version + 1;
    
    // 添加合并说明到内容
    const mergeNote = `\n\n---\n\n> **合并说明**\n> 此 Skill 已合并以下 Skills：\n${sourceSkills.map(s => `> - ${s.displayName} (v${s.version})`).join('\n')}\n> 合并原因: ${options.mergeReason}\n> 合并时间: ${new Date().toISOString()}\n`;
    const updatedContent = (targetSkill.content || '') + mergeNote;
    
    // 标记当前版本为非最新
    await prisma.skill.update({
      where: { id: targetSkill.id },
      data: { isLatest: false },
    });
    
    // 创建新版本
    const mergedSkill = await prisma.skill.create({
      data: {
        id: `skill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: targetSkill.name,
        displayName: `${targetSkill.displayName} (合并版)`,
        description: targetSkill.description,
        severity: targetSkill.severity || 'medium',
        cwe: targetSkill.cwe,
        content: updatedContent,
        categoryId: targetSkill.categoryId,
        vulnerabilityTreeId: targetSkill.vulnerabilityTreeId,
        userId: targetSkill.userId,
        isBuiltin: targetSkill.isBuiltin,
        isActive: targetSkill.isActive,
        version: newVersion,
        parentId: targetSkill.id,
        isLatest: true,
        successRate: targetSkill.successRate,
        avgDuration: targetSkill.avgDuration,
        execCount: targetSkill.execCount,
        referenceCount: targetSkill.referenceCount,
        vulnerabilityCount: targetSkill.vulnerabilityCount,
        updatedAt: new Date(),
      },
    });
    
    // 2. 标记源 Skills 为废弃（isLatest=false）
    const deprecatedSkills: Skill[] = [];
    
    for (const sourceSkill of sourceSkills) {
      const deprecatedSource = await prisma.skill.update({
        where: { id: sourceSkill.id },
        data: { isLatest: false },
      });
      deprecatedSkills.push(deprecatedSource);
    }
    
    // 3. 创建 SkillMergeRecord 审计记录
    const mergeDetails: MergeDetails = {
      strategy: 'replace',
      originalTargetSkill: {
        id: targetSkill.id,
        name: targetSkill.name,
        displayName: targetSkill.displayName,
        version: targetSkill.version,
        content: targetSkill.content || '',
        categoryId: targetSkill.categoryId,
      },
      originalSourceSkills: sourceSkills.map(s => ({
        id: s.id,
        name: s.name,
        displayName: s.displayName,
        version: s.version,
        content: s.content || '',
        categoryId: s.categoryId,
      })),
      mergedAt: new Date().toISOString(),
      mergedBy: options.userId,
    };

    // 为每个源 Skill 创建合并记录
    const mergeRecords: SkillMergeRecord[] = [];
    for (const sourceSkill of sourceSkills) {
      const mergeRecord = await prisma.skillMergeRecord.create({
        data: {
          id: `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          sourceSkillId: sourceSkill.id,
          targetSkillId: mergedSkill.id,
          mergeReason: options.mergeReason,
          mergeDetails: JSON.stringify(mergeDetails),
          status: 'completed',
          mergedBy: options.userId,
          mergedAt: new Date(),
          completedAt: new Date(),
          sourceOwnerConsent: true,
          targetOwnerConsent: true,
          updatedAt: new Date(),
        },
      });
      mergeRecords.push(mergeRecord);
    }
    
    // 4. 保存到磁盘（包含标准输出模板）
    const template2 = await getSkillOutputTemplate();
    await saveSkillToDisk(mergedSkill, template2);
    
    // 5. 更新观测统计（合并后重新聚合）
    await updateObservationStatsAfterMerge(mergedSkill.id, [
      targetSkill.id,
      ...sourceSkills.map(s => s.id),
    ]);
    
    logger.info(LOG_MODULES.SKILL, `replace 完成: ${mergedSkill.name} v${mergedSkill.version}`);
    
    return {
      success: true,
      mergedSkill,
      deprecatedSkills,
      mergeRecord: mergeRecords[0],
    };
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, 'replace 执行失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

/**
 * techStack-split 策略：技术栈区分
 * 保持 Skills 分离，但为每个 Skill 分配独特的技术栈
 */
async function executeTechStackSplit(
  options: MergeOptions,
  targetSkill: Skill,
  sourceSkills: Skill[]
): Promise<MergeResult> {
  try {
    // 1. 分析每个 Skill 的独特特征
    const allSkills = [targetSkill, ...sourceSkills];
    const techStackAssignments: Array<{
      skillId: string;
      skillName: string;
      assignedTechStack: string[];
    }> = [];
    
    // 2. 为每个 Skill 分配技术栈
    // 简单策略：基于 Skill 名称推断技术栈
    for (const skill of allSkills) {
      let assignedTechStack: string[] = [];

      // 如果没有技术栈，尝试从名称推断
      if (assignedTechStack.length === 0) {
        assignedTechStack = inferTechStackFromSkillName(skill.name, skill.displayName);
      }
      
      techStackAssignments.push({
        skillId: skill.id,
        skillName: skill.name,
        assignedTechStack,
      });
    }
    
    // 3. 更新每个 Skill 的技术栈
    const updatedSkills: Skill[] = [];
    
    for (const assignment of techStackAssignments) {
      const skill = allSkills.find(s => s.id === assignment.skillId);
      if (!skill) continue;
      
      // 创建新版本（技术栈变更）
      const newVersion = skill.version + 1;
      
      // 标记当前版本为非最新
      await prisma.skill.update({
        where: { id: skill.id },
        data: { isLatest: false },
      });
      
      // 创建新版本
      const updatedSkill = await prisma.skill.create({
        data: {
          id: `skill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          name: skill.name,
          displayName: skill.displayName,
          description: skill.description,
          severity: skill.severity || 'medium',
          cwe: skill.cwe,
          content: skill.content || '',
          categoryId: skill.categoryId,
          vulnerabilityTreeId: skill.vulnerabilityTreeId,
          userId: skill.userId,
          isBuiltin: skill.isBuiltin,
          isActive: skill.isActive,
          version: newVersion,
          parentId: skill.id,
          isLatest: true,
          successRate: skill.successRate,
          avgDuration: skill.avgDuration,
          execCount: skill.execCount,
          referenceCount: skill.referenceCount,
          vulnerabilityCount: skill.vulnerabilityCount,
          updatedAt: new Date(),
        },
      });
      
      updatedSkills.push(updatedSkill);
      
      // 保存到磁盘（包含标准输出模板）
      const template3 = await getSkillOutputTemplate();
      await saveSkillToDisk(updatedSkill, template3);
    }
    
    // 4. 创建 SkillMergeRecord 审计记录
    const mergeDetails: MergeDetails = {
      strategy: 'techStack-split',
      originalTargetSkill: {
        id: targetSkill.id,
        name: targetSkill.name,
        displayName: targetSkill.displayName,
        version: targetSkill.version,
        content: targetSkill.content || '',
        categoryId: targetSkill.categoryId,
      },
      originalSourceSkills: sourceSkills.map(s => ({
        id: s.id,
        name: s.name,
        displayName: s.displayName,
        version: s.version,
        content: s.content || '',
        categoryId: s.categoryId,
      })),
      techStackAssignments,
      mergedAt: new Date().toISOString(),
      mergedBy: options.userId,
    };
    
    // 创建合并记录（记录整个拆分操作）
    const mergeRecord = await prisma.skillMergeRecord.create({
      data: {
        id: `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        sourceSkillId: targetSkill.id,  // 使用目标 Skill 作为主记录
        targetSkillId: targetSkill.id,  // 目标和源相同，表示拆分操作
        mergeReason: options.mergeReason,
        mergeDetails: JSON.stringify(mergeDetails),
        status: 'completed',
        mergedBy: options.userId,
        mergedAt: new Date(),
        completedAt: new Date(),
        sourceOwnerConsent: true,
        targetOwnerConsent: true,
        updatedAt: new Date(),
      },
    });
    
    // 5. 更新观测统计（拆分后重新聚合）
    await updateObservationStatsAfterMerge(null, allSkills.map(s => s.id));
    
    logger.info(LOG_MODULES.SKILL, `techStack-split 完成: ${updatedSkills.length} 个 Skills 已更新技术栈`);
    
    return {
      success: true,
      mergedSkill: updatedSkills.find(s => s.id === targetSkill.id),  // 返回目标 Skill 的更新版本
      updatedSkills,
      mergeRecord,
    };
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, 'techStack-split 执行失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

/**
 * 从 Skill 名称推断技术栈
 */
function inferTechStackFromSkillName(name: string, displayName: string): string[] {
  const techStackKeywords: Record<string, string[]> = {
    'Java': ['java', 'spring', 'springboot', 'jvm', 'jdk', 'maven', 'gradle', 'tomcat', 'jboss', 'wildfly'],
    'Python': ['python', 'django', 'flask', 'fastapi', 'py', 'pip', 'conda', 'jupyter', 'pandas', 'numpy'],
    'JavaScript': ['javascript', 'js', 'node', 'nodejs', 'npm', 'yarn', 'react', 'vue', 'angular', 'express', 'nextjs', 'next.js'],
    'TypeScript': ['typescript', 'ts', 'tsx', 'tsc'],
    'Go': ['go', 'golang', 'gopher'],
    'Rust': ['rust', 'cargo', 'rustc'],
    'C/C++': ['c', 'cpp', 'c++', 'gcc', 'clang', 'llvm', 'cmake', 'makefile'],
    'PHP': ['php', 'laravel', 'symfony', 'wordpress', 'drupal'],
    'Ruby': ['ruby', 'rails', 'rubyonrails', 'gem', 'bundler'],
    'Swift': ['swift', 'ios', 'apple', 'xcode', 'swiftui'],
    'Kotlin': ['kotlin', 'android', 'ktor'],
    'Scala': ['scala', 'spark', 'akka', 'play'],
    'Database': ['sql', 'mysql', 'postgresql', 'postgres', 'oracle', 'mongodb', 'redis', 'sqlite', 'database', 'db'],
    'Cloud': ['aws', 'azure', 'gcp', 'cloud', 'kubernetes', 'k8s', 'docker', 'container', 'terraform', 'helm'],
    'Security': ['security', 'auth', 'authentication', 'oauth', 'jwt', 'ssl', 'tls', 'crypto', 'encryption', 'xss', 'csrf', 'sql-injection'],
    'API': ['api', 'rest', 'graphql', 'grpc', 'swagger', 'openapi', 'endpoint'],
    'Web': ['web', 'html', 'css', 'dom', 'browser', 'frontend', 'backend', 'http', 'https'],
    'Mobile': ['mobile', 'android', 'ios', 'react-native', 'flutter', 'mobile-app'],
    'DevOps': ['devops', 'ci', 'cd', 'pipeline', 'jenkins', 'gitlab', 'github', 'actions', 'automation'],
  };
  
  const combinedText = `${name} ${displayName}`.toLowerCase();
  const inferredTechStack: string[] = [];
  
  for (const [tech, keywords] of Object.entries(techStackKeywords)) {
    if (keywords.some(keyword => combinedText.includes(keyword))) {
      inferredTechStack.push(tech);
    }
  }
  
  // 如果没有推断出技术栈，返回空数组（表示通用 Skill）
  return inferredTechStack.length > 0 ? inferredTechStack : [];
}

/**
 * 创建合并请求（用于跨用户合并）
 */
export async function createMergeRequest(options: MergeOptions): Promise<{
  success: boolean;
  mergeRecord?: SkillMergeRecord;
  error?: string;
}> {
  try {
    // 验证输入
    if (!options.targetSkillId || !options.sourceSkillIds || options.sourceSkillIds.length === 0) {
      return { success: false, error: '缺少必要的 Skill IDs' };
    }

    // 获取 Skills 信息
    const targetSkill = await prisma.skill.findUnique({
      where: { id: options.targetSkillId },
    });

    if (!targetSkill) {
      return { success: false, error: '目标 Skill 不存在' };
    }

    const sourceSkills = await prisma.skill.findMany({
      where: { id: { in: options.sourceSkillIds } },
    });

    // 创建合并详情
    const mergeDetails: MergeDetails = {
      strategy: options.strategy,
      originalTargetSkill: {
        id: targetSkill.id,
        name: targetSkill.name,
        displayName: targetSkill.displayName,
        version: targetSkill.version,
        content: targetSkill.content || '',
        categoryId: targetSkill.categoryId,
      },
      originalSourceSkills: sourceSkills.map(s => ({
        id: s.id,
        name: s.name,
        displayName: s.displayName,
        version: s.version,
        content: s.content || '',
        categoryId: s.categoryId,
      })),
      mergedAt: new Date().toISOString(),
      mergedBy: options.userId,
    };

    // 为每个源 Skill 创建合并请求记录
    const mergeRecords: SkillMergeRecord[] = [];
    for (const sourceSkill of sourceSkills) {
      const mergeRecord = await prisma.skillMergeRecord.create({
        data: {
          id: `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          sourceSkillId: sourceSkill.id,
          targetSkillId: targetSkill.id,
          mergeReason: options.mergeReason,
          mergeDetails: JSON.stringify(mergeDetails),
          status: 'pending',
          sourceOwnerConsent: sourceSkill.userId === options.userId,
          targetOwnerConsent: targetSkill.userId === options.userId,
          updatedAt: new Date(),
        },
      });
      mergeRecords.push(mergeRecord);
    }

    return {
      success: true,
      mergeRecord: mergeRecords[0],
    };
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '创建合并请求失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

/**
 * 批准合并请求
 */
export async function approveMergeRequest(
  mergeRecordId: string,
  userId: string,
  isSourceOwner: boolean
): Promise<{
  success: boolean;
  mergeRecord?: SkillMergeRecord;
  canExecute?: boolean;
  error?: string;
}> {
  try {
    const mergeRecord = await prisma.skillMergeRecord.findUnique({
      where: { id: mergeRecordId },
    });

    if (!mergeRecord) {
      return { success: false, error: '合并记录不存在' };
    }

    if (mergeRecord.status !== 'pending') {
      return { success: false, error: '合并请求已处理' };
    }

    // 更新同意状态
    const updateData: Partial<SkillMergeRecord> = {
      approvedBy: userId,
      approvedAt: new Date(),
    };

    if (isSourceOwner) {
      updateData.sourceOwnerConsent = true;
    } else {
      updateData.targetOwnerConsent = true;
    }

    // 检查是否所有方都同意
    const updatedRecord = await prisma.skillMergeRecord.update({
      where: { id: mergeRecordId },
      data: updateData,
    });

    const canExecute = updatedRecord.sourceOwnerConsent && updatedRecord.targetOwnerConsent;

    // 如果所有方都同意，自动更新状态为 approved
    if (canExecute) {
      await prisma.skillMergeRecord.update({
        where: { id: mergeRecordId },
        data: { status: 'approved' },
      });
    }

    return {
      success: true,
      mergeRecord: updatedRecord,
      canExecute,
    };
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '批准合并请求失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

/**
 * 撤销合并
 */
export async function revertMerge(mergeRecordId: string, userId: string): Promise<MergeResult> {
  try {
    // 获取标准输出模板（用于恢复时写入磁盘）
    const template = await getSkillOutputTemplate();
    
    const mergeRecord = await prisma.skillMergeRecord.findUnique({
      where: { id: mergeRecordId },
    });

    if (!mergeRecord) {
      return { success: false, error: '合并记录不存在' };
    }

    if (mergeRecord.status !== 'completed') {
      return { success: false, error: '只能撤销已完成的合并' };
    }

    // 解析合并详情
    const mergeDetails: MergeDetails = JSON.parse(mergeRecord.mergeDetails || '{}');

    // 1. 标记合并后的 Skill 为废弃
    const mergedSkill = await prisma.skill.findUnique({
      where: { id: mergeRecord.targetSkillId },
    });

    if (mergedSkill && mergedSkill.isLatest) {
      await prisma.skill.update({
        where: { id: mergedSkill.id },
        data: { isLatest: false },
      });
    }

    // 2. 恢复原 Skills 的 isLatest 状态
    const restoredSkills: Skill[] = [];

    // 恢复目标 Skill
    const originalTarget = await prisma.skill.findUnique({
      where: { id: mergeDetails.originalTargetSkill.id },
    });

    if (originalTarget) {
      const restoredTarget = await prisma.skill.update({
        where: { id: originalTarget.id },
        data: { isLatest: true },
      });
      restoredSkills.push(restoredTarget);
      await saveSkillToDisk(restoredTarget, template);
    }

    // 恢复源 Skills
    for (const originalSource of mergeDetails.originalSourceSkills) {
      const source = await prisma.skill.findUnique({
        where: { id: originalSource.id },
      });

      if (source) {
        const restoredSource = await prisma.skill.update({
          where: { id: source.id },
          data: { isLatest: true },
        });
        restoredSkills.push(restoredSource);
        await saveSkillToDisk(restoredSource, template);
      }
    }

    // 3. 更新合并记录状态
    await prisma.skillMergeRecord.update({
      where: { id: mergeRecordId },
      data: {
        status: 'reverted',
        revertedAt: new Date(),
      },
    });

    // 4. 更新观测统计（撤销后重新聚合）
    const affectedSkillIds = [
      mergeRecord.targetSkillId,
      mergeRecord.sourceSkillId,
    ];
    await updateObservationStatsAfterMerge(null, affectedSkillIds);

    logger.info(LOG_MODULES.SKILL, `撤销合并完成: ${mergeRecordId}`);

    return {
      success: true,
      deprecatedSkills: mergedSkill ? [mergedSkill] : [],
      updatedSkills: restoredSkills,
    };
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '撤销合并失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

/**
 * 获取合并历史
 */
export async function getMergeHistory(skillId: string): Promise<SkillMergeRecord[]> {
  try {
    const records = await prisma.skillMergeRecord.findMany({
      where: {
        OR: [
          { sourceSkillId: skillId },
          { targetSkillId: skillId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return records;
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '获取合并历史失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return [];
  }
}

/**
 * 获取待处理的合并请求
 */
export async function getPendingMergeRequests(userId?: string): Promise<SkillMergeRecord[]> {
  try {
    const whereClause: any = { status: 'pending' };

    if (userId) {
      // 获取用户相关的合并请求
      const userSkills = await prisma.skill.findMany({
        where: { userId },
        select: { id: true },
      });
      const skillIds = userSkills.map(s => s.id);

      whereClause.OR = [
        { sourceSkillId: { in: skillIds } },
        { targetSkillId: { in: skillIds } },
      ];
    }

    const records = await prisma.skillMergeRecord.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    return records;
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '获取待处理合并请求失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return [];
  }
}

/**
 * 检查 Skill 是否可以合并
 */
export async function checkMergeCompatibility(
  targetSkillId: string,
  sourceSkillIds: string[]
): Promise<{
  compatible: boolean;
  issues: string[];
  warnings: string[];
}> {
  try {
    const issues: string[] = [];
    const warnings: string[] = [];

    // 获取 Skills
    const targetSkill = await prisma.skill.findUnique({
      where: { id: targetSkillId },
    });

    if (!targetSkill) {
      return { compatible: false, issues: ['目标 Skill 不存在'], warnings: [] };
    }

    const sourceSkills = await prisma.skill.findMany({
      where: { id: { in: sourceSkillIds } },
    });

    if (sourceSkills.length !== sourceSkillIds.length) {
      issues.push('部分源 Skills 不存在');
    }

    // 检查是否为最新版本
    if (!targetSkill.isLatest) {
      warnings.push('目标 Skill 不是最新版本');
    }

    for (const source of sourceSkills) {
      if (!source.isLatest) {
        warnings.push(`源 Skill "${source.displayName}" 不是最新版本`);
      }
    }

    // 检查是否为内置 Skill
    if (targetSkill.isBuiltin) {
      issues.push('目标 Skill 是内置 Skill，不能合并');
    }

    for (const source of sourceSkills) {
      if (source.isBuiltin) {
        issues.push(`源 Skill "${source.displayName}" 是内置 Skill，不能合并`);
      }
    }

    // 检查所有者
    const ownerIds = [targetSkill.userId, ...sourceSkills.map(s => s.userId)];
    const uniqueOwnerIds = [...new Set(ownerIds.filter(id => id !== null))];

    if (uniqueOwnerIds.length > 1) {
      warnings.push('跨用户合并需要所有所有者同意');
    }

    // 检查是否已经在合并中
    const pendingMerges = await prisma.skillMergeRecord.findMany({
      where: {
        OR: [
          { sourceSkillId: targetSkillId, status: 'pending' },
          { targetSkillId: targetSkillId, status: 'pending' },
          ...sourceSkillIds.map(id => ({
            OR: [
              { sourceSkillId: id, status: 'pending' },
              { targetSkillId: id, status: 'pending' },
            ],
          })),
        ],
      },
    });

    if (pendingMerges.length > 0) {
      issues.push('部分 Skills 已在待处理的合并请求中');
    }

    return {
      compatible: issues.length === 0,
      issues,
      warnings,
    };
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '检查合并兼容性失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      compatible: false,
      issues: ['检查失败'],
      warnings: [],
    };
  }
}

/**
 * 合并后更新观测统计
 * 
 * 清除已合并 Skills 的重叠统计，为新 Skill 创建空统计
 */
async function updateObservationStatsAfterMerge(
  mergedSkillId: string | null,
  affectedSkillIds: string[]
): Promise<void> {
  try {
    // 为新合并的 Skill 创建空统计（如果提供了 mergedSkillId）
    if (mergedSkillId) {
      await aggregateObservationStats(mergedSkillId);
    }

    // 为所有受影响的 Skills 重新聚合统计
    for (const skillId of affectedSkillIds) {
      await aggregateObservationStats(skillId);
    }

    logger.info(LOG_MODULES.SKILL, `观测统计已更新: ${affectedSkillIds.length} 个 Skills`);
  } catch (error) {
    // 观测统计更新失败不影响合并结果
    logger.error(LOG_MODULES.SKILL, '观测统计更新失败', { details: { error: error instanceof Error ? error.message : String(error) } });
  }
}

/**
 * 获取 Skill 版本历史
 * 
 * 返回指定 Skill 的所有版本链（从最新到最旧）
 */
export async function getSkillVersionHistory(skillId: string): Promise<Skill[]> {
  try {
    // 获取当前 Skill
    const currentSkill = await prisma.skill.findUnique({
      where: { id: skillId },
    });

    if (!currentSkill) {
      return [];
    }

    // 如果是最新版本，查找所有历史版本
    if (currentSkill.isLatest) {
      // 通过 parentId 链查找所有历史版本
      const versions: Skill[] = [currentSkill];
      let parentId = currentSkill.parentId;

      while (parentId) {
        const parentSkill = await prisma.skill.findUnique({
          where: { id: parentId },
        });

        if (parentSkill) {
          versions.push(parentSkill);
          parentId = parentSkill.parentId;
        } else {
          break;
        }
      }

      return versions;
    }

    // 如果不是最新版本，先找到最新版本，再遍历历史
    const latestSkill = await prisma.skill.findFirst({
      where: {
        name: currentSkill.name,
        userId: currentSkill.userId,
        isLatest: true,
      },
    });

    if (!latestSkill) {
      // 没有最新版本，返回当前版本及其历史
      const versions: Skill[] = [currentSkill];
      let parentId = currentSkill.parentId;

      while (parentId) {
        const parentSkill = await prisma.skill.findUnique({
          where: { id: parentId },
        });

        if (parentSkill) {
          versions.push(parentSkill);
          parentId = parentSkill.parentId;
        } else {
          break;
        }
      }

      return versions;
    }

    // 从最新版本开始遍历
    const versions: Skill[] = [latestSkill];
    let parentId = latestSkill.parentId;

    while (parentId) {
      const parentSkill = await prisma.skill.findUnique({
        where: { id: parentId },
      });

      if (parentSkill) {
        versions.push(parentSkill);
        parentId = parentSkill.parentId;
      } else {
        break;
      }
    }

    return versions;
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '获取版本历史失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return [];
  }
}

/**
 * 获取 Skill 的完整合并历史
 * 
 * 返回所有相关的合并记录（包括作为源和作为目标的记录）
 */
export async function getFullMergeHistory(skillId: string): Promise<{
  asSource: SkillMergeRecord[];
  asTarget: SkillMergeRecord[];
  allRecords: SkillMergeRecord[];
}> {
  try {
    // 作为源 Skill 的合并记录
    const asSource = await prisma.skillMergeRecord.findMany({
      where: { sourceSkillId: skillId },
      orderBy: { createdAt: 'desc' },
    });

    // 作为目标 Skill 的合并记录
    const asTarget = await prisma.skillMergeRecord.findMany({
      where: { targetSkillId: skillId },
      orderBy: { createdAt: 'desc' },
    });

    // 合并并去重
    const allRecords = [...asSource, ...asTarget].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    return {
      asSource,
      asTarget,
      allRecords,
    };
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '获取完整合并历史失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      asSource: [],
      asTarget: [],
      allRecords: [],
    };
  }
}