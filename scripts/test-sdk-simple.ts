// scripts/test-sdk-simple.ts
// 测试 Claude SDK 是否能正常连接

import { createClaudeAgentService } from '../src/services/ai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testSdk() {
  console.log('=== Claude SDK 简单测试 ===');
  console.log('任务: 计算 1+1');
  
  // 从数据库获取模型配置（使用默认模型）
  const modelConfig = await prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });
  
  // 如果没有默认模型，使用第一个活跃模型
  if (!modelConfig) {
    modelConfig = await prisma.modelConfig.findFirst({
      where: { isActive: true },
    });
  }
  
  if (!modelConfig) {
    console.error('\n❌ 错误: 数据库中没有活跃的模型配置');
    await prisma.$disconnect();
    return;
  }
  
  const apiKey = modelConfig.apiKey || '';
  const baseUrl = modelConfig.apiBaseUrl || '';
  const models = JSON.parse(modelConfig.models || '[]');
  const model = models[0] || 'claude-sonnet-4-20250514';
  
  console.log('\n配置信息:');
  console.log('- Provider:', modelConfig.providerType);
  console.log('- API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : '未设置');
  console.log('- Base URL:', baseUrl || '未设置（使用官方API）');
  console.log('- Model:', model);
  
  if (!apiKey) {
    console.error('\n❌ 错误: API Key 未配置');
    await prisma.$disconnect();
    return;
  }
  
  try {
    console.log('\n开始创建 ClaudeAgentService...');
    
    const service = createClaudeAgentService({
      apiKey,
      baseUrl: baseUrl || undefined,
      model,
      cwd: process.cwd(),
      allowedTools: [],  // 不使用任何工具，纯文本测试
    });
    
    console.log('ClaudeAgentService 创建成功');
    console.log('\n发送请求: "请计算 1+1，只返回结果数字"');
    
    const result = await service.sendPrompt('请计算 1+1，只返回结果数字', {
      onChunk: (text) => {
        console.log('[原始chunk]', text);
      },
      onComplete: (text) => {
        console.log('[原始complete]', text);
      },
      onError: (error) => {
        console.log('[原始error]', error.message);
        console.log('[原始error stack]', error.stack);
      },
      onMessage: (msg) => {
        // 打印原始消息内容，不加工
        console.log('[原始消息]', JSON.stringify(msg, null, 2));
      },
    });
    
    console.log('\n=== 测试成功 ===');
    console.log('最终结果:', result);
    
    await prisma.$disconnect();
    
  } catch (error) {
    console.error('\n❌ 测试失败:');
    console.error(error);
    await prisma.$disconnect();
  }
}

testSdk().catch(console.error);