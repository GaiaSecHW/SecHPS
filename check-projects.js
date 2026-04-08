const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      name: true,
      projectPath: true,
      createdAt: true
    }
  });

  console.log('\n最近的 5 个 AI4WEB 项目:');
  console.log(JSON.stringify(projects, null, 2));

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
