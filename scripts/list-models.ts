import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function listModels() {
  const models = await prisma.modelConfig.findMany({
    select: {
      id: true,
      name: true,
      providerType: true,
      models: true,
      apiBaseUrl: true,
      isActive: true,
      isDefault: true,
    }
  });
  console.log('=== 数据库中的模型配置 ===');
  console.log(JSON.stringify(models, null, 2));
  await prisma.$disconnect();
}
listModels();