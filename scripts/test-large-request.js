/**
 * 直接测试大请求体是否能成功
 */

const http = require('http');

const API_URL = 'http://172.31.29.10/v1/messages';
const API_KEY = 'sk-kRfP4WwU7kKmPqRsTUVwXyZ'; // 需要完整 key

// 构建一个大的测试请求
const largeContent = '这是一个测试内容。'.repeat(2000); // 约 20KB
const body = {
  model: 'zai-org/GLM-5',
  max_tokens: 32000,
  temperature: 0.7,
  system: '你是一个有帮助的助手。',
  stream: false,
  messages: [{ role: 'user', content: largeContent }]
};

const bodyString = JSON.stringify(body);
console.log('Request body size:', bodyString.length, 'bytes');

const url = new URL(API_URL);

const options = {
  hostname: url.hostname,
  port: url.port || 80,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
    'anthropic-version': '2023-06-01',
    'Content-Length': Buffer.byteLength(bodyString)
  }
};

console.log('Sending request to:', API_URL);
const startTime = Date.now();

const req = http.request(options, (res) => {
  console.log('Response status:', res.statusCode);
  console.log('Response headers:', JSON.stringify(res.headers, null, 2));
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    const duration = Date.now() - startTime;
    console.log('Request duration:', duration, 'ms');
    console.log('Response body length:', data.length);
    
    if (res.statusCode === 200) {
      console.log('SUCCESS!');
      try {
        const json = JSON.parse(data);
        console.log('Response preview:', JSON.stringify(json).substring(0, 500));
      } catch (e) {
        console.log('Response (first 500 chars):', data.substring(0, 500));
      }
    } else {
      console.log('ERROR response:', data);
    }
  });
});

req.on('error', (e) => {
  const duration = Date.now() - startTime;
  console.log('Request duration:', duration, 'ms');
  console.error('Request error:', e.message);
  console.error('Error code:', e.code);
});

// 设置超时
req.setTimeout(30000, () => {
  console.log('Request timeout after 30s');
  req.destroy();
});

req.write(bodyString);
req.end();

console.log('Request sent, waiting for response...');
