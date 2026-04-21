const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const configs = await prisma.modelConfig.findMany({
    select: {
      id: true,
      name: true,
      providerType: true,
      apiBaseUrl: true,
      apiKey: true,
      models: true,
      isActive: true,
      isDefault: true,
    }
  });
  
  console.log('========== ModelConfig 表 ==========');
  console.log('总记录数:', configs.length);
  
  for (const c of configs) {
    console.log('\n-----------------------------------');
    console.log('ID:', c.id);
    console.log('Name:', c.name);
    console.log('Provider:', c.providerType);
    console.log('API URL:', c.apiBaseUrl);
    console.log('API Key (前8位):', c.apiKey?.substring(0, 8) + '...');
    console.log('Models:', Array.isArray(c.models) ? c.models.join(', ') : c.models);
    console.log('isActive:', c.isActive);
    console.log('isDefault:', c.isDefault);
  }
  
  // 检查默认模型
  const defaultModel = configs.find(c => c.isDefault && c.isActive);
  if (defaultModel) {
    console.log('\n========== 当前默认模型 ==========');
    console.log('Name:', defaultModel.name);
    console.log('URL:', defaultModel.apiBaseUrl);
    console.log('\n⚠️  警告: URL 是内网地址，可能无法访问！');
    console.log('建议修改为公网可访问的地址');
  } else {
    console.log('\n⚠️  没有设置默认模型 (isDefault=true 且 isActive=true)');
  }
  
  await prisma.$disconnect();
}

check().catch(console.error);
