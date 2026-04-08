// 检查模型配置

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkModelConfig() {
  try {
    console.log('\n=== 检查模型配置 ===\n');
    
    // 查询所有模型配置
    const models = await prisma.modelConfig.findMany({
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    });
    
    console.log(`找到 ${models.length} 个模型配置:\n`);
    
    models.forEach((model, index) => {
      console.log(`${index + 1}. ${model.name} (${model.id})`);
      console.log(`   Provider Type: ${model.providerType}`);
      console.log(`   API Base URL: ${model.apiBaseUrl}`);
      console.log(`   Models: ${model.models}`);
      console.log(`   Active: ${model.isActive}`);
      console.log(`   Default: ${model.isDefault}`);
      console.log(`   Route Type: ${model.routeType || '(未设置)'}`);
      console.log(`   API Key: ${model.apiKey ? '******' + model.apiKey.slice(-4) : '(未设置)'}`);
      console.log('');
    });
    
    // 检查默认配置
    const defaultModel = models.find(m => m.isDefault);
    if (defaultModel) {
      console.log('=== 默认模型 ===');
      console.log(`名称: ${defaultModel.name}`);
      console.log(`类型: ${defaultModel.providerType}`);
      console.log(`模型: ${defaultModel.models}`);
      console.log(`URL: ${defaultModel.apiBaseUrl}`);
    } else {
      console.log('⚠️  未设置默认模型');
    }
    
  } catch (error) {
    console.error('检查失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkModelConfig();
