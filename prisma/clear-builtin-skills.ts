// prisma/clear-builtin-skills.ts
// 清除所有内置 Skills 数据

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('开始清除内置 Skills...');

  // 查找所有内置 Skills
  const builtinSkills = await prisma.skill.findMany({
    where: {
      isBuiltin: true,
    },
    select: {
      id: true,
      name: true,
      displayName: true,
    },
  });

  console.log(`找到 ${builtinSkills.length} 个内置 Skills:`);
  builtinSkills.forEach((skill) => {
    console.log(`  - ${skill.name} (${skill.displayName})`);
  });

  if (builtinSkills.length === 0) {
    console.log('没有内置 Skills 需要清除');
    return;
  }

  // 删除所有内置 Skills
  const deleteResult = await prisma.skill.deleteMany({
    where: {
      isBuiltin: true,
    },
  });

  console.log(`\n已清除 ${deleteResult.count} 个内置 Skills`);
  console.log('清除完成！');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });