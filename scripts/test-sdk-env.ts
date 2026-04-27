// scripts/test-sdk-env.ts
// 测试 SDK 的认证传递方式

import { query } from '@anthropic-ai/claude-agent-sdk';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testSdkEnv() {
  console.log('=== SDK 认证方式测试 ===');
  
  const modelConfig = await prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });
  
  if (!modelConfig) {
    console.error('没有找到模型配置');
    await prisma.$disconnect();
    return;
  }
  
  const apiKey = modelConfig.apiKey || '';
  const baseUrl = modelConfig.apiBaseUrl || '';
  const models = JSON.parse(modelConfig.models || '[]');
  const model = models[0] || 'zai-org/GLM-5';
  
  console.log('\n配置信息:');
  console.log('- API Key:', apiKey);
  console.log('- Base URL:', baseUrl);
  console.log('- Model:', model);
  
  // 测试1: 通过 env 对象传递
  console.log('\n=== 测试1: 通过 env 对象传递认证 ===');
  
  const env1 = {
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_BASE_URL: baseUrl,
  };
  
  console.log('传递给 SDK 的 env:', JSON.stringify(env1));
  
  try {
    const q = query({
      prompt: '计算 1+1',
      options: {
        model,
        env: env1,
        maxTokens: 100,
      },
    });
    
    for await (const msg of q) {
      console.log('消息:', JSON.stringify(msg, null, 2));
      if ((msg as any).subtype === 'error') {
        console.log('❌ 错误消息');
        break;
      }
      if ((msg as any).type === 'result') {
        console.log('✅ 成功！');
        break;
      }
    }
  } catch (e) {
    console.error('异常:', e);
  }
  
  await prisma.$disconnect();
}

testSdkEnv();