// scripts/test-sdk-debug.ts
// 测试 SDK 的调试模式，查看实际发送的请求

import { query, Options } from '@anthropic-ai/claude-agent-sdk';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testSdkDebug() {
  console.log('=== SDK 调试模式测试 ===');
  
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
  
  // 使用 debug 模式运行 SDK
  console.log('\n=== 启用 SDK debug 模式 ===');
  
  const options: Options = {
    model,
    env: {
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_BASE_URL: baseUrl,
    },
    maxTokens: 50,
    allowedTools: [],  // 不使用工具，纯文本
    debug: true,  // 启用调试模式
    stderr: (data) => {
      // 捕获 SDK 的 stderr 输出（调试日志）
      console.log('[SDK stderr]', data);
    },
  };
  
  console.log('传递给 query 的 options:', JSON.stringify({
    model: options.model,
    maxTokens: options.maxTokens,
    allowedTools: options.allowedTools,
    debug: options.debug,
    env: {
      ANTHROPIC_API_KEY: apiKey.substring(0, 10) + '...',
      ANTHROPIC_BASE_URL: baseUrl,
    },
  }, null, 2));
  
  try {
    const q = query({
      prompt: '计算 1+1',
      options,
    });
    
    let gotResult = false;
    
    for await (const msg of q) {
      const subtype = (msg as any).subtype;
      const type = (msg as any).type;
      
      console.log(`[消息] type=${type}, subtype=${subtype || 'none'}`);
      
      if (subtype === 'init') {
        console.log('初始化消息:', JSON.stringify(msg, null, 2).substring(0, 1000));
      }
      
      if (subtype === 'api_retry') {
        console.log('API重试:', JSON.stringify(msg, null, 2));
      }
      
      if (subtype === 'error' || (type === 'result' && subtype?.startsWith?.('error'))) {
        console.log('错误:', JSON.stringify(msg, null, 2));
        break;
      }
      
      if (type === 'assistant') {
        console.log('收到助手消息:', JSON.stringify(msg, null, 2).substring(0, 500));
        gotResult = true;
      }
      
      if (type === 'result' && !subtype?.startsWith?.('error')) {
        console.log('结果:', JSON.stringify(msg, null, 2).substring(0, 500));
        gotResult = true;
        break;
      }
    }
    
    if (gotResult) {
      console.log('\n✅ SDK 测试成功！');
    } else {
      console.log('\n❌ SDK 测试失败');
    }
    
  } catch (e) {
    console.error('异常:', e);
  }
  
  await prisma.$disconnect();
}

testSdkDebug();