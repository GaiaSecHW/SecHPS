/**
 * 测试不同大小的请求，找出服务器能接受的最大请求体
 */

const API_URL = 'http://172.31.29.10/v1/messages';
const API_KEY = 'sk-kRfP4WwU7kKmPqRsTUVwXyZ'; // 替换为完整 key
const MODEL = 'zai-org/GLM-5';

async function testRequest(size, includeSystem = false) {
  const content = 'x'.repeat(size);
  const body = {
    model: MODEL,
    max_tokens: 32000,
    temperature: 0.7,
    stream: false,
    messages: [{ role: 'user', content }],
  };
  
  if (includeSystem) {
    body.system = 'You are a helpful assistant.';
  }
  
  console.log(`\n测试: ${size} bytes, system=${includeSystem}`);
  console.log('请求体大小:', JSON.stringify(body).length, 'bytes');
  
  const startTime = Date.now();
  
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
    
    const duration = Date.now() - startTime;
    console.log('状态:', response.status, '耗时:', duration, 'ms');
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ 成功');
      return true;
    } else {
      const text = await response.text();
      console.log('❌ 失败:', text.substring(0, 200));
      return false;
    }
  } catch (e) {
    const duration = Date.now() - startTime;
    console.log('❌ 错误:', e.message, '耗时:', duration, 'ms');
    return false;
  }
}

async function main() {
  console.log('========== 测试服务器请求限制 ==========');
  console.log('API URL:', API_URL);
  console.log('Model:', MODEL);
  
  // 测试 1: 小请求，无 system
  await testRequest(100, false);
  
  // 测试 2: 小请求，有 system
  await testRequest(100, true);
  
  // 测试 3: 中等请求 (5KB)，无 system
  await testRequest(5000, false);
  
  // 测试 4: 中等请求 (5KB)，有 system
  await testRequest(5000, true);
  
  // 测试 5: 大请求 (30KB)，无 system
  await testRequest(30000, false);
  
  // 测试 6: 大请求 (30KB)，有 system
  await testRequest(30000, true);
  
  console.log('\n========== 测试完成 ==========');
}

main().catch(console.error);
