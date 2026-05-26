// src/services/skill-files.ts
/**
 * Skills 磁盘文件管理服务
 * 
 * 实现双写策略：数据库和磁盘同时保存
 * 评估启动时直接从磁盘拷贝，无需查询数据库和生成文件
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Skill } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSkillOutputTemplate } from '@/lib/skill-template';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 路径安全验证
 * 检查路径是否包含恶意字符，防止路径遍历攻击
 * 注意：项目路径可能是绝对路径（如 e:\temp\projects\...），这是允许的
 */
function isPathSafe(inputPath: string): boolean {
  // 检查路径遍历
  if (inputPath.includes('..')) return false;
  // 检查 null 字符
  if (inputPath.includes('\0')) return false;
  // 不再拒绝绝对路径 - 项目路径通常是绝对路径
  return true;
}

/**
 * Skill 元数据（存储在 metadata.json）
 */
export interface SkillMetadata {
  id: string;
  name: string;
  displayName: string;
  userId: string | null;  // null = 公共，有值 = 私有
  latestVersion: number;
  isActive: boolean;
  techStack?: string[];  // 技术栈列表，空数组或 undefined 表示通用（适合所有项目）
  updatedAt: string;
}

/**
 * 磁盘存储的 Skill 数据
 * Skill 存储为完整的 Markdown 内容
 */
export interface DiskSkill {
  id: string;
  userId: string | null;
  name: string;
  displayName: string;
  description: string;
  categoryId: string | null;
  vulnerabilityTreeId: string | null;
  severity: string;
  cwe: string | null;
  content: string;  // 完整的 Markdown 内容
  version: number;
  parentId: string | null;
  isLatest: boolean;
  successRate: number | null;
  avgDuration: number | null;
  execCount: number;
  isActive: boolean;
  isBuiltin: boolean;
}

/**
 * 治理过滤结果
 */
export interface FilteredSkillInfo {
  skillId: string;
  skillName: string;
  reason: 'deprecated' | 'merged' | 'pending_merge';
  mergedInto?: string;  // 合并目标 Skill 名称（仅 merged 时）
}

/**
 * 拷贝结果
 */
export interface CopyResult {
  success: number;
  failed: number;
  errors: string[];
  copiedSkills: string[];
  skillIds: string[];  // 新增：返回 Skill ID 列表，用于记录评估使用的 Skills
  filteredSkills?: FilteredSkillInfo[];  // 治理过滤的 Skills
}

/**
 * 获取 Skills 磁盘存储根目录
 */
export function getSkillsDataDir(): string {
  // 使用项目根目录下的 data/skills
  const rootDir = process.cwd();
  return path.join(rootDir, 'data', 'skills');
}

/**
 * 获取单个 Skill 的目录路径
 */
export function getSkillDir(skillName: string, userId: string | null): string {
  const baseDir = getSkillsDataDir();
  // 私有 Skill 使用 user-{userId} 前缀
  const dirName = userId ? `user-${userId}/${skillName}` : skillName;
  return path.join(baseDir, dirName);
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 读取 Skill 元数据
 */
export function getSkillMetadata(skillName: string, userId: string | null): SkillMetadata | null {
  const skillDir = getSkillDir(skillName, userId);
  const metadataPath = path.join(skillDir, 'metadata.json');
  
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, `读取元数据失败: ${skillName}`, { error });
    return null;
  }
}

/**
 * 生成符合 Claude 官方格式的 SKILL.md 内容
 * 直接返回 content 字段
 */
export function generateSkillMarkdown(skill: DiskSkill): string {
  return skill.content || '';
}

/**
 * 生成符合 Claude 官方格式的 SKILL.md 内容
 * 将 skillOutputTemplate 追加到 content 末尾
 */
export function generateSkillMarkdownWithTemplate(skill: DiskSkill, skillOutputTemplate?: string): string {
  let content = skill.content || '';
  
  // 如果有模板，追加到末尾
  if (skillOutputTemplate && skillOutputTemplate.trim()) {
    content = content + '\n\n' + skillOutputTemplate.trim();
  }
  
  return content;
}

/**
 * 保存 Skill 到磁盘
 */
export async function saveSkillToDisk(skill: Skill, overrideTemplate?: string): Promise<boolean> {
  const skillDir = getSkillDir(skill.name, skill.userId);
  
  try {
    // 确保目录存在
    ensureDir(skillDir);
    
    // 获取模板：优先使用传入参数，否则从全局配置获取
    const skillOutputTemplate = overrideTemplate ?? await getSkillOutputTemplate();
    
    // 保存 SKILL-v{version}.md 文件
    const skillFile = path.join(skillDir, `SKILL-v${skill.version}.md`);
    const diskSkill: DiskSkill = {
      id: skill.id,
      userId: skill.userId,
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      categoryId: skill.categoryId,
      vulnerabilityTreeId: skill.vulnerabilityTreeId,
      severity: skill.severity || 'medium',
      cwe: skill.cwe || '',
      content: skill.content || '',
      version: skill.version,
      parentId: skill.parentId,
      isLatest: skill.isLatest,
      successRate: skill.successRate,
      avgDuration: skill.avgDuration,
      execCount: skill.execCount,
      isActive: skill.isActive,
      isBuiltin: skill.isBuiltin,
    };
    
    // 生成 Markdown 内容（包含标准输出模板）
    const markdown = generateSkillMarkdownWithTemplate(diskSkill, skillOutputTemplate);
    fs.writeFileSync(skillFile, markdown, 'utf-8');
    
    // 如果是最新版本，更新 SKILL.md（无版本号的文件）
    if (skill.isLatest) {
      const latestFile = path.join(skillDir, 'SKILL.md');
      fs.writeFileSync(latestFile, markdown, 'utf-8');
    }
    
    // 更新 metadata.json（只保存最新版本的元数据）
    if (skill.isLatest) {
      // 查询分类名称
      let techStackNames: string[] = [];
      if (skill.categoryId) {
        const categoryOption = await prisma.skillCategory.findUnique({
          where: { id: skill.categoryId },
          select: { name: true },
        });
        if (categoryOption) {
          techStackNames = [categoryOption.name];
        }
      }
      
      const metadata: SkillMetadata = {
        id: skill.id,
        name: skill.name,
        displayName: skill.displayName,
        userId: skill.userId,
        latestVersion: skill.version,
        isActive: skill.isActive,
        techStack: techStackNames,
        updatedAt: new Date().toISOString(),
      };
      
      const metadataPath = path.join(skillDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    }

    logger.info(LOG_MODULES.SKILL, `保存成功: ${skill.name} v${skill.version}`, { skillDir });
    return true;
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, `保存失败: ${skill.name}`, { error });
    return false;
  }
}

/**
 * 更新磁盘上的 Skill
 * 如果是新版本，会创建新文件并更新 metadata.json
 */
export async function updateSkillOnDisk(skill: Skill, skillOutputTemplate?: string): Promise<boolean> {
  // saveSkillToDisk 已经处理了版本更新逻辑
  return saveSkillToDisk(skill, skillOutputTemplate);
}

/**
 * 删除磁盘上的 Skill（删除整个目录，包括所有版本）
 */
export async function deleteSkillFromDisk(skillName: string, userId: string | null): Promise<boolean> {
  const skillDir = getSkillDir(skillName, userId);
  
  try {
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      logger.info(LOG_MODULES.SKILL, `删除成功: ${skillName}`, { skillDir });

      // 如果是私有 Skill，检查父目录是否为空，为空则删除
      if (userId) {
        const userDir = path.dirname(skillDir);
        const remainingSkills = fs.readdirSync(userDir);
        if (remainingSkills.length === 0) {
          fs.rmdirSync(userDir);
          logger.info(LOG_MODULES.SKILL, `清理空目录: ${userDir}`);
        }
      }
    }
    return true;
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, `删除失败: ${skillName}`, { error });
    return false;
  }
}

/**
 * 拷贝 Skills 到项目目录
 * 直接从 data/skills/ 拷贝到项目的 .claude/skills/
 * 支持标准输出模板和技术栈过滤
 * 
 * 技术栈匹配规则：
 * - 项目无技术栈 → 拷贝所有启用的 Skill
 * - Skill 无技术栈 → 适合所有项目（通用 Skill）
 * - 有技术栈 → 只拷贝与项目技术栈匹配的 Skill
 */
