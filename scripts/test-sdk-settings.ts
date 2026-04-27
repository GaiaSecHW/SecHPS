// scripts/test-sdk-settings.ts
// 通过 settings 传递自定义配置

import { query } from '@anthropic-ai/claude-agent-sdk';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testWithSettings() {
  console.log('=== SDK settings 配置测试 ===');
  
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
  
  // 测试: 使用 extraArgs 传递额外参数
  console.log('\n=== 方案: extraArgs 传递额外CLI参数 ===');
  
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
        // 尝试使用 extraArgs 传递额外参数
        extraArgs: {
          // 这些参数会传递给 CLI
          'model': model,
        },
        // 尝试使用 settings
        settings: {
          model: model,
        },
        // 设置源为空，避免加载本地配置
        settingSources: [],
      },
    });
    
    let success = false;
    for await (const msg of q) {
      const type = (msg as any).type;
      const subtype = (msg as any).subtype;
      
      console.log(`[消息] type=${type}, subtype=${subtype || 'none'}`);
      
      if (subtype === 'init') {
        console.log('初始化消息:');
        console.log('  apiKeySource:', (msg as any).apiKeySource);
        console.log('  model:', (msg as any).model);
      }
      
      if (subtype === 'api_retry') {
        console.log(`重试 #${(msg as any).attempt}: status=${(msg as any).error_status}, error=${(msg as any).error}`);
        if ((msg as any).attempt >= 3) {
          console.log('多次重试失败');
          break;
        }
      }
      
      if (type === 'assistant' || (type === 'result' && !subtype?.includes?.('error'))) {
        console.log('\n✅ 成功！');
        console.log('响应:', JSON.stringify(msg, null, 2).substring(0, 500));
        success = true;
        break;
      }
      
      if (subtype?.includes?.('error')) {
        console.log('\n❌ 错误:', JSON.stringify(msg, null, 2));
        break;
      }
    }
    
    if (!success) {
      console.log('\n测试失败');
    }
    
  } catch (e) {
    console.error('异常:', e);
  }
  
  await prisma.$disconnect();
}

testWithSettings();