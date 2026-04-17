/**
 * 最终验证脚本
 */
import { prisma } from '../src/lib/prisma';

async function verify() {
  console.log('=== 最终验证 ===\n');
  
  // F1: 数据完整性验证
  console.log('--- F1: 数据完整性 ---');
  const skillCount = await prisma.skill.count();
  const techStackCount = await prisma.techStackOption.count();
  const vulnPatternCount = await prisma.vulnerabilityPattern.count();
  
  console.log(`Skill: ${skillCount} (预期: >= 200)`);
  console.log(`TechStackOption: ${techStackCount} (预期: >= 23)`);
  console.log(`VulnerabilityPattern: ${vulnPatternCount} (预期: >= 40)`);
  
  // F3: 孤儿记录检查
  console.log('\n--- F3: 孤儿记录 ---');
  const orphanSkills = await prisma.skill.count({
    where: {
      techStackId: null,
      category: { not: 'methodology' },
    },
  });
  console.log(`孤儿 Skill (无技术栈): ${orphanSkills} (预期: 0 或接近0)`);
  
  // F2: 格式合规性抽样检查
  console.log('\n--- F2: 格式合规性抽样 ---');
  const samples = await prisma.skill.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { name: true, content: true },
  });
  
  let formatOk = 0;
  for (const s of samples) {
    const hasYaml = s.content.includes('---');
    const hasTitle = s.content.includes('# ');
    console.log(`  ${s.name}: YAML=${hasYaml}, 标题=${hasTitle}`);
    if (hasYaml || hasTitle) formatOk++;
  }
  console.log(`格式合规: ${formatOk}/${samples.length}`);
  
  // 分类统计
  console.log('\n--- 分类统计 ---');
  const categories = await prisma.skill.groupBy({
    by: ['category'],
    _count: true,
    orderBy: { _count: { category: 'desc' } },
  });
  
  for (const c of categories) {
    console.log(`  ${c.category}: ${c._count}`);
  }
  
  // 最终判定
  console.log('\n=== 最终判定 ===');
  const allPass = skillCount >= 200 && techStackCount >= 23 && vulnPatternCount >= 40;
  console.log(`数据完整性: ${skillCount >= 200 ? '✓' : '✗'}`);
  console.log(`技术栈: ${techStackCount >= 23 ? '✓' : '✗'}`);
  console.log(`漏洞模式: ${vulnPatternCount >= 40 ? '✓' : '✗'}`);
  console.log(`\n最终结果: ${allPass ? '✓ 通过' : '✗ 需要检查'}`);
}

verify()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
