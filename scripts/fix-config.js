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
  
  if (configWithProgress) {
    console.log('Config with progressQuestion:', configWithProgress.id);
    
    // 先把所有配置设为非激活
    await prisma.opencodeConfig.updateMany({
      data: { isActive: false },
    });
    
    // 再把有 progressQuestion 的配置设为激活
    await prisma.opencodeConfig.update({
      where: { id: configWithProgress.id },
      data: { isActive: true },
    });
    
    console.log('Done! Active config:', configWithProgress.id);
    console.log('progressQuestion:', configWithProgress.progressQuestion?.substring(0, 50) + '...');
  } else {
    console.log('No config with progressQuestion found');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
