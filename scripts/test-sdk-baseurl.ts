// scripts/test-sdk-baseurl.ts
// 测试 SDK baseUrl 格式

import { query } from '@anthropic-ai/claude-agent-sdk';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testBaseUrl() {
  console.log('=== SDK baseUrl 格式测试 ===');
  
  const modelConfig = await prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });
  
  if (!modelConfig) {
    console.error('没有找到模型配置');
    await prisma.$disconnect();
    return;
  }
  
  const apiKey = modelConfig.apiKey || '';
  const baseUrlRaw = modelConfig.apiBaseUrl || '';
  const models = JSON.parse(modelConfig.models || '[]');
  const model = models[0] || 'zai-org/GLM-5';
  
  // 测试不同的 baseUrl 格式
  const baseUrlVariants = [
    baseUrlRaw,                    // http://172.31.29.10
    `${baseUrlRaw}/v1`,            // http://172.31.29.10/v1
    `${baseUrlRaw}/v1/messages`,   // http://172.31.29.10/v1/messages
  ];
  
  console.log('\n原始 baseUrl:', baseUrlRaw);
  console.log('API Key:', apiKey);
  console.log('Model:', model);
  
  for (const baseUrl of baseUrlVariants) {
    console.log(`\n=== 测试 baseUrl: ${baseUrl} ===`);
    
    const env = {
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_BASE_URL: baseUrl,
    };
    
    console.log('传递给 SDK 的 env:', JSON.stringify(env));
    
    try {
      const q = query({
        prompt: '计算 1+1',
        options: {
          model,
          env,
          maxTokens: 50,
          allowedTools: [],  // 不使用工具
        },
      });
      
      let gotResult = false;
      let gotError = false;
      
      for await (const msg of q) {
        const subtype = (msg as any).subtype;
        const type = (msg as any).type;
        
        if (subtype === 'api_retry') {
          console.log(`API重试: attempt=${(msg as any).attempt}, error_status=${(msg as any).error_status}`);
          if ((msg as any).attempt >= 3) {
            console.log('❌ 多次重试失败，跳过此 baseUrl');
            gotError = true;
            break;
          }
        }
        
        if (subtype === 'error' || (type === 'result' && (msg as any).subtype?.startsWith?.('error'))) {
          console.log('❌ 错误:', JSON.stringify(msg, null, 2));
          gotError = true;
          break;
        }
        
        if (type === 'assistant' || type === 'result') {
          console.log('✅ 成功！收到响应');
          console.log('响应:', JSON.stringify(msg, null, 2));
          gotResult = true;
          break;
        }
      }
      
      if (gotResult) {
        console.log(`\n✅✅ baseUrl "${baseUrl}" 有效！`);
        await prisma.$disconnect();
        return;
      }
      
      if (!gotError) {
        console.log('超时或无响应');
      }
      
    } catch (e) {
      console.error('异常:', e);
    }
  }
  
  console.log('\n所有 baseUrl 格式都失败了');
  await prisma.$disconnect();
}

testBaseUrl();