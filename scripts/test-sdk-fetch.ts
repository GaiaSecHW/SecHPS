// scripts/test-sdk-fetch.ts
// 通过自定义 fetch 添加双认证 header

import { query } from '@anthropic-ai/claude-agent-sdk';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testCustomFetch() {
  console.log('=== SDK 自定义 fetch 双认证测试 ===');
  
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
  
  // 创建自定义 fetch，添加两种认证 header
  const customFetch = async (url: string, init?: RequestInit) => {
    console.log('\n[customFetch] URL:', url);
    console.log('[customFetch] 原始 headers:', init?.headers);
    
    // 合并 headers，添加两种认证
    const newHeaders = new Headers(init?.headers || {});
    newHeaders.set('x-api-key', apiKey);          // Claude 方式
    newHeaders.set('Authorization', `Bearer ${apiKey}`); // OpenAI 方式
    
    console.log('[customFetch] 新 headers:');
    console.log('  x-api-key:', apiKey.substring(0, 15) + '...');
    console.log('  Authorization:', `Bearer ${apiKey.substring(0, 15)}...`);
    
    const newInit = {
      ...init,
      headers: newHeaders,
    };
    
    // 使用原生 fetch
    return globalThis.fetch(url, newInit);
  };
  
  console.log('\n=== 通过 env + 自定义 fetch 传递双认证 ===');
  
  try {
    const q = query({
      prompt: '计算 1+1，只返回数字',
      options: {
        model,
        env: {
          ANTHROPIC_API_KEY: apiKey,
          ANTHROPIC_BASE_URL: baseUrl,
        },
        maxTokens: 50,
        allowedTools: [],
        // 注意：SDK Options 可能不支持直接传 fetch，需要确认
      },
    });
    
    let success = false;
    for await (const msg of q) {
      const type = (msg as any).type;
      const subtype = (msg as any).subtype;
      
      if (subtype === 'api_retry') {
        console.log(`重试 #${(msg as any).attempt}: status=${(msg as any).error_status}`);
        if ((msg as any).attempt >= 3) {
          console.log('多次重试失败');
          break;
        }
      }
      
      if (type === 'assistant' || (type === 'result' && !subtype?.includes?.('error'))) {
        console.log('\n✅ 成功！');
        success = true;
        break;
      }
    }
    
  } catch (e) {
    console.error('异常:', e);
  }
  
  await prisma.$disconnect();
}

testCustomFetch();