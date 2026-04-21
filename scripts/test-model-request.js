/**
 * 测试模型连接 - 对比不同请求格式
 * 
 * 用法: node scripts/test-model-request.js
 */

const API_URL = 'http://172.31.29.10/v1/messages';
const API_KEY = 'sk-kRfP4...'; // 替换为完整 key
const MODEL = 'zai-org/GLM-5';

async function testSimpleRequest() {
  console.log('\n========== 测试 1: 简单请求 (无 system) ==========');
  
  const body = {
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: '1+1' }],
  };
  
  console.log('Request body size:', JSON.stringify(body).length, 'bytes');
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    
    console.log('Response status:', response.status);
    if (response.ok) {
      const data = await response.json();
      console.log('Response OK:', JSON.stringify(data).substring(0, 200));
    } else {
      const text = await response.text();
      console.log('Response error:', text);
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}

async function testWithSystem() {
  console.log('\n========== 测试 2: 带 system 字段 ==========');
  
  const body = {
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: '1+1' }],
    system: 'You are a helpful assistant.',
  };
  
  console.log('Request body size:', JSON.stringify(body).length, 'bytes');
  console.log('Has system field:', true);
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    
    console.log('Response status:', response.status);
    if (response.ok) {
      const data = await response.json();
      console.log('Response OK:', JSON.stringify(data).substring(0, 200));
    } else {
      const text = await response.text();
      console.log('Response error:', text);
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}

async function testLargeRequest() {
  console.log('\n========== 测试 3: 大请求体 ==========');
  
  const largeContent = 'x'.repeat(50000); // 50KB content
  const body = {
    model: MODEL,
    max_tokens: 32000,
    messages: [{ role: 'user', content: largeContent }],
    system: 'System prompt '.repeat(100),
  };
  
  console.log('Request body size:', JSON.stringify(body).length, 'bytes');
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    
    console.log('Response status:', response.status);
    if (response.ok) {
      const data = await response.json();
      console.log('Response OK');
    } else {
      const text = await response.text();
      console.log('Response error:', text.substring(0, 500));
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}

async function testOpenAIFormat() {
  console.log('\n========== 测试 4: OpenAI 格式 (无 system 字段) ==========');
  
  const body = {
    model: MODEL,
    max_tokens: 512,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: '1+1' },
    ],
  };
  
  console.log('Request body size:', JSON.stringify(body).length, 'bytes');
  console.log('System in messages array:', true);
  
  // 尝试 OpenAI 端点
  const openaiUrl = API_URL.replace('/v1/messages', '/v1/chat/completions');
  console.log('OpenAI URL:', openaiUrl);
  
  try {
    const response = await fetch(openaiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    
    console.log('Response status:', response.status);
    if (response.ok) {
      const data = await response.json();
      console.log('Response OK:', JSON.stringify(data).substring(0, 200));
    } else {
      const text = await response.text();
      console.log('Response error:', text);
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}

async function main() {
  console.log('========================================');
  console.log('模型连接测试');
  console.log('API URL:', API_URL);
  console.log('Model:', MODEL);
  console.log('========================================');
  
  await testSimpleRequest();
  await testWithSystem();
  await testLargeRequest();
  await testOpenAIFormat();
  
  console.log('\n========================================');
  console.log('测试完成');
  console.log('========================================');
}

main().catch(console.error);
