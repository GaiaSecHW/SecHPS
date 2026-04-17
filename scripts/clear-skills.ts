/**
 * 清空 Skill 相关数据
 */
import { prisma } from '../src/lib/prisma';

async function clearSkills() {
  console.log('开始清空数据...');
  
  try {
    // 1. 删除所有 Skill
    const skillCount = await prisma.skill.deleteMany({});
    console.log(`✓ 删除 Skill: ${skillCount.count} 条`);
    
    // 2. 删除非内置的 TechStackOption
    const techStackCount = await prisma.techStackOption.deleteMany({
      where: { isBuiltin: false }
    });
    console.log(`✓ 删除 TechStackOption (非内置): ${techStackCount.count} 条`);
    
    // 3. 删除非内置的 VulnerabilityPattern
    const vulnPatternCount = await prisma.vulnerabilityPattern.deleteMany({
      where: { isBuiltin: false }
    });
    console.log(`✓ 删除 VulnerabilityPattern (非内置): ${vulnPatternCount.count} 条`);
    
    // 4. 统计剩余数据
    const remainingSkills = await prisma.skill.count();
    const remainingTechStacks = await prisma.techStackOption.count();
    const remainingVulnPatterns = await prisma.vulnerabilityPattern.count();
    
    console.log('\n--- 清空后统计 ---');
    console.log(`Skill 剩余: ${remainingSkills}`);
    console.log(`TechStackOption 剩余: ${remainingTechStacks}`);
    console.log(`VulnerabilityPattern 剩余: ${remainingVulnPatterns}`);
    
    console.log('\n✅ 数据清空完成');
  } catch (error) {
    console.error('清空数据失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

clearSkills();
