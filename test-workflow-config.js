// 测试工作流配置读取

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testWorkflowConfig() {
  try {
    // 模拟用户 ID（需要替换为实际的用户 ID）
    const testUserId = 'test-user-id';
    
    // 测试 1: 查找用户的活跃配置
    console.log('\n=== 测试 1: 查找用户活跃配置 ===');
    const userConfig = await prisma.opencodeConfig.findFirst({
      where: {
        userId: testUserId,
        isActive: true,
      },
    });
    
    if (userConfig) {
      console.log('✅ 找到用户配置:', userConfig.id);
      console.log('配置名称:', userConfig.name);
      
      if (userConfig.workflowConfig) {
        console.log('\n工作流配置原始值:');
        console.log(userConfig.workflowConfig);
        
        try {
          const parsed = JSON.parse(userConfig.workflowConfig);
          console.log('\n解析后的工作流配置:');
          console.log('startNodeLabel:', parsed.startNodeLabel);
          console.log('startNodeDescription:', parsed.startNodeDescription);
          console.log('endNodeLabel:', parsed.endNodeLabel);
          console.log('endNodeDescription:', parsed.endNodeDescription);
        } catch (e) {
          console.error('❌ 解析工作流配置失败:', e);
        }
      } else {
        console.log('⚠️  该配置没有设置工作流配置');
      }
    } else {
      console.log('❌ 未找到用户活跃配置');
    }
    
    // 测试 2: 查看所有配置
    console.log('\n=== 测试 2: 查看所有配置 ===');
    const allConfigs = await prisma.opencodeConfig.findMany({
      select: {
        id: true,
        name: true,
        userId: true,
        isActive: true,
        workflowConfig: true,
      },
      take: 5,
    });
    
    console.log(`找到 ${allConfigs.length} 个配置:`);
    allConfigs.forEach((config, index) => {
      console.log(`\n${index + 1}. ${config.name} (${config.id})`);
      console.log(`   用户: ${config.userId}`);
      console.log(`   活跃: ${config.isActive}`);
      if (config.workflowConfig) {
        try {
          const parsed = JSON.parse(config.workflowConfig);
          console.log(`   开始节点: ${parsed.startNodeLabel || '(未设置)'}`);
          console.log(`   结束节点: ${parsed.endNodeLabel || '(未设置)'}`);
        } catch {
          console.log('   工作流配置: (解析失败)');
        }
      } else {
        console.log('   工作流配置: (未设置)');
      }
    });
    
  } catch (error) {
    console.error('测试失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testWorkflowConfig();
