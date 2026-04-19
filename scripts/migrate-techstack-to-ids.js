// 将 Project.techStack 和 Workflow.techStack 中的名称迁移为 ID
const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 获取所有技术栈选项，建立 name -> id 映射
  const opts = await prisma.techStackOption.findMany({
    select: { id: true, name: true },
  });
  const nameToId = Object.fromEntries(opts.map(o => [o.name, o.id]));
  console.log(`加载了 ${opts.length} 个技术栈选项`);

  // 迁移 Project.techStack
  const projects = await prisma.project.findMany({
    where: { techStack: { not: null } },
    select: { id: true, techStack: true },
  });
  console.log(`\n找到 ${projects.length} 个有技术栈的项目`);
  let projectUpdated = 0;
  for (const p of projects) {
    try {
      const arr = JSON.parse(p.techStack);
      const converted = arr.map(n => nameToId[n] || n);
      if (JSON.stringify(arr) !== JSON.stringify(converted)) {
        await prisma.project.update({
          where: { id: p.id },
          data: { techStack: JSON.stringify(converted) },
        });
        console.log(`  项目 ${p.id}: ${JSON.stringify(arr)} -> ${JSON.stringify(converted)}`);
        projectUpdated++;
      }
    } catch (e) {
      console.warn(`  项目 ${p.id} 解析失败:`, e.message);
    }
  }
  console.log(`项目迁移完成，更新了 ${projectUpdated} 条`);

  // 迁移 Workflow.techStack
  const workflows = await prisma.workflow.findMany({
    where: { techStack: { not: null } },
    select: { id: true, name: true, techStack: true },
  });
  console.log(`\n找到 ${workflows.length} 个有技术栈的编排`);
  let workflowUpdated = 0;
  for (const w of workflows) {
    try {
      const arr = JSON.parse(w.techStack);
      const converted = arr.map(n => nameToId[n] || n);
      if (JSON.stringify(arr) !== JSON.stringify(converted)) {
        await prisma.workflow.update({
          where: { id: w.id },
          data: { techStack: JSON.stringify(converted) },
        });
        console.log(`  编排 "${w.name}": ${JSON.stringify(arr)} -> ${JSON.stringify(converted)}`);
        workflowUpdated++;
      }
    } catch (e) {
      console.warn(`  编排 ${w.id} 解析失败:`, e.message);
    }
  }
  console.log(`编排迁移完成，更新了 ${workflowUpdated} 条`);

  console.log('\n全部完成');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