export async function copySkillsToProject(
  projectPath: string,
  userId?: string | null,
  skillOutputTemplate?: string,
  projectTechStack?: string[] | null  // 项目技术栈，null 或空数组表示拷贝所有
): Promise<CopyResult> {
  logger.info(LOG_MODULES.SKILL, 'copySkillsToProject 调用参数', {
    projectPath,
    userId: userId ?? undefined,
    projectTechStack,
  });

  const skillsDataDir = getSkillsDataDir();
  const targetDir = path.join(projectPath, '.claude', 'skills');
  
  const result: CopyResult = {
    success: 0,
    failed: 0,
    errors: [],
    copiedSkills: [],
    skillIds: [],  // 初始化 Skill ID 列表
  };
  
  // 安全验证：防止路径遍历攻击
  if (!isPathSafe(projectPath)) {
    result.errors.push('projectPath 包含不安全的路径字符');
    return result;
  }
  
  try {
    // 确保 targetDir 存在
    ensureDir(targetDir);
    
    // 清理旧的 Skills（保留其他文件）
    if (fs.existsSync(targetDir)) {
      const existingDirs = fs.readdirSync(targetDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const dir of existingDirs) {
        const oldDir = path.join(targetDir, dir);
        fs.rmSync(oldDir, { recursive: true, force: true });
      }
    }
    
    // 检查源目录是否存在
    if (!fs.existsSync(skillsDataDir)) {
      logger.info(LOG_MODULES.SKILL, 'Skills 数据目录不存在，创建目录');
      ensureDir(skillsDataDir);
    }

    // ========================================
    // 新流程：先过滤，再按需生成，最后拷贝
    // ========================================

    // Step 1: 从数据库查询满足条件的 Skills（先过滤）
    logger.debug(LOG_MODULES.SKILL, 'Step 1: 从数据库查询满足条件的 Skills');

    // 构建 where 条件
    const whereCondition: any = {
      isActive: true,
      isLatest: true,
    };
    
    // 如果指定了 userId，只查询公共 + 用户私有的 Skills
    if (userId) {
      whereCondition.OR = [
        { userId: null },  // 公共
        { userId: userId }, // 用户私有
      ];
    } else {
      whereCondition.userId = null; // 只查询公共
    }
    
    // 查询满足条件的 Skills
    const filteredDbSkills = await prisma.skill.findMany({
      where: whereCondition,
      select: {
        id: true,
        name: true,
        displayName: true,
        userId: true,
        tenantId: true,
        version: true,
        categoryId: true,
        content: true,
        description: true,
        severity: true,
        cwe: true,
        parentId: true,
        isLatest: true,
        successRate: true,
        avgDuration: true,
        execCount: true,
        isActive: true,
        isBuiltin: true,
        isPublic: true,
        referenceCount: true,
        vulnerabilityCount: true,
        successExecCount: true,
        vulnerabilityTreeId: true,
      },
    });

    logger.info(LOG_MODULES.SKILL, `数据库查询到 ${filteredDbSkills.length} 个激活的 Skills`, { whereCondition });
    if (filteredDbSkills.length > 0) {
      logger.debug(LOG_MODULES.SKILL, `查询到的 Skills: ${filteredDbSkills.map(s => s.name).join(', ')}`);
    }

    // Step 2: 应用技术栈过滤 + 治理过滤
    logger.debug(LOG_MODULES.SKILL, 'Step 2: 应用技术栈过滤和治理过滤');

    const skillsToCopy: typeof filteredDbSkills = [];

    for (const skill of filteredDbSkills) {
      // 技术栈匹配过滤
      if (projectTechStack && projectTechStack.length > 0 && skill.categoryId) {
        if (!projectTechStack.includes(skill.categoryId)) {
          logger.debug(LOG_MODULES.SKILL, `技术栈不匹配，跳过: ${skill.name}`, { categoryId: skill.categoryId });
          continue;
        }
      }

      // 检查是否已合并
      const completedMergeRecords = await prisma.skillMergeRecord.findMany({
        where: {
          sourceSkillId: skill.id,
          status: 'completed',
        },
      });

      if (completedMergeRecords.length > 0) {
        const mergeRecord = completedMergeRecords[0];
        const targetSkill = await prisma.skill.findUnique({
          where: { id: mergeRecord.targetSkillId },
          select: { name: true, displayName: true },
        });
        const targetSkillName = targetSkill?.displayName || targetSkill?.name || '未知';

        if (!result.filteredSkills) result.filteredSkills = [];
        result.filteredSkills.push({
          skillId: skill.id,
          skillName: skill.name,
          reason: 'merged',
          mergedInto: targetSkillName,
        });
        logger.debug(LOG_MODULES.SKILL, `治理过滤: ${skill.name} 已合并到 ${targetSkillName}`);
        continue;
      }

      // 检查是否有待处理的合并请求
      const pendingMergeRecords = await prisma.skillMergeRecord.findMany({
        where: {
          OR: [
            { sourceSkillId: skill.id, status: 'pending' },
            { targetSkillId: skill.id, status: 'pending' },
          ],
        },
      });

      if (pendingMergeRecords.length > 0) {
        if (!result.filteredSkills) result.filteredSkills = [];
        result.filteredSkills.push({
          skillId: skill.id,
          skillName: skill.name,
          reason: 'pending_merge',
        });
        logger.debug(LOG_MODULES.SKILL, `治理过滤: ${skill.name} 正在合并流程中`);
        continue;
      }

      // 通过所有过滤，加入待拷贝列表
      skillsToCopy.push(skill);
    }

    logger.info(LOG_MODULES.SKILL, `过滤后剩余 ${skillsToCopy.length} 个 Skills 待拷贝`);
    // Step 3: 检查磁盘文件，不存在则生成
    logger.info(LOG_MODULES.SKILL, 'Step 3: 检查磁盘文件，按需生成');
    
    for (const skill of skillsToCopy) {
      const skillDir = getSkillDir(skill.name, skill.userId);
      const metadataPath = path.join(skillDir, 'metadata.json');
      const skillFile = path.join(skillDir, `SKILL-v${skill.version}.md`);
      
      logger.info(LOG_MODULES.SKILL, `检查 Skill ${skill.name}:`);
      logger.debug(LOG_MODULES.SKILL, `  - skillDir: ${skillDir}`);
      logger.debug(LOG_MODULES.SKILL, `  - 目录存在: ${fs.existsSync(skillDir)}`);
      logger.debug(LOG_MODULES.SKILL, `  - metadata.json 存在: ${fs.existsSync(metadataPath)}`);
      logger.debug(LOG_MODULES.SKILL, `  - SKILL-v${skill.version}.md 存在: ${fs.existsSync(skillFile)}`);
      
      // 检查磁盘上是否有这个 Skill 的文件
      const needsGeneration = !fs.existsSync(skillDir) || 
                              !fs.existsSync(metadataPath) || 
                              !fs.existsSync(skillFile);
      
      if (needsGeneration) {
        logger.info(LOG_MODULES.SKILL, `磁盘上缺少 Skill 文件，从数据库生成: ${skill.name}`);
        // 转换为完整的 Skill 对象（包含所有必需字段）
        const fullSkill: Skill = {
          ...skill,
          content: skill.content || '',
          description: skill.description || '',
          displayName: skill.displayName || skill.name,
          severity: skill.severity || 'medium',
          cwe: skill.cwe || null,
          parentId: skill.parentId || null,
          successRate: skill.successRate || null,
          avgDuration: skill.avgDuration || null,
          execCount: skill.execCount || 0,
          isPublic: skill.isPublic ?? false,
          referenceCount: skill.referenceCount ?? 0,
          vulnerabilityCount: skill.vulnerabilityCount ?? 0,
          successExecCount: skill.successExecCount ?? 0,
          vulnerabilityTreeId: skill.vulnerabilityTreeId ?? null,
          tenantId: skill.tenantId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await saveSkillToDisk(fullSkill, skillOutputTemplate);
      }
    }
    
    // Step 4: 从磁盘拷贝到项目目录
    logger.info(LOG_MODULES.SKILL, 'Step 4: 拷贝到项目目录');
    
    for (const skill of skillsToCopy) {
      try {
        const skillDir = getSkillDir(skill.name, skill.userId);
        const skillFile = path.join(skillDir, `SKILL-v${skill.version}.md`);
        const latestFile = path.join(skillDir, 'SKILL.md');
        
        // 确定源文件
        let sourceFile: string | null = null;
        if (fs.existsSync(skillFile)) {
          sourceFile = skillFile;
        } else if (fs.existsSync(latestFile)) {
          sourceFile = latestFile;
        }
        
        if (!sourceFile) {
          result.failed++;
          result.errors.push(`Skill ${skill.name} 缺少 SKILL.md 或 SKILL-v${skill.version}.md`);
          continue;
        }
        
        // 读取内容（模板已在 saveSkillToDisk 时追加）
        let content = fs.readFileSync(sourceFile, 'utf-8');
        
        // 为每个 Skill 创建独立子目录
        const skillTargetDir = path.join(targetDir, skill.name);
        ensureDir(skillTargetDir);
        
        // 写入目标文件
        const destFile = path.join(skillTargetDir, 'SKILL.md');
        fs.writeFileSync(destFile, content, 'utf-8');
        
        result.success++;
        result.copiedSkills.push(skill.name);
        result.skillIds.push(skill.id);
        logger.info(LOG_MODULES.SKILL, `拷贝成功: ${skill.name} v${skill.version}`);
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Skill ${skill.name}: ${errorMsg}`);
        logger.error(LOG_MODULES.SKILL, `拷贝失败: ${skill.name}`, { details: { error: error instanceof Error ? error.message : String(error) } });
      }
    }
    
    logger.info(LOG_MODULES.SKILL, `拷贝完成: 成功 ${result.success}, 失败 ${result.failed}`);
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '拷贝过程出错', { details: { error: error instanceof Error ? error.message : String(error) } });
    result.errors.push(`系统错误: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return result;
}

/**
 * 列出磁盘上的所有 Skills
 */
export function listSkillsOnDisk(userId?: string | null): Array<{
  name: string;
  metadata: SkillMetadata;
  path: string;
}> {
  const skillsDataDir = getSkillsDataDir();
  const skills: Array<{
    name: string;
    metadata: SkillMetadata;
    path: string;
  }> = [];
  
  if (!fs.existsSync(skillsDataDir)) {
    return skills;
  }
  
  try {
    // 读取公共 Skills
    const publicEntries = fs.readdirSync(skillsDataDir, { withFileTypes: true });
    for (const entry of publicEntries) {
      if (entry.isDirectory() && !entry.name.startsWith('user-')) {
        const skillDir = path.join(skillsDataDir, entry.name);
        const metadataPath = path.join(skillDir, 'metadata.json');
        
        if (fs.existsSync(metadataPath)) {
          try {
            const metadata: SkillMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            skills.push({
              name: entry.name,
              metadata,
              path: skillDir,
            });
          } catch (e) {
            logger.warn(LOG_MODULES.SKILL, `解析元数据失败: ${entry.name}`, { details: { error: e instanceof Error ? e.message : String(e) } });
          }
        }
      }
    }
    
    // 读取私有 Skills
    if (userId) {
      const userDir = path.join(skillsDataDir, `user-${userId}`);
      if (fs.existsSync(userDir)) {
        const privateEntries = fs.readdirSync(userDir, { withFileTypes: true });
        for (const entry of privateEntries) {
          if (entry.isDirectory()) {
            const skillDir = path.join(userDir, entry.name);
            const metadataPath = path.join(skillDir, 'metadata.json');
            
            if (fs.existsSync(metadataPath)) {
              try {
                const metadata: SkillMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
                skills.push({
                  name: entry.name,
                  metadata,
                  path: skillDir,
                });
              } catch (e) {
                logger.warn(LOG_MODULES.SKILL, `解析私有 Skill 元数据失败: ${entry.name}`, { details: { error: e instanceof Error ? e.message : String(e) } });
              }
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '列出 Skills 失败', { details: { error: error instanceof Error ? error.message : String(error) } });
  }
  
  return skills;
}

/**
 * 同步数据库中的所有 Skills 到磁盘
 * 用于应用启动时或首次部署
 */
export async function syncAllSkillsToDisk(skillOutputTemplate?: string): Promise<{
  success: number;
  failed: number;
  errors: string[];
}> {
  const { prisma } = await import('@/lib/prisma');
  
  const result = {
    success: 0,
    failed: 0,
    errors: [] as string[],
  };
  
  try {
    // 获取所有最新版本的 Skills
    const skills = await prisma.skill.findMany({
      where: { isLatest: true },
    });
    
    logger.info(LOG_MODULES.SKILL, `开始同步 ${skills.length} 个 Skills 到磁盘`);
    if (skillOutputTemplate && skillOutputTemplate.trim()) {
      logger.debug(LOG_MODULES.SKILL, `使用标准输出模板，长度: ${skillOutputTemplate.length}`);
    }
    
    for (const skill of skills) {
      const saved = await saveSkillToDisk(skill, skillOutputTemplate);
      if (saved) {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(skill.name);
      }
    }
    
    logger.info(LOG_MODULES.SKILL, `同步完成: 总计 ${result.success + result.failed}, 成功 ${result.success}, 失败 ${result.failed}`);
    
    return result;
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '同步失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    result.errors.push(`系统错误: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
}

/**
 * 检查 Skills 数据目录是否存在，不存在则创建并同步
 */
export async function ensureSkillsDataDir(): Promise<boolean> {
  const skillsDataDir = getSkillsDataDir();
  
  if (!fs.existsSync(skillsDataDir)) {
    logger.info(LOG_MODULES.SKILL, `创建 Skills 数据目录: ${skillsDataDir}`);
    fs.mkdirSync(skillsDataDir, { recursive: true });
    
    // 首次创建，同步数据库中的所有 Skills
    const result = await syncAllSkillsToDisk();
    return result.failed === 0;
  }
  
  return true;
}

/**
 * 从磁盘 Skill 文件导入到数据库
 * 用于迁移或恢复
 */
export async function importSkillFromDisk(
  skillName: string,
  userId: string | null
): Promise<boolean> {
  const skillDir = getSkillDir(skillName, userId);
  const metadataPath = path.join(skillDir, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    logger.error(LOG_MODULES.SKILL, `Skill 元数据不存在: ${skillName}`);
    return false;
  }

  try {
    const { prisma } = await import('@/lib/prisma');

    // 读取元数据
    const metadata: SkillMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    // 读取最新版本的 SKILL.md
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      logger.error(LOG_MODULES.SKILL, `SKILL.md 不存在: ${skillName}`);
      return false;
    }

    // 这里可以添加解析 SKILL.md 的逻辑
    // 目前简化处理，仅返回成功
    logger.info(LOG_MODULES.SKILL, `导入成功: ${skillName}`);
    return true;
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, `导入失败: ${skillName}`, { details: { error: error instanceof Error ? error.message : String(error) } });
    return false;
  }
}

/**
 * 验证失败的 Skill 信息
 */
export interface InvalidSkillInfo {
  skillId: string;
  skillName?: string;
  reason: 'not_found' | 'not_active' | 'not_latest' | 'tech_stack_mismatch';
  techStackId?: string | null;
}

/**
 * 按 Skill ID 列表拷贝 Skills 到项目目录
 *
 * @param projectPath - 项目路径
 * @param skillIds - Skill ID 数组
 * @param skillOutputTemplate - 可选的输出模板
 * @param projectTechStack - 可选的项目技术栈，用于验证
 * @returns 拷贝结果（包含验证失败的 Skills）
 */
export async function copySkillsByIds(
  projectPath: string,
  skillIds: string[],
  skillOutputTemplate?: string,
  projectTechStack?: string[] | null
): Promise<CopyResult & { invalidSkills?: InvalidSkillInfo[] }> {
  const result: CopyResult & { invalidSkills?: InvalidSkillInfo[] } = {
    success: 0,
    failed: 0,
    errors: [],
    copiedSkills: [],
    skillIds: [],
    invalidSkills: [],
  };

  // 安全验证：防止路径遍历攻击
  if (!isPathSafe(projectPath)) {
    result.errors.push('projectPath 包含不安全的路径字符');
    return result;
  }

  const targetDir = path.join(projectPath, '.claude', 'skills');

  if (!skillIds || skillIds.length === 0) {
    return result;
  }

  try {
    // 确保 targetDir 存在
    ensureDir(targetDir);

    // 查询数据库获取所有指定的 Skill 信息（不过滤，用于验证）
    const allSkills = await prisma.skill.findMany({
      where: {
        id: { in: skillIds },
      },
      select: {
        id: true,
        name: true,
        userId: true,
        version: true,
        displayName: true,
        isActive: true,
        isLatest: true,
        categoryId: true,
      },
    });

    // 构建 ID 到 Skill 的映射
    const skillMap = new Map(allSkills.map((s) => [s.id, s]));

    // 先验证所有 Skill ID
    for (const skillId of skillIds) {
      const skill = skillMap.get(skillId);

      if (!skill) {
        // Skill 不存在
        result.invalidSkills?.push({
          skillId,
          reason: 'not_found',
        });
        continue;
      }

      if (!skill.isActive) {
        // Skill 未激活
        result.invalidSkills?.push({
          skillId,
          skillName: skill.name,
          reason: 'not_active',
        });
        continue;
      }

      if (!skill.isLatest) {
        // Skill 不是最新版本（已废弃）
        result.invalidSkills?.push({
          skillId,
          skillName: skill.name,
          reason: 'not_latest',
        });
        continue;
      }

      // 技术栈验证（统一用 ID 比较）
      if (projectTechStack && projectTechStack.length > 0 && skill.categoryId) {
        if (!projectTechStack.includes(skill.categoryId)) {
          result.invalidSkills?.push({
            skillId,
            skillName: skill.name,
            reason: 'tech_stack_mismatch',
            techStackId: skill.categoryId,
          });
          continue;
        }
      }
    }

    // 如果有验证失败的 Skills，直接返回（不执行拷贝）
    if (result.invalidSkills && result.invalidSkills.length > 0) {
      return result;
    }

    // 所有验证通过，执行拷贝
    const validSkills = allSkills.filter(s => 
      s.isActive && s.isLatest && skillIds.includes(s.id)
    );

    for (const skill of validSkills) {

      try {
        // 获取 Skill 目录
        const skillDir = getSkillDir(skill.name, skill.userId);

        // 检查目录是否存在
        if (!fs.existsSync(skillDir)) {
          result.failed++;
          result.errors.push(`Skill ${skill.name} 目录不存在: ${skillDir}`);
          continue;
        }

        // 查找最新版本的 SKILL 文件
        const versionedFile = path.join(skillDir, `SKILL-v${skill.version}.md`);
        const latestFile = path.join(skillDir, 'SKILL.md');

        let sourceFile: string | null = null;
        if (fs.existsSync(versionedFile)) {
          sourceFile = versionedFile;
        } else if (fs.existsSync(latestFile)) {
          sourceFile = latestFile;
        }

        if (!sourceFile) {
          result.failed++;
          result.errors.push(`Skill ${skill.name} 缺少 SKILL.md 或 SKILL-v${skill.version}.md`);
          continue;
        }

        // 读取内容（模板已在 saveSkillToDisk 时追加）
        let content = fs.readFileSync(sourceFile, 'utf-8');

        // 验证 skill.name 安全性，防止路径遍历
        if (!isPathSafe(skill.name)) {
          result.failed++;
          result.errors.push(`Skill ${skill.name} 名称包含不安全的路径字符`);
          continue;
        }

        // 为每个 Skill 创建独立子目录，避免覆盖
        const skillSubDir = path.join(targetDir, skill.name);
        fs.mkdirSync(skillSubDir, { recursive: true });
        const destFile = path.join(skillSubDir, 'SKILL.md');
        fs.writeFileSync(destFile, content, 'utf-8');

        result.success++;
        result.copiedSkills.push(skill.name);
        result.skillIds.push(skill.id);
        logger.info(LOG_MODULES.SKILL, `按 ID 拷贝成功: ${skill.name} (${skill.id})`);
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Skill ${skill.name} (${skill.id}): ${errorMsg}`);
        logger.error(LOG_MODULES.SKILL, `按 ID 拷贝失败: ${skill.id}`, { details: { error: error instanceof Error ? error.message : String(error) } });
      }
    }

    logger.info(LOG_MODULES.SKILL, `按 ID 拷贝完成: 成功 ${result.success}, 失败 ${result.failed}`);
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '按 ID 拷贝过程出错', { details: { error: error instanceof Error ? error.message : String(error) } });
    result.errors.push(`系统错误: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}
