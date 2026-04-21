const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 获取所有配置
  const configs = await prisma.opencodeConfig.findMany({
    orderBy: { createdAt: 'asc' },
  });
  
  console.log('Found', configs.length, 'configs');
  
  // 找到有 progressQuestion 的配置
  const configWithProgress = configs.find(c => c.progressQuestion && c.progressQuestion.trim());
  const configToKeep = configWithProgress || configs[0];
  
  console.log('Keeping config:', configToKeep.id);
  console.log('  name:', configToKeep.name);
  console.log('  progressQuestion:', configToKeep.progressQuestion ? 'has value' : 'empty');
  
  // 删除其他配置
  for (const config of configs) {
    if (config.id !== configToKeep.id) {
      console.log('Deleting config:', config.id, config.name);
      await prisma.opencodeConfig.delete({
        where: { id: config.id },
      });
    }
  }
  
  // 确保保留的配置是激活的
  await prisma.opencodeConfig.update({
    where: { id: configToKeep.id },
    data: { isActive: true },
  });
  
  console.log('');
  console.log('Done! Now there is only 1 global config.');
  
  // 验证
  const remaining = await prisma.opencodeConfig.findMany();
  console.log('Remaining configs:', remaining.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
