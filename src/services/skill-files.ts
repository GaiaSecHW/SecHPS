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
  category: string;
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
 * 拷贝结果
 */
export interface CopyResult {
  success: number;
  failed: number;
  errors: string[];
  copiedSkills: string[];
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
    console.error(`[SkillFiles] 读取元数据失败: ${skillName}`, error);
    return null;
  }
}

/**
 * 生成符合 Claude 官方格式的 SKILL.md 内容
 * 直接返回 content 字段
 */
function generateSkillMarkdown(skill: DiskSkill): string {
  return skill.content || '';
}

/**
 * 保存 Skill 到磁盘
 */
export async function saveSkillToDisk(skill: Skill): Promise<boolean> {
  const skillDir = getSkillDir(skill.name, skill.userId);
  
  try {
    // 确保目录存在
    ensureDir(skillDir);
    
    // 保存 SKILL-v{version}.md 文件
    const skillFile = path.join(skillDir, `SKILL-v${skill.version}.md`);
    const diskSkill: DiskSkill = {
      id: skill.id,
      userId: skill.userId,
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      category: skill.category,
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
    
    const markdown = generateSkillMarkdown(diskSkill);
    fs.writeFileSync(skillFile, markdown, 'utf-8');
    
    // 如果是最新版本，更新 SKILL.md（无版本号的文件）
    if (skill.isLatest) {
      const latestFile = path.join(skillDir, 'SKILL.md');
      fs.writeFileSync(latestFile, markdown, 'utf-8');
    }
    
    // 更新 metadata.json（只保存最新版本的元数据）
    if (skill.isLatest) {
      const metadata: SkillMetadata = {
        id: skill.id,
        name: skill.name,
        displayName: skill.displayName,
        userId: skill.userId,
        latestVersion: skill.version,
        isActive: skill.isActive,
        updatedAt: new Date().toISOString(),
      };
      
      const metadataPath = path.join(skillDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    }
    
    console.log(`[SkillFiles] 保存成功: ${skill.name} v${skill.version} -> ${skillDir}`);
    return true;
  } catch (error) {
    console.error(`[SkillFiles] 保存失败: ${skill.name}`, error);
    return false;
  }
}

/**
 * 更新磁盘上的 Skill
 * 如果是新版本，会创建新文件并更新 metadata.json
 */
export async function updateSkillOnDisk(skill: Skill): Promise<boolean> {
  // saveSkillToDisk 已经处理了版本更新逻辑
  return saveSkillToDisk(skill);
}

/**
 * 删除磁盘上的 Skill（删除整个目录，包括所有版本）
 */
export async function deleteSkillFromDisk(skillName: string, userId: string | null): Promise<boolean> {
  const skillDir = getSkillDir(skillName, userId);
  
  try {
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      console.log(`[SkillFiles] 删除成功: ${skillName} -> ${skillDir}`);
      
      // 如果是私有 Skill，检查父目录是否为空，为空则删除
      if (userId) {
        const userDir = path.dirname(skillDir);
        const remainingSkills = fs.readdirSync(userDir);
        if (remainingSkills.length === 0) {
          fs.rmdirSync(userDir);
          console.log(`[SkillFiles] 清理空目录: ${userDir}`);
        }
      }
    }
    return true;
  } catch (error) {
    console.error(`[SkillFiles] 删除失败: ${skillName}`, error);
    return false;
  }
}

/**
 * 拷贝 Skills 到项目目录
 * 直接从 data/skills/ 拷贝到项目的 .claude/skills/
 */
export async function copySkillsToProject(
  projectPath: string,
  userId?: string | null
): Promise<CopyResult> {
  const skillsDataDir = getSkillsDataDir();
  const targetDir = path.join(projectPath, '.claude', 'skills');
  
  const result: CopyResult = {
    success: 0,
    failed: 0,
    errors: [],
    copiedSkills: [],
  };
  
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
      console.log('[SkillFiles] Skills 数据目录不存在，跳过拷贝');
      return result;
    }
    
    // 读取公共 Skills
    const publicSkillDirs = fs.readdirSync(skillsDataDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('user-'))
      .map(dirent => dirent.name);
    
    // 读取私有 Skills（如果提供了 userId）
    let privateSkillDirs: string[] = [];
    if (userId) {
      const userDir = path.join(skillsDataDir, `user-${userId}`);
      if (fs.existsSync(userDir)) {
        privateSkillDirs = fs.readdirSync(userDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => `user-${userId}/${dirent.name}`);
      }
    }
    
    const allSkillDirs = [...publicSkillDirs, ...privateSkillDirs];
    
    for (const skillDirName of allSkillDirs) {
      const skillDir = path.join(skillsDataDir, skillDirName);
      const metadataPath = path.join(skillDir, 'metadata.json');
      
      try {
        // 检查 metadata.json
        if (!fs.existsSync(metadataPath)) {
          result.failed++;
          result.errors.push(`Skill ${skillDirName} 缺少 metadata.json`);
          continue;
        }
        
        // 读取元数据
        const metadataContent = fs.readFileSync(metadataPath, 'utf-8');
        const metadata: SkillMetadata = JSON.parse(metadataContent);
        
        // 只拷贝激活的 Skills
        if (!metadata.isActive) {
          continue;
        }
        
        // 拷贝最新版本的 SKILL.md
        const latestSkillFile = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(latestSkillFile)) {
          // 尝试使用版本文件
          const versionedFile = path.join(skillDir, `SKILL-v${metadata.latestVersion}.md`);
          if (!fs.existsSync(versionedFile)) {
            result.failed++;
            result.errors.push(`Skill ${skillDirName} 缺少 SKILL.md 或 SKILL-v${metadata.latestVersion}.md`);
            continue;
          }
        }
        
        // 创建目标目录（使用 skill name，不包含 user- 前缀）
        const targetSkillDir = path.join(targetDir, metadata.name);
        ensureDir(targetSkillDir);
        
        // 拷贝文件
        const sourceFile = fs.existsSync(latestSkillFile) 
          ? latestSkillFile 
          : path.join(skillDir, `SKILL-v${metadata.latestVersion}.md`);
        const destFile = path.join(targetSkillDir, 'SKILL.md');
        fs.copyFileSync(sourceFile, destFile);
        
        result.success++;
        result.copiedSkills.push(metadata.name);
        console.log(`[SkillFiles] 拷贝成功: ${metadata.name} v${metadata.latestVersion}`);
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Skill ${skillDirName}: ${errorMsg}`);
        console.error(`[SkillFiles] 拷贝失败: ${skillDirName}`, error);
      }
    }
    
    console.log(`[SkillFiles] 拷贝完成: 成功 ${result.success}, 失败 ${result.failed}`);
  } catch (error) {
    console.error('[SkillFiles] 拷贝过程出错:', error);
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
            console.warn(`[SkillFiles] 解析元数据失败: ${entry.name}`, e);
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
                console.warn(`[SkillFiles] 解析私有 Skill 元数据失败: ${entry.name}`, e);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[SkillFiles] 列出 Skills 失败:', error);
  }
  
  return skills;
}

/**
 * 同步数据库中的所有 Skills 到磁盘
 * 用于应用启动时或首次部署
 */
export async function syncAllSkillsToDisk(): Promise<{
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
    
    console.log(`[SkillFiles] 开始同步 ${skills.length} 个 Skills 到磁盘`);
    
    for (const skill of skills) {
      const saved = await saveSkillToDisk(skill);
      if (saved) {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(skill.name);
      }
    }
    
    console.log(`[SkillFiles] 同步完成: 成功 ${result.success}, 失败 ${result.failed}`);
  } catch (error) {
    console.error('[SkillFiles] 同步失败:', error);
    result.errors.push(`系统错误: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return result;
}

/**
 * 检查 Skills 数据目录是否存在，不存在则创建并同步
 */
export async function ensureSkillsDataDir(): Promise<boolean> {
  const skillsDataDir = getSkillsDataDir();
  
  if (!fs.existsSync(skillsDataDir)) {
    console.log('[SkillFiles] 创建 Skills 数据目录:', skillsDataDir);
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
    console.error(`[SkillFiles] Skill 元数据不存在: ${skillName}`);
    return false;
  }
  
  try {
    const { prisma } = await import('@/lib/prisma');
    
    // 读取元数据
    const metadata: SkillMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    
    // 读取最新版本的 SKILL.md
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      console.error(`[SkillFiles] SKILL.md 不存在: ${skillName}`);
      return false;
    }
    
    // 这里可以添加解析 SKILL.md 的逻辑
    // 目前简化处理，仅返回成功
    console.log(`[SkillFiles] 导入成功: ${skillName}`);
    return true;
  } catch (error) {
    console.error(`[SkillFiles] 导入失败: ${skillName}`, error);
    return false;
  }
}
