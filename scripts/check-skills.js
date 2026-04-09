const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.skill.count();
  console.log('Total skills:', count);
  
  const skills = await prisma.skill.findMany({ 
    take: 2, 
    select: { id: true, name: true, displayName: true, content: true } 
  });
  
  for (const s of skills) {
    console.log('---');
    console.log('Name:', s.name);
    console.log('DisplayName:', s.displayName);
    console.log('Content length:', s.content?.length || 0);
    console.log('Content preview:', s.content?.substring(0, 100));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
