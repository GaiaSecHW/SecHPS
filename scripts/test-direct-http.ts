// scripts/test-direct-http.ts
// 直接 HTTP 请求测试，不使用 Claude SDK

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testDirectHttp() {
  console.log('=== 直接 HTTP 请求测试（不使用SDK） ===');
  
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
  
  // 构建请求 - Claude API 格式
  const url = `${baseUrl}/v1/messages`;
  
  const body = {
    model: model,
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: '请计算 1+1，只返回结果数字'
      }
    ]
  };
  
  console.log('\n请求 URL:', url);
  console.log('请求 Body:', JSON.stringify(body, null, 2));
  console.log('\n发送请求...');
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,  // Claude SDK 使用的 header
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    
    console.log('\n响应状态:', response.status);
    console.log('响应 Headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));
    
    const text = await response.text();
    console.log('\n响应内容:', text);
    
    if (response.ok) {
      console.log('\n✅ 直接 HTTP 请求成功！');
    } else {
      console.log('\n❌ 直接 HTTP 请求失败');
    }
    
  } catch (error) {
    console.error('\n❌ 请求异常:', error);
  }
  
  // 测试另一种认证方式 - Authorization Bearer
  console.log('\n\n=== 测试 Authorization Bearer header ===');
  
  try {
    const response2 = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,  // OpenAI 风格
      },
      body: JSON.stringify(body),
    });
    
    console.log('响应状态:', response2.status);
    const text2 = await response2.text();
    console.log('响应内容:', text2);
    
  } catch (error) {
    console.error('请求异常:', error);
  }
  
  await prisma.$disconnect();
}

testDirectHttp();