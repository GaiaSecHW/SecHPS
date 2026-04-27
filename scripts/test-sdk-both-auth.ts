// scripts/test-sdk-both-auth.ts
// 测试 SDK 同时传递两种认证方式

import { query } from '@anthropic-ai/claude-agent-sdk';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testBothAuth() {
  console.log('=== SDK 双认证测试 ===');
  
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
  
  // 方案1: 使用 env 传递两种认证
  console.log('\n=== 方案1: 通过 env 传递双认证 ===');
  
  const env1 = {
    ANTHROPIC_API_KEY: apiKey,           // SDK 使用 x-api-key header
    ANTHROPIC_AUTH_TOKEN: apiKey,        // SDK 使用 Authorization: Bearer header
    ANTHROPIC_BASE_URL: baseUrl,
  };
  
  console.log('传递的环境变量:');
  console.log('  ANTHROPIC_API_KEY:', apiKey.substring(0, 15) + '...');
  console.log('  ANTHROPIC_AUTH_TOKEN:', apiKey.substring(0, 15) + '...');
  console.log('  ANTHROPIC_BASE_URL:', baseUrl);
  
  try {
    const q1 = query({
      prompt: '计算 1+1，只返回数字',
      options: {
        model,
        env: env1,
        maxTokens: 50,
        allowedTools: [],
      },
    });
    
    let success = false;
    for await (const msg of q1) {
      const type = (msg as any).type;
      const subtype = (msg as any).subtype;
      
      if (subtype === 'api_retry') {
        console.log(`重试 #${(msg as any).attempt}: error_status=${(msg as any).error_status}`);
        if ((msg as any).attempt >= 3) {
          console.log('多次重试失败，终止');
          break;
        }
      }
      
      if (type === 'assistant' || (type === 'result' && !subtype?.includes?.('error'))) {
        console.log('\n✅ 方案1 成功！');
        console.log('响应:', JSON.stringify(msg, null, 2).substring(0, 500));
        success = true;
        break;
      }
      
      if (subtype?.includes?.('error')) {
        console.log('\n❌ 方案1 失败:', JSON.stringify(msg, null, 2));
        break;
      }
    }
    
    if (!success) {
      console.log('方案1 未成功');
    }
    
  } catch (e) {
    console.error('方案1 异常:', e);
  }
  
  await prisma.$disconnect();
}

testBothAuth();