/**
 * 完整导入脚本 - 将所有解析的 Skill 导入数据库
 * 包含格式标准化（简化版）
 */
import { prisma } from '../src/lib/prisma';
import { promises as fs } from 'fs';
import * as path from 'path';

const PARSED_DIR = '.sisyphus\\parsed';

interface ParsedSkill {
  sourceFile: string;
  techStack: string | null;
  vulnCategory: string | null;
  vulnPattern: string | null;
  name: string;
  displayName: string;
  content: string;
  targetLanguage?: string;
}

// 生成 AI4WEB 标准格式的 Skill 内容
function standardizeContent(skill: ParsedSkill): string {
  const { name, displayName, techStack, vulnPattern, content } = skill;
  
  // 提取原始内容的关键信息
  const lines = content.split('\n');
  const title = lines.find(l => l.startsWith('# '))?.replace('# ', '') || displayName;
  
  // 生成 YAML frontmatter
  const yaml = `---
name: ${name}
description: |
  ${displayName} 安全检测专家
  适用技术栈：${techStack || '通用'}
  触发条件：用户要求审计 ${vulnPattern || '安全漏洞'} 相关问题
---`;

  // 生成标准章节（如果原始内容不包含）
  const hasRole = content.includes('## 0. 角色定位') || content.includes('> 你是');
  const hasSteps = content.includes('## 3. 检测步骤') || content.includes('## 检测步骤');
  
  let standardizedContent = content;
  
  // 如果原始内容格式不对，添加标准章节
  if (!hasRole && !content.startsWith('# ')) {
    standardizedContent = `# ${displayName}

## 0. 角色定位

- 你是专门检测 ${displayName} 的安全专家
- 你的核心职责是识别代码中 ${vulnPattern || '安全漏洞'} 相关的风险点

${content}`;
  }
  
  return `${yaml}

${standardizedContent}`;
}

// 查找或创建 TechStackOption
async function getOrCreateTechStack(techStack: string | null): Promise<string | null> {
  if (!techStack) return null;
  
  const existing = await prisma.techStackOption.findFirst({
    where: { name: techStack },
  });
  
  if (existing) return existing.id;
  
  // 创建新的
  const now = new Date();
  const created = await prisma.techStackOption.create({
    data: {
      id: `ts_${techStack}_${Date.now()}`,
      name: techStack,
      category: 'language',
      description: `${techStack} 语言`,
      isBuiltin: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  
  console.log(`    + 创建技术栈: ${techStack}`);
  return created.id;
}

// 查找或创建 VulnerabilityPattern
async function getOrCreateVulnPattern(vulnPattern: string | null, category: string | null): Promise<string | null> {
  if (!vulnPattern) return null;
  
  const existing = await prisma.vulnerabilityPattern.findFirst({
    where: { name: vulnPattern },
  });
  
  if (existing) return existing.id;
  
  // 创建新的
  const now = new Date();
  const created = await prisma.vulnerabilityPattern.create({
    data: {
      id: `vp_${vulnPattern}_${Date.now()}`,
      name: vulnPattern,
      displayName: vulnPattern,
      category: category || 'other',
      patterns: '[]',
      languages: '',
      description: `${vulnPattern} 漏洞检测`,
      isBuiltin: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  
  console.log(`    + 创建漏洞模式: ${vulnPattern}`);
  return created.id;
}

// 导入单个批次
async function importBatch(jsonFile: string, batchName: string): Promise<{ success: number; failed: number }> {
  console.log(`\n=== 导入 ${batchName} ===`);
  
  const filePath = path.join(PARSED_DIR, jsonFile);
  const exists = await fs.stat(filePath).catch(() => null);
  
  if (!exists) {
    console.log(`  ⚠ 文件不存在: ${filePath}`);
    return { success: 0, failed: 0 };
  }
  
  const content = await fs.readFile(filePath, 'utf-8');
  const skills: ParsedSkill[] = JSON.parse(content);
  
  let success = 0;
  let failed = 0;
  const now = new Date();
  
  for (const skill of skills) {
    try {
      // 查找或创建关联
      const techStackId = await getOrCreateTechStack(skill.techStack);
      const vulnPatternId = await getOrCreateVulnPattern(skill.vulnPattern, skill.vulnCategory);
      
      // 标准化内容
      const standardizedContent = standardizeContent(skill);
      
      // 生成唯一 ID
      const skillId = `sk_${skill.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 创建 Skill
      await prisma.skill.create({
        data: {
          id: skillId,
          name: skill.name,
          displayName: skill.displayName,
          description: `${skill.displayName} - ${skill.sourceFile}`,
          category: skill.vulnCategory || 'code-audit',
          content: standardizedContent,
          techStackId,
          vulnerabilityPatternId: vulnPatternId,
          isActive: true,
          isBuiltin: false,
          isPublic: false,
          version: 1,
          isLatest: true,
          migrationStatus: 'migrated',
          createdAt: now,
          updatedAt: now,
        },
      });
      
      success++;
      if (success % 10 === 0) {
        console.log(`  进度: ${success}/${skills.length}`);
      }
    } catch (error: any) {
      console.log(`  ✗ ${skill.name}: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`  ✓ 完成: ${success} 成功, ${failed} 失败`);
  return { success, failed };
}

// 主函数
async function main() {
  console.log('=== 开始导入所有 Skill ===\n');
  
  const results = {
    languages: { success: 0, failed: 0 },
    frameworks: { success: 0, failed: 0 },
    checklists: { success: 0, failed: 0 },
    adapters: { success: 0, failed: 0 },
    core: { success: 0, failed: 0 },
    wooyun: { success: 0, failed: 0 },
    security: { success: 0, failed: 0 },
  };
  
  // 按顺序导入各批次
  results.languages = await importBatch('languages.json', 'languages');
  results.frameworks = await importBatch('frameworks.json', 'frameworks');
  results.checklists = await importBatch('checklists.json', 'checklists');
  results.adapters = await importBatch('adapters.json', 'adapters');
  results.core = await importBatch('core.json', 'core');
  results.wooyun = await importBatch('wooyun-split.json', 'wooyun');
  results.security = await importBatch('security-split.json', 'security');
  
  // 统计
  console.log('\n=== 导入统计 ===');
  let totalSuccess = 0;
  let totalFailed = 0;
  
  for (const [batch, result] of Object.entries(results)) {
    console.log(`${batch}: ${result.success} 成功, ${result.failed} 失败`);
    totalSuccess += result.success;
    totalFailed += result.failed;
  }
  
  console.log(`\n总计: ${totalSuccess} 成功, ${totalFailed} 失败`);
  
  // 生成迁移报告
  const report = {
    timestamp: new Date().toISOString(),
    success_count: totalSuccess,
    fail_count: totalFailed,
    batches: results,
  };
  
  await fs.writeFile('migration-report.json', JSON.stringify(report, null, 2));
  console.log('\n✓ 迁移报告已保存到 migration-report.json');
  
  // 数据库统计
  const skillCount = await prisma.skill.count();
  const techStackCount = await prisma.techStackOption.count();
  const vulnPatternCount = await prisma.vulnerabilityPattern.count();
  
  console.log('\n=== 数据库最终状态 ===');
  console.log(`Skill: ${skillCount}`);
  console.log(`TechStackOption: ${techStackCount}`);
  console.log(`VulnerabilityPattern: ${vulnPatternCount}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
