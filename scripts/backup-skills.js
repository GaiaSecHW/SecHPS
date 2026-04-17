/**
 * 备份 Skill 数据脚本
 * 导出所有 Skill 数据到 JSON 文件，用于迁移前备份
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function backupSkills() {
  console.log('开始备份 Skill 数据...');
  
  const skills = await prisma.skill.findMany({
    select: {
      id: true,
      name: true,
      displayName: true,
      description: true,
      category: true,
      techStack: true,
      cwe: true,
      content: true,
      severity: true,
      userId: true,
      isBuiltin: true,
      isPublic: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    }
  });
  
  console.log(`找到 ${skills.length} 条 Skill 记录`);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(process.cwd(), 'data', `skills-backup-${timestamp}.json`);
  
  // 确保 data 目录存在
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  fs.writeFileSync(backupPath, JSON.stringify(skills, null, 2), 'utf-8');
  
  // 统计信息
  const stats = {
    total: skills.length,
    hasTechStack: skills.filter(s => s.techStack).length,
    hasCategory: skills.filter(s => s.category).length,
    hasCwe: skills.filter(s => s.cwe).length,
    categories: [...new Set(skills.map(s => s.category).filter(Boolean))],
    techStackExamples: skills.slice(0, 10).map(s => ({ 
      name: s.name, 
      techStack: s.techStack,
      category: s.category 
    })),
  };
  
  console.log('\n备份统计:');
  console.log(JSON.stringify(stats, null, 2));
  console.log(`\n备份文件: ${backupPath}`);
  
  await prisma.$disconnect();
  
  return { backupPath, stats };
}

backupSkills().catch(e => {
  console.error('备份失败:', e);
  process.exit(1);
});
