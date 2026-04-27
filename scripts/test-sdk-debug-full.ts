// scripts/test-sdk-debug-full.ts
// 完整调试模式查看 SDK 内部请求

import { query } from '@anthropic-ai/claude-agent-sdk';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testDebugFull() {
  console.log('=== SDK 完整调试模式 ===');
  
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
  console.log('- API Key:', apiKey);
  console.log('- Base URL:', baseUrl);
  console.log('- Model:', model);
  
  // 收集所有 stderr 输出
  const stderrLogs: string[] = [];
  
  try {
    const q = query({
      prompt: '1+1=?',
      options: {
        model,
        env: {
          ANTHROPIC_API_KEY: apiKey,
          ANTHROPIC_BASE_URL: baseUrl,
        },
        maxTokens: 20,
        allowedTools: [],
        debug: true,  // 启用调试
        settingSources: [],
        stderr: (data: string) => {
          stderrLogs.push(data);
          console.log('[STDERR]', data);
        },
      },
    });
    
    for await (const msg of q) {
      const type = (msg as any).type;
      const subtype = (msg as any).subtype;
      
      // 只打印关键消息
      if (subtype === 'init') {
        console.log('\n[INIT] apiKeySource:', (msg as any).apiKeySource);
      }
      
      if (subtype === 'api_retry') {
        console.log(`\n[RETRY #${(msg as any).attempt}] status=${(msg as any).error_status}`);
        console.log('error:', (msg as any).error);
        
        // 打印更多错误详情
        if ((msg as any).error_details) {
          console.log('error_details:', JSON.stringify((msg as any).error_details, null, 2));
        }
        
        if ((msg as any).attempt >= 2) {
          console.log('\n=== 收集的 STDERR 日志 ===');
          for (const log of stderrLogs) {
            console.log(log);
          }
          break;
        }
      }
      
      if (type === 'assistant') {
        console.log('\n✅ 成功!');
        break;
      }
    }
    
  } catch (e) {
    console.error('异常:', e);
  }
  
  await prisma.$disconnect();
}

testDebugFull();