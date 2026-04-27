const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    // 检查数据库中的 Skill 列表
    const skills = await prisma.skill.findMany({
      where: { isActive: true, isLatest: true },
      select: { id: true, name: true, displayName: true, content: true },
      take: 20,
    });
    
    console.log('=== 数据库中的 Skill 列表 ===');
    console.log(`总数: ${skills.length}`);
    for (const skill of skills) {
      console.log(`- ${skill.name}: ${skill.displayName}`);
      console.log(`  内容长度: ${skill.content?.length || 0}`);
    }
    
    if (skills.length === 0) {
      console.log('\n⚠️  数据库中没有 Skill 记录！');
      console.log('Skill 工具需要数据库中有 Skill 记录才能使用。');
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();