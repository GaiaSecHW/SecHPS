// 测试 SDK 消息格式
// 使用方法：node scripts/test-sdk-messages.js <sessionId> [projectPath]

const { getSessionMessages, getSessionInfo, listSubagents } = require('@anthropic-ai/claude-agent-sdk');

async function testSDK() {
  const sessionId = process.argv[2];
  const projectPath = process.argv[3];

  if (!sessionId) {
    console.error('Usage: node test-sdk-messages.js <sessionId> [projectPath]');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('Testing Claude SDK');
  console.log('='.repeat(80));
  console.log('Session ID:', sessionId);
  console.log('Project Path:', projectPath || 'Not specified');
  console.log('');

  try {
    // 测试 getSessionInfo
    console.log('1. Testing getSessionInfo()...');
    const sessionInfo = await getSessionInfo(sessionId, projectPath ? { dir: projectPath } : undefined);
    console.log('Session Info:', JSON.stringify(sessionInfo, null, 2));
    console.log('');

    // 测试 getSessionMessages
    console.log('2. Testing getSessionMessages()...');
    const messages = await getSessionMessages(sessionId, projectPath ? { dir: projectPath } : undefined);
    console.log('Total messages:', messages.length);
    console.log('');
    
    console.log('First 3 messages:');
    messages.slice(0, 3).forEach((msg, index) => {
      console.log(`\n--- Message ${index} ---`);
      console.log('Type:', msg.type);
      console.log('Role:', msg.role);
      console.log('ID:', msg.id);
      console.log('Keys:', Object.keys(msg));
      console.log('Full object:', JSON.stringify(msg, null, 2));
    });

    // 测试 listSubagents
    console.log('\n3. Testing listSubagents()...');
    const subagents = await listSubagents(sessionId, projectPath ? { dir: projectPath } : undefined);
    console.log('Subagents:', subagents);

  } catch (error) {
    console.error('Error:', error);
    console.error('Stack:', error.stack);
  }
}

testSDK();
