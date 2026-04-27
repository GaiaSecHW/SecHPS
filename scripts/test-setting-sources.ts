// scripts/test-setting-sources.ts
// 测试不同的 settingSources 配置

import { query } from '@anthropic-ai/claude-agent-sdk';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testSettingSources() {
  console.log('=== settingSources 配置测试 ===');
  
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
  
  // 测试不同的 settingSources
  const configs = [
    { name: '空数组 []', value: [] },
    { name: '只 project', value: ['project'] },
    { name: '只 user', value: ['user'] },
    { name: 'project + user', value: ['project', 'user'] },
  ];
  
  for (const config of configs) {
    console.log(`\n=== 测试: settingSources = ${config.name} ===`);
    
    try {
      const q = query({
        prompt: '计算 1+1等于几？只返回数字',
        options: {
          model,
          env: {
            ANTHROPIC_API_KEY: apiKey,
            ANTHROPIC_BASE_URL: baseUrl,
          },
          maxTokens: 30,
          allowedTools: [],
          settingSources: config.value,
        },
      });
      
      let success = false;
      let attempts = 0;
      
      for await (const msg of q) {
        const type = (msg as any).type;
        const subtype = (msg as any).subtype;
        
        if (subtype === 'init') {
          console.log('初始化消息:');
          console.log('  apiKeySource:', (msg as any).apiKeySource);
        }
        
        if (subtype === 'api_retry') {
          attempts++;
          console.log(`[RETRY #${(msg as any).attempt}] status=${(msg as any).error_status}`);
          if (attempts >= 2) {
            console.log('失败');
            break;
          }
        }
        
        if (type === 'assistant' || (type === 'result' && !subtype?.includes?.('error'))) {
          console.log('✅ 成功!');
          success = true;
          break;
        }
      }
      
      if (success) {
        console.log(`\n结论: settingSources = ${config.name} 有效`);
      } else {
        console.log(`\n结论: settingSources = ${config.name} 无效 (401错误)`);
      }
      
    } catch (e) {
      console.error('异常:', e);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  await prisma.$disconnect();
}

testSettingSources();