// scripts/test-proxy-debug.ts
// 测试代理接收到的 header

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testProxyDebug() {
  console.log('=== 代理接收 Header 测试 ===');
  
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
  
  // 发送请求，让代理返回它收到的header信息（如果支持）
  // 或者使用一个调试endpoint
  
  console.log('\n测试不同的认证方式：');
  console.log('Base URL:', baseUrl);
  console.log('API Key:', apiKey);
  
  const body = {
    model: 'zai-org/GLM-5',
    max_tokens: 50,
    messages: [{ role: 'user', content: '计算 1+1' }]
  };
  
  // 测试1: x-api-key (SDK标准)
  console.log('\n1. x-api-key header:');
  try {
    const r1 = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    console.log(`状态: ${r1.status}`);
    console.log('响应头:', JSON.stringify(Object.fromEntries(r1.headers), null, 2));
    const t1 = await r1.text();
    console.log('响应:', t1.substring(0, 300));
  } catch (e) {
    console.error('异常:', e);
  }
  
  // 测试2: Authorization Bearer
  console.log('\n2. Authorization Bearer header:');
  try {
    const r2 = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    console.log(`状态: ${r2.status}`);
    const t2 = await r2.text();
    console.log('响应:', t2.substring(0, 300));
  } catch (e) {
    console.error('异常:', e);
  }
  
  // 测试3: 两种都传
  console.log('\n3. 同时传递两种 header:');
  try {
    const r3 = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    console.log(`状态: ${r3.status}`);
    const t3 = await r3.text();
    console.log('响应:', t3.substring(0, 300));
  } catch (e) {
    console.error('异常:', e);
  }
  
  await prisma.$disconnect();
}

testProxyDebug();