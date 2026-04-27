// scripts/test-sdk-success.ts
// 验证成功的配置

import { query } from '@anthropic-ai/claude-agent-sdk';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testSuccess() {
  console.log('=== SDK 成功配置验证 ===');
  
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
  
  console.log('\n配置:');
  console.log('- API Key:', apiKey.substring(0, 15) + '...');
  console.log('- Base URL:', baseUrl);
  console.log('- Model:', model);
  
  console.log('\n关键配置:');
  console.log('- settingSources: [] (不加载本地配置)');
  console.log('- allowedTools: [] (不使用工具)');
  
  // 测试多次确认稳定性
  for (let i = 1; i <= 3; i++) {
    console.log(`\n=== 测试 #${i} ===`);
    
    try {
      const q = query({
        prompt: '计算 1+1等于多少？只返回数字',
        options: {
          model,
          env: {
            ANTHROPIC_API_KEY: apiKey,
            ANTHROPIC_BASE_URL: baseUrl,
          },
          maxTokens: 50,
          allowedTools: [],        // 关键：不使用工具
          settingSources: [],       // 关键：不加载本地配置
        },
      });
      
      let result = '';
      for await (const msg of q) {
        const type = (msg as any).type;
        const subtype = (msg as any).subtype;
        
        if (subtype === 'api_retry') {
          console.log(`[RETRY] attempt=${(msg as any).attempt}, status=${(msg as any).error_status}`);
          if ((msg as any).attempt >= 2) {
            console.log('失败，终止');
            break;
          }
        }
        
        if (type === 'assistant') {
          // 提取文本内容
          const content = (msg as any).content;
          if (Array.isArray(content)) {
            for (const block of content) {
            if (block.type === 'text') {
              result += block.text || '';
            }
          }
          }
        }
        
        if (type === 'result') {
          console.log(`结果: ${result || '(无文本)'}`);
          if (!subtype?.includes?.('error')) {
            console.log(`✅ 测试 #${i} 成功!`);
          } else {
            console.log(`❌ 测试 #${i} 失败`);
          }
          break;
        }
      }
      
    } catch (e) {
      console.error(`测试 #${i} 异常:`, e);
    }
    
    // 等待一下避免太快
    await new Promise(r => setTimeout(r, 1000));
  }
  
  await prisma.$disconnect();
  console.log('\n=== 测试完成 ===');
}

testSuccess();