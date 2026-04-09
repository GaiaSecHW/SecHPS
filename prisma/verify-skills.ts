// 验证 Skills 数据
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const skills = await prisma.skill.findMany({
    select: {
      name: true,
      displayName: true,
      category: true,
      severity: true,
      content: true,
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  console.log(`\n总共有 ${skills.length} 个 Skills:\n`);
  
  skills.forEach((skill, index) => {
    console.log(`${index + 1}. ${skill.displayName} (${skill.name})`);
    console.log(`   分类: ${skill.category}, 严重程度: ${skill.severity}`);
    console.log(`   内容长度: ${skill.content.length} 字符`);
    console.log(`   内容预览: ${skill.content.substring(0, 100)}...`);
    console.log('');
  });

  // 验证 content 字段
  const missingContent = skills.filter(s => !s.content || s.content.length === 0);
  if (missingContent.length > 0) {
    console.log(`⚠️  有 ${missingContent.length} 个 Skills 缺少 content 字段`);
  } else {
    console.log('✅ 所有 Skills 都有 content 字段');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
