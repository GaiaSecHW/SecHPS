const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Get total count first
  const total = await prisma.skill.count();
  console.log(`Total Skills: ${total}`);
  
  // Get random sample - using raw query for RANDOM()
  const skills = await prisma.$queryRaw`
    SELECT id, name, content FROM Skill ORDER BY RANDOM() LIMIT 22
  `;
  
  console.log('\nSampled Skills:');
  skills.forEach(s => {
    console.log(`ID: ${s.id}, Name: ${s.name}, Content Length: ${s.content?.length || 0}`);
  });
  
  return skills;
}

main()
  .then(skills => {
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });