/**
 * 测试 EvaluationMessageStore 的 appendMessage() 功能
 * 
 * 测试内容：
 * 1. initialize() 创建目录和文件
 * 2. appendMessage() 写入单条消息
 * 3. getMessageCount() 返回正确数量
 * 4. getIndex() 包含 projectId 和 nodeIdRanges
 */

import { EvaluationMessageStore } from '../src/services/evaluation-message-store';
import { promises as fs } from 'fs';
import path from 'path';

const TEST_PROJECT_ID = 'test-proj-append';
const TEST_SESSION_ID = 'test-session-append';
const TEST_SESSION_DIR = path.join(process.cwd(), 'data', 'sessions', TEST_PROJECT_ID, TEST_SESSION_ID);

async function cleanup() {
  try {
    await fs.rm(TEST_SESSION_DIR, { recursive: true, force: true });
    console.log('🧹 清理测试目录完成');
  } catch (e) {
    // 目录不存在，忽略
  }
}

async function testInitialize() {
  console.log('\n=== 测试 initialize() ===');
  
  const store = new EvaluationMessageStore(TEST_PROJECT_ID, TEST_SESSION_ID);
  
  // 先清理可能存在的旧目录
  await cleanup();
  
  // 初始化
  await store.initialize();
  
  // 验证目录存在
  try {
    await fs.access(TEST_SESSION_DIR);
    console.log('✅ 目录创建成功:', TEST_SESSION_DIR);
  } catch {
    throw new Error('❌ 目录未创建');
  }
  
  // 验证 messages.jsonl 存在
  const messagesPath = path.join(TEST_SESSION_DIR, 'messages.jsonl');
  try {
    await fs.access(messagesPath);
    const content = await fs.readFile(messagesPath, 'utf-8');
    if (content === '') {
      console.log('✅ messages.jsonl 创建成功（空文件）');
    } else {
      throw new Error('❌ messages.jsonl 应为空文件');
    }
  } catch {
    throw new Error('❌ messages.jsonl 未创建');
  }
  
  // 验证 index.json 存在且内容正确
  const indexPath = path.join(TEST_SESSION_DIR, 'index.json');
  const indexContent = await fs.readFile(indexPath, 'utf-8');
  const index = JSON.parse(indexContent);
  
  if (index.sessionId !== TEST_SESSION_ID) {
    throw new Error(`❌ index.json sessionId 错误: ${index.sessionId}`);
  }
  console.log('✅ index.json sessionId 正确:', index.sessionId);
  
  if (index.projectId !== TEST_PROJECT_ID) {
    throw new Error(`❌ index.json projectId 错误: ${index.projectId}`);
  }
  console.log('✅ index.json projectId 正确:', index.projectId);
  
  if (index.messageCount !== 0) {
    throw new Error(`❌ index.json messageCount 应为 0: ${index.messageCount}`);
  }
  console.log('✅ index.json messageCount 正确:', index.messageCount);
  
  return store;
}

async function testAppendMessage(store: EvaluationMessageStore) {
  console.log('\n=== 测试 appendMessage() ===');
  
  const msg = await store.appendMessage({
    role: 'user',
    nodeId: 'node-1',
    nodeIndex: 0,
    content: 'Hello, this is a test message',
    agentCallMsgId: null,
  });
  
  // 验证消息 ID 格式
  if (!msg.id.startsWith('msg-')) {
    throw new Error(`❌ 消息 ID 格式错误: ${msg.id}`);
  }
  console.log('✅ 消息 ID 格式正确:', msg.id);
  
  // 验证 sessionId
  if (msg.sessionId !== TEST_SESSION_ID) {
    throw new Error(`❌ 消息 sessionId 错误: ${msg.sessionId}`);
  }
  console.log('✅ 消息 sessionId 正确:', msg.sessionId);
  
  // 验证 timestamp 存在
  if (!msg.timestamp) {
    throw new Error('❌ 消息缺少 timestamp');
  }
  console.log('✅ 消息 timestamp 正确:', msg.timestamp);
  
  // 验证文件写入
  const messagesPath = path.join(TEST_SESSION_DIR, 'messages.jsonl');
  const content = await fs.readFile(messagesPath, 'utf-8');
  const lines = content.trim().split('\n');
  
  if (lines.length !== 1) {
    throw new Error(`❌ 文件行数应为 1: ${lines.length}`);
  }
  console.log('✅ 文件行数正确:', lines.length);
  
  // 验证 JSON 格式
  const parsed = JSON.parse(lines[0]);
  if (parsed.id !== msg.id) {
    throw new Error(`❌ JSON 内容 ID 不匹配`);
  }
  console.log('✅ JSON 格式正确，内容匹配');
  
  return msg;
}

async function testGetMessageCount(store: EvaluationMessageStore) {
  console.log('\n=== 测试 getMessageCount() ===');
  
  const count = await store.getMessageCount();
  
  if (count !== 1) {
    throw new Error(`❌ 消息数量应为 1: ${count}`);
  }
  console.log('✅ 消息数量正确:', count);
}

async function testGetIndex(store: EvaluationMessageStore) {
  console.log('\n=== 测试 getIndex() ===');
  
  const index = await store.getIndex();
  
  // 验证 projectId
  if (index.projectId !== TEST_PROJECT_ID) {
    throw new Error(`❌ 索引 projectId 错误: ${index.projectId}`);
  }
  console.log('✅ 索引 projectId 正确:', index.projectId);
  
  // 验证 nodeIdRanges
  if (!index.nodeIdRanges['node-1']) {
    throw new Error('❌ 索引缺少 node-1 的 nodeIdRanges');
  }
  console.log('✅ 索引 nodeIdRanges 正确:', JSON.stringify(index.nodeIdRanges));
  
  // 验证 messageCount
  if (index.messageCount !== 1) {
    throw new Error(`❌ 索引 messageCount 应为 1: ${index.messageCount}`);
  }
  console.log('✅ 索引 messageCount 正确:', index.messageCount);
}

async function main() {
  console.log('🚀 开始测试 EvaluationMessageStore appendMessage() 功能\n');
  
  let store: EvaluationMessageStore | null = null;
  
  try {
    // 测试 1: initialize()
    store = await testInitialize();
    
    // 测试 2: appendMessage()
    await testAppendMessage(store);
    
    // 测试 3: getMessageCount()
    await testGetMessageCount(store);
    
    // 测试 4: getIndex()
    await testGetIndex(store);
    
    console.log('\n🎉 所有测试通过！');
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  } finally {
    // 清理测试目录
    if (store) {
      await store.delete();
      console.log('🧹 清理测试数据完成');
    }
  }
}

main();