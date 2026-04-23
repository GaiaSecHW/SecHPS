/**
 * 测试 EvaluationMessageStore 的并发写入控制
 * 
 * 测试内容：
 * 1. 10 条并发写入，验证文件行数正确
 * 2. 验证每行 JSON 独立完整（无交错）
 * 3. 验证 messageCount 正确
 */

import { EvaluationMessageStore } from '../src/services/evaluation-message-store';
import { promises as fs } from 'fs';
import path from 'path';

const TEST_PROJECT_ID = 'test-proj-concurrent';
const TEST_SESSION_ID = 'test-session-concurrent';
const TEST_SESSION_DIR = path.join(process.cwd(), 'data', 'sessions', TEST_PROJECT_ID, TEST_SESSION_ID);
const CONCURRENT_COUNT = 10;

async function cleanup() {
  try {
    await fs.rm(TEST_SESSION_DIR, { recursive: true, force: true });
    console.log('🧹 清理测试目录完成');
  } catch (e) {
    // 目录不存在，忽略
  }
}

async function testConcurrentWrite() {
  console.log('\n=== 测试并发写入 ===');
  console.log(`并发数量: ${CONCURRENT_COUNT}`);
  
  const store = new EvaluationMessageStore(TEST_PROJECT_ID, TEST_SESSION_ID);
  
  // 先清理可能存在的旧目录
  await cleanup();
  
  // 初始化
  await store.initialize();
  console.log('✅ 初始化成功');
  
  // 创建并发写入任务
  const tasks = [];
  for (let i = 0; i < CONCURRENT_COUNT; i++) {
    tasks.push(
      store.appendMessage({
        role: i % 2 === 0 ? 'user' : 'assistant',
        nodeId: `node-${i % 3}`, // 3 个不同的 nodeId
        nodeIndex: i,
        content: `Concurrent message #${i}`,
        agentCallMsgId: i % 4 === 0 ? `agent-call-${i}` : null,
      })
    );
  }
  
  // 并发执行
  console.log('⏳ 开始并发写入...');
  const startTime = Date.now();
  const results = await Promise.all(tasks);
  const elapsed = Date.now() - startTime;
  console.log(`✅ 并发写入完成，耗时: ${elapsed}ms`);
  
  // 验证返回的消息数量
  if (results.length !== CONCURRENT_COUNT) {
    throw new Error(`❌ 返回消息数量错误: ${results.length}`);
  }
  console.log('✅ 返回消息数量正确:', results.length);
  
  // 验证每条消息都有唯一 ID
  const ids = results.map(r => r.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== CONCURRENT_COUNT) {
    throw new Error(`❌ 消息 ID 不唯一: ${uniqueIds.size}`);
  }
  console.log('✅ 所有消息 ID 唯一');
  
  return { store, results };
}

async function verifyFileIntegrity(results: any[]) {
  console.log('\n=== 验证文件完整性 ===');
  
  const messagesPath = path.join(TEST_SESSION_DIR, 'messages.jsonl');
  const content = await fs.readFile(messagesPath, 'utf-8');
  const lines = content.trim().split('\n').filter(l => l.length > 0);
  
  // 验证行数
  if (lines.length !== CONCURRENT_COUNT) {
    throw new Error(`❌ 文件行数应为 ${CONCURRENT_COUNT}: ${lines.length}`);
  }
  console.log('✅ 文件行数正确:', lines.length);
  
  // 验证每行 JSON 格式正确（无交错）
  const parsedMessages = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const msg = JSON.parse(lines[i]);
      parsedMessages.push(msg);
      
      // 验证必需字段存在
      if (!msg.id || !msg.sessionId || !msg.timestamp || !msg.nodeId) {
        throw new Error(`❌ 第 ${i + 1} 行缺少必需字段`);
      }
    } catch (e) {
      throw new Error(`❌ 第 ${i + 1} 行 JSON 解析失败: ${e.message}`);
    }
  }
  console.log('✅ 所有行 JSON 格式正确，无交错');
  
  // 验证所有写入的消息都在文件中
  const fileIds = parsedMessages.map(m => m.id);
  const writtenIds = results.map(r => r.id);
  
  for (const id of writtenIds) {
    if (!fileIds.includes(id)) {
      throw new Error(`❌ 消息 ${id} 未写入文件`);
    }
  }
  console.log('✅ 所有写入的消息都在文件中');
  
  return parsedMessages;
}

async function verifyMessageCount(store: EvaluationMessageStore) {
  console.log('\n=== 验证 messageCount ===');
  
  const count = await store.getMessageCount();
  
  if (count !== CONCURRENT_COUNT) {
    throw new Error(`❌ messageCount 应为 ${CONCURRENT_COUNT}: ${count}`);
  }
  console.log('✅ messageCount 正确:', count);
}

async function verifyNodeIdRanges(store: EvaluationMessageStore) {
  console.log('\n=== 验证 nodeIdRanges ===');
  
  const index = await store.getIndex();
  
  // 应有 3 个 nodeId (node-0, node-1, node-2)
  const expectedNodeIds = ['node-0', 'node-1', 'node-2'];
  for (const nodeId of expectedNodeIds) {
    if (!index.nodeIdRanges[nodeId]) {
      throw new Error(`❌ nodeIdRanges 缺少 ${nodeId}`);
    }
  }
  console.log('✅ nodeIdRanges 包含所有 nodeId:', Object.keys(index.nodeIdRanges));
  
  // 验证每个 nodeId 的范围
  for (const [nodeId, range] of Object.entries(index.nodeIdRanges)) {
    console.log(`  ${nodeId}: start=${range.start}, end=${range.end}`);
  }
}

async function main() {
  console.log('🚀 开始测试 EvaluationMessageStore 并发写入控制\n');
  
  let store: EvaluationMessageStore | null = null;
  let results: any[] = [];
  
  try {
    // 测试 1: 并发写入
    const { store: s, results: r } = await testConcurrentWrite();
    store = s;
    results = r;
    
    // 测试 2: 验证文件完整性
    await verifyFileIntegrity(results);
    
    // 测试 3: 验证 messageCount
    await verifyMessageCount(store);
    
    // 测试 4: 验证 nodeIdRanges
    await verifyNodeIdRanges(store);
    
    console.log('\n🎉 所有并发测试通过！');
    
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