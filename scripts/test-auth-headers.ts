// scripts/test-auth-headers.ts
// 测试两种认证方式的 header 差异

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testAuthHeaders() {
  console.log('=== 认证 Header 对比测试 ===');
  
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
  
  console.log('\nAPI Key:', apiKey);
  console.log('Base URL:', baseUrl);
  
  // 测试1: Claude SDK 使用的 header (x-api-key)
  console.log('\n=== Claude SDK 认证方式 (x-api-key) ===');
  const url1 = `${baseUrl}/v1/messages`;
  
  const body = {
    model: model,
    max_tokens: 100,
    messages: [{ role: 'user', content: '计算 1+1' }]
  };
  
  console.log('URL:', url1);
  console.log('Headers:');
  console.log('  Content-Type: application/json');
  console.log('  x-api-key:', apiKey);
  console.log('  anthropic-version: 2023-06-01');
  
  try {
    const resp1 = await fetch(url1, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    console.log('响应状态:', resp1.status);
    const text1 = await resp1.text();
    console.log('响应:', text1.substring(0, 500));
  } catch (e) {
    console.error('异常:', e);
  }
  
  // 测试2: OpenAI/Bearer 认证方式
  console.log('\n=== OpenAI Bearer 认证方式 (Authorization: Bearer) ===');
  
  console.log('URL:', url1);
  console.log('Headers:');
  console.log('  Content-Type: application/json');
  console.log('  Authorization: Bearer', apiKey);
  
  try {
    const resp2 = await fetch(url1, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    console.log('响应状态:', resp2.status);
    const text2 = await resp2.text();
    console.log('响应:', text2.substring(0, 500));
  } catch (e) {
    console.error('异常:', e);
  }
  
  // 测试3: 同时发送两种 header
  console.log('\n=== 同时发送两种认证 Header ===');
  
  console.log('Headers:');
  console.log('  x-api-key:', apiKey);
  console.log('  Authorization: Bearer', apiKey);
  
  try {
    const resp3 = await fetch(url1, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    console.log('响应状态:', resp3.status);
    const text3 = await resp3.text();
    console.log('响应:', text3.substring(0, 500));
  } catch (e) {
    console.error('异常:', e);
  }
  
  await prisma.$disconnect();
}

testAuthHeaders();