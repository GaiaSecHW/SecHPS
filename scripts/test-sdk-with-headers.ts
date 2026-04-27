// scripts/test-sdk-with-headers.ts
// 测试底层 Anthropic SDK 支持自定义 headers

import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testSdkWithHeaders() {
  console.log('=== 测试底层 Anthropic SDK（支持自定义 headers）===');
  
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
  
  // 测试1: 使用 x-api-key (Claude标准方式)
  console.log('\n=== 测试1: Claude SDK 标准方式 (x-api-key) ===');
  
  try {
    const client1 = new Anthropic({
      apiKey,
      baseURL: baseUrl,
    });
    
    const msg1 = await client1.messages.create({
      model,
      max_tokens: 50,
      messages: [{ role: 'user', content: '计算 1+1' }],
    });
    
    console.log('✅ 成功！');
    console.log('响应:', JSON.stringify(msg1, null, 2).substring(0, 500));
  } catch (e) {
    console.log('❌ 失败:', e);
  }
  
  // 测试2: 使用 defaultHeaders 同时传递两种认证
  console.log('\n=== 测试2: 同时传递两种认证 header ===');
  
  try {
    const client2 = new Anthropic({
      apiKey,
      baseURL: baseUrl,
      defaultHeaders: {
        'Authorization': `Bearer ${apiKey}`,  // 添加 Bearer 认证
      },
    });
    
    const msg2 = await client2.messages.create({
      model,
      max_tokens: 50,
      messages: [{ role: 'user', content: '计算 1+1' }],
    });
    
    console.log('✅ 成功！');
    console.log('响应:', JSON.stringify(msg2, null, 2).substring(0, 500));
  } catch (e) {
    console.log('❌ 失败:', e);
  }
  
  // 测试3: 只用 Bearer，不用 x-api-key
  console.log('\n=== 测试3: 只使用 Authorization Bearer ===');
  
  try {
    // 不传 apiKey，只通过 headers 传递
    const client3 = new Anthropic({
      baseURL: baseUrl,
      defaultHeaders: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    const msg3 = await client3.messages.create({
      model,
      max_tokens: 50,
      messages: [{ role: 'user', content: '计算 1+1' }],
    });
    
    console.log('✅ 成功！');
    console.log('响应:', JSON.stringify(msg3, null, 2).substring(0, 500));
  } catch (e) {
    console.log('❌ 失败:', e);
  }
  
  await prisma.$disconnect();
}

testSdkWithHeaders();