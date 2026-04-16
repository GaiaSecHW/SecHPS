const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const skills = await prisma.skill.findMany({
    where: { isLatest: true },
    select: { id: true, name: true, displayName: true, description: true, category: true, content: true },
    take: 5
  });
  
  for (const skill of skills) {
    console.log('========================================');
    console.log('Skill:', skill.name);
    console.log('DisplayName:', skill.displayName);
    console.log('Category:', skill.category);
    console.log('Description:', skill.description?.substring(0, 200));
    
    // 提取 YAML frontmatter
    const yamlMatch = skill.content.match(/^---\n([\s\S]*?)\n---/);
    if (yamlMatch) {
      console.log('--- YAML Frontmatter ---');
      console.log(yamlMatch[1]);
    }
    console.log('');
  }
  
  console.log('Total skills:', skills.length);
}

main().finally(() => prisma.$disconnect());
