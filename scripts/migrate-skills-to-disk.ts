#!/usr/bin/env ts-node
/**
 * Skills 迁移脚本
 * 
 * 将现有数据库中的 Skills 导出到磁盘
 * 用于首次部署或数据迁移
 * 
 * 使用方法：
 * npx ts-node scripts/migrate-skills-to-disk.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface SkillMetadata {
  id: string;
  name: string;
  displayName: string;
  userId: string | null;
  latestVersion: number;
  isActive: boolean;
  updatedAt: string;
}

/**
 * 获取 Skills 数据目录
 */
function getSkillsDataDir(): string {
  const rootDir = process.cwd();
  return path.join(rootDir, 'data', 'skills');
}

/**
 * 获取单个 Skill 的目录路径
 */
function getSkillDir(skillName: string, userId: string | null): string {
  const baseDir = getSkillsDataDir();
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
 * 生成 SKILL.md 内容
 */
function generateSkillMarkdown(skill: any): string {
  let markdown = '---\n';
  markdown += `name: ${skill.name}\n`;
  markdown += `description: ${skill.description}\n`;
  markdown += '---\n\n';
  markdown += skill.systemPrompt;
  
  if (skill.userPrompt && skill.userPrompt !== skill.systemPrompt) {
    markdown += '\n\n---\n\n';
    markdown += '## 用户提示词\n\n';
    markdown += skill.userPrompt;
  }
  
  return markdown;
}

/**
 * 保存 Skill 到磁盘
 */
function saveSkillToDisk(skill: any): boolean {
  const skillDir = getSkillDir(skill.name, skill.userId);
  
  try {
    ensureDir(skillDir);
    
    // 保存版本文件
    const skillFile = path.join(skillDir, `SKILL-v${skill.version}.md`);
    const markdown = generateSkillMarkdown(skill);
    fs.writeFileSync(skillFile, markdown, 'utf-8');
    
    // 如果是最新版本，也保存 SKILL.md
    if (skill.isLatest) {
      const latestFile = path.join(skillDir, 'SKILL.md');
      fs.writeFileSync(latestFile, markdown, 'utf-8');
      
      // 保存 metadata.json
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
    
    console.log(`✓ ${skill.name} v${skill.version} -> ${skillDir}`);
    return true;
  } catch (error) {
    console.error(`✗ ${skill.name}:`, error);
    return false;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('Skills 迁移脚本');
  console.log('========================================\n');
  
  try {
    // 获取所有最新版本的 Skills
    const skills = await prisma.skill.findMany({
      where: { isLatest: true },
      orderBy: [
        { userId: 'asc' },
        { name: 'asc' },
      ],
    });
    
    console.log(`找到 ${skills.length} 个 Skills\n`);
    
    if (skills.length === 0) {
      console.log('没有需要迁移的 Skills');
      return;
    }
    
    // 确保目录存在
    const dataDir = getSkillsDataDir();
    ensureDir(dataDir);
    console.log(`目标目录: ${dataDir}\n`);
    
    // 迁移统计
    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    
    // 迁移每个 Skill
    for (const skill of skills) {
      const saved = saveSkillToDisk(skill);
      if (saved) {
        success++;
      } else {
        failed++;
        errors.push(skill.name);
      }
    }
    
    // 输出结果
    console.log('\n========================================');
    console.log('迁移完成');
    console.log('========================================');
    console.log(`成功: ${success}`);
    console.log(`失败: ${failed}`);
    
    if (errors.length > 0) {
      console.log('\n失败的 Skills:');
      errors.forEach(name => console.log(`  - ${name}`));
    }
    
    console.log('\n提示: 可以通过 API 再次同步:');
    console.log('POST /api/sync/skills { "action": "sync" }');
    
  } catch (error) {
    console.error('迁移失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
