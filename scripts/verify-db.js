const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
  console.log('========================================');
  console.log('数据库状态验证');
  console.log('========================================\n');

  // 1. 检查 VulnerabilityPattern 数据
  const vulnPatterns = await prisma.vulnerabilityPattern.count();
  console.log('VulnerabilityPattern 记录数:', vulnPatterns);
  
  // 2. 检查 TechStackOption 数据
  const techStackOptions = await prisma.techStackOption.count();
  const languages = await prisma.techStackOption.count({ where: { category: 'language' } });
  console.log('TechStackOption 记录数:', techStackOptions, '(语言:', languages, ')');
  
  // 3. 检查 Skill 迁移状态
  const skills = await prisma.skill.count({ where: { isLatest: true } });
  const pending = await prisma.skill.count({ where: { migrationStatus: 'pending', isLatest: true } });
  const migrated = await prisma.skill.count({ where: { migrationStatus: 'migrated', isLatest: true } });
  const pendingReview = await prisma.skill.count({ where: { migrationStatus: 'pending_review', isLatest: true } });
  const failed = await prisma.skill.count({ where: { migrationStatus: 'failed', isLatest: true } });
  console.log('Skill 记录数:', skills);
  console.log('  - 待迁移:', pending);
  console.log('  - 已迁移:', migrated);
  console.log('  - 待审核:', pendingReview);
  console.log('  - 失败:', failed);
  
  // 4. 检查 SkillAnalysis 表
  const analyses = await prisma.skillAnalysis.count();
  console.log('SkillAnalysis 记录数:', analyses);
  
  // 5. 检查 SkillDuplicateGroup 表
  const groups = await prisma.skillDuplicateGroup.count();
  console.log('SkillDuplicateGroup 记录数:', groups);
  
  // 6. 检查新增字段是否有数据
  const skillWithTechStackId = await prisma.skill.count({ 
    where: { techStackId: { not: null }, isLatest: true } 
  });
  const skillWithVulnPatternId = await prisma.skill.count({ 
    where: { vulnerabilityPatternId: { not: null }, isLatest: true } 
  });
  console.log('\n新字段使用情况:');
  console.log('  - 有 techStackId:', skillWithTechStackId);
  console.log('  - 有 vulnerabilityPatternId:', skillWithVulnPatternId);
  
  await prisma.$disconnect();
  
  console.log('\n========================================');
  console.log('验证完成');
  console.log('========================================');
}

verify().catch(e => {
  console.error('验证失败:', e);
  process.exit(1);
});
