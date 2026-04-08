#!/usr/bin/env node
/**
 * 诊断脚本：检查 API 配置和连接
 * 用法: node diagnose-api.js
 */

const https = require('https');
const http = require('http');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testAPI(config) {
  return new Promise((resolve, reject) => {
    const url = new URL(config.apiBaseUrl);
    const data = JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'user',
          content: 'Hello, this is a test message.',
        },
      ],
      max_tokens: 100,
    });

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Bearer ${config.apiKey}`,
      },
    };

    log('cyan', `\n测试 API 连接...`);
    log('blue', `URL: ${config.apiBaseUrl}`);
    log('blue', `Model: ${config.model}`);
    log('blue', `Provider: ${config.providerType}`);

    const protocol = url.protocol === 'https:' ? https : http;
    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: response,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

async function diagnose() {
  log('yellow', '='.repeat(60));
  log('yellow', 'API 配置诊断工具');
  log('yellow', '='.repeat(60));

  // 配置建议
  log('cyan', '\n1. 配置建议:');
  log('yellow', '  如果使用京东云 GLM-5:');
  log('blue', '    providerType: "openai"');
  log('blue', '    apiBaseUrl: "https://modelservice.jdcloud.com/coding/openai/v1"');
  log('blue', '    model: "GLM-5"');
  log('yellow', '\n  如果使用 Anthropic Claude:');
  log('blue', '    providerType: "claude"');
  log('blue', '    apiBaseUrl: "https://api.anthropic.com/v1/messages"');
  log('blue', '    model: "claude-sonnet-4-20250514"');

  log('yellow', '\n' + '='.repeat(60));
  log('green', '诊断完成！');
  log('yellow', '='.repeat(60));
}

// 运行诊断
diagnose().catch((error) => {
  log('red', `\n诊断失败: ${error.message}`);
  process.exit(1);
});
