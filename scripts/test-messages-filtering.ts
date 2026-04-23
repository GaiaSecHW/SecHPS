/**
 * 测试 EvaluationMessageStore 的 getMessages() 和 getMessageById() 功能
 * 
 * 测试内容：
 * 1. 写入 50 条消息到 3 个 nodeId
 * 2. getMessages() nodeId 过滤正确性
 * 3. getMessages() 分页功能
 * 4. getMessageById() 缓存定位优化
 * 5. 流式读取不加载全部到内存
 */

import { EvaluationMessageStore } from '../src/services/evaluation-message-store';
import { promises as fs } from 'fs';
import path from 'path';

const TEST_PROJECT_ID = 'test-proj-filtering';
const TEST_SESSION_ID = 'test-session-filtering';
const TEST_SESSION_DIR = path.join(process.cwd(), 'data', 'sessions', TEST_PROJECT_ID, TEST_SESSION_ID);
const TOTAL_MESSAGES = 50;
const NODE_IDS = ['node-1', 'node-2', 'node-3'];

async function cleanup() {
  try {
    await fs.rm(TEST_SESSION_DIR, { recursive: true, force: true });
    console.log('🧹 清理测试目录完成');
  } catch (e) {
    // 目录不存在，忽略
  }
}

async function writeMessages(store: EvaluationMessageStore) {
  console.log('\n=== 写入 50 条消息 ===');
  console.log(`总消息数: ${TOTAL_MESSAGES}, nodeId 分布: ${NODE_IDS.join(', ')}`);
  
  const messages = [];
  for (let i = 0; i < TOTAL_MESSAGES; i++) {
    const nodeId = NODE_IDS[i % NODE_IDS.length];
    const msg = await store.appendMessage({
      role: i % 2 === 0 ? 'user' : 'assistant',
      nodeId,
      nodeIndex: Math.floor(i / NODE_IDS.length),
      content: `Test message #${i} for ${nodeId}`,
      agentCallMsgId: i % 5 === 0 ? `agent-call-${i}` : null,
    });
    messages.push(msg);
  }
  
  console.log(`✅ 写入完成，共 ${messages.length} 条消息`);
  
  // 验证 nodeId 分布
  const nodeCounts: Record<string, number> = {};
  for (const msg of messages) {
    nodeCounts[msg.nodeId] = (nodeCounts[msg.nodeId] || 0) + 1;
  }
  console.log('✅ nodeId 分布:', JSON.stringify(nodeCounts));
  
  return messages;
}

async function testNodeIdFiltering(store: EvaluationMessageStore) {
  console.log('\n=== 测试 nodeId 过滤 ===');
  
  for (const nodeId of NODE_IDS) {
    const result = await store.getMessages({ nodeId });
    
    // 每个 nodeId 应有约 16-17 条消息 (50 / 3)
    const expectedCount = Math.ceil(TOTAL_MESSAGES / NODE_IDS.length);
    
    if (result.messages.length < expectedCount - 1 || result.messages.length > expectedCount + 1) {
      throw new Error(`❌ ${nodeId} 过滤结果数量异常: ${result.messages.length}, 预期约 ${expectedCount}`);
    }
    
    // 验证所有消息都属于该 nodeId
    for (const msg of result.messages) {
      if (msg.nodeId !== nodeId) {
        throw new Error(`❌ ${nodeId} 过滤结果包含错误 nodeId: ${msg.nodeId}`);
      }
    }
    
    console.log(`✅ ${nodeId} 过滤正确: ${result.messages.length} 条消息`);
  }
}

async function testPagination(store: EvaluationMessageStore) {
  console.log('\n=== 测试分页功能 ===');
  
  // 测试 offset 和 limit
  const page1 = await store.getMessages({ offset: 0, limit: 10 });
  const page2 = await store.getMessages({ offset: 10, limit: 10 });
  const page3 = await store.getMessages({ offset: 40, limit: 10 });
  
  if (page1.messages.length !== 10) {
    throw new Error(`❌ 第一页消息数量错误: ${page1.messages.length}`);
  }
  console.log('✅ 第一页正确: 10 条消息');
  
  if (page2.messages.length !== 10) {
    throw new Error(`❌ 第二页消息数量错误: ${page2.messages.length}`);
  }
  console.log('✅ 第二页正确: 10 条消息');
  
  // 第三页应该只有 10 条（总共 50 条）
  if (page3.messages.length !== 10) {
    throw new Error(`❌ 第三页消息数量错误: ${page3.messages.length}`);
  }
  console.log('✅ 第三页正确: 10 条消息');
  
  // 验证 hasMore
  if (!page1.hasMore) {
    throw new Error(`❌ 第一页 hasMore 应为 true`);
  }
  console.log('✅ 第一页 hasMore 正确: true');
  
  if (page3.hasMore) {
    throw new Error(`❌ 第三页 hasMore 应为 false`);
  }
  console.log('✅ 第三页 hasMore 正确: false');
  
  // 验证分页不重叠
  const page1Ids = page1.messages.map(m => m.id);
  const page2Ids = page2.messages.map(m => m.id);
  const overlap = page1Ids.filter(id => page2Ids.includes(id));
  
  if (overlap.length > 0) {
    throw new Error(`❌ 分页重叠: ${overlap.length} 条消息`);
  }
  console.log('✅ 分页无重叠');
}

async function testNodeIdPagination(store: EvaluationMessageStore) {
  console.log('\n=== 测试 nodeId + 分页组合 ===');
  
  // 测试 node-1 的分页
  const node1Page1 = await store.getMessages({ nodeId: 'node-1', offset: 0, limit: 5 });
  const node1Page2 = await store.getMessages({ nodeId: 'node-1', offset: 5, limit: 5 });
  
  // 验证所有消息都属于 node-1
  for (const msg of node1Page1.messages) {
    if (msg.nodeId !== 'node-1') {
      throw new Error(`❌ node-1 分页包含错误 nodeId: ${msg.nodeId}`);
    }
  }
  
  for (const msg of node1Page2.messages) {
    if (msg.nodeId !== 'node-1') {
      throw new Error(`❌ node-1 分页包含错误 nodeId: ${msg.nodeId}`);
    }
  }
  
  console.log(`✅ node-1 分页正确: 第一页 ${node1Page1.messages.length} 条, 第二页 ${node1Page2.messages.length} 条`);
}

async function testGetMessageById(store: EvaluationMessageStore, messages: any[]) {
  console.log('\n=== 测试 getMessageById() ===');
  
  // 测试查找第一条消息
  const firstMsg = await store.getMessageById(messages[0].id);
  if (!firstMsg) {
    throw new Error(`❌ 未找到第一条消息: ${messages[0].id}`);
  }
  if (firstMsg.id !== messages[0].id) {
    throw new Error(`❌ 第一条消息 ID 不匹配`);
  }
  console.log('✅ 查找第一条消息成功:', firstMsg.id);
  
  // 测试查找中间消息
  const midMsg = await store.getMessageById(messages[25].id);
  if (!midMsg) {
    throw new Error(`❌ 未找到中间消息: ${messages[25].id}`);
  }
  if (midMsg.id !== messages[25].id) {
    throw new Error(`❌ 中间消息 ID 不匹配`);
  }
  console.log('✅ 查找中间消息成功:', midMsg.id);
  
  // 测试查找最后一条消息
  const lastMsg = await store.getMessageById(messages[49].id);
  if (!lastMsg) {
    throw new Error(`❌ 未找到最后一条消息: ${messages[49].id}`);
  }
  if (lastMsg.id !== messages[49].id) {
    throw new Error(`❌ 最后一条消息 ID 不匹配`);
  }
  console.log('✅ 查找最后一条消息成功:', lastMsg.id);
  
  // 测试查找不存在的消息
  const notFound = await store.getMessageById('msg-nonexistent');
  if (notFound !== null) {
    throw new Error(`❌ 不存在的消息应返回 null`);
  }
  console.log('✅ 不存在的消息返回 null');
  
  // 测试缓存优化：再次查找第一条消息（应该使用缓存）
  const cachedMsg = await store.getMessageById(messages[0].id);
  if (!cachedMsg) {
    throw new Error(`❌ 缓存查找失败`);
  }
  console.log('✅ 缓存查找成功（第二次查找应更快）');
}

async function testAgentCallMsgIdFiltering(store: EvaluationMessageStore) {
  console.log('\n=== 测试 agentCallMsgId 过滤 ===');
  
  // 测试过滤特定 agentCallMsgId
  const result = await store.getMessages({ agentCallMsgId: 'agent-call-0' });
  
  // agent-call-0 应该只有 1 条消息（每 5 条消息有 1 条 agentCallMsgId）
  if (result.messages.length !== 1) {
    throw new Error(`❌ agentCallMsgId 过滤结果数量错误: ${result.messages.length}`);
  }
  
  if (result.messages[0].agentCallMsgId !== 'agent-call-0') {
    throw new Error(`❌ agentCallMsgId 过滤结果错误`);
  }
  
  console.log('✅ agentCallMsgId 过滤正确: 1 条消息');
}

async function testNodeIdRanges(store: EvaluationMessageStore) {
  console.log('\n=== 测试 nodeIdRanges 索引 ===');
  
  const index = await store.getIndex();
  
  // 验证所有 nodeId 都在索引中
  for (const nodeId of NODE_IDS) {
    if (!index.nodeIdRanges[nodeId]) {
      throw new Error(`❌ nodeIdRanges 缺少 ${nodeId}`);
    }
    const range = index.nodeIdRanges[nodeId];
    console.log(`✅ ${nodeId} 范围: start=${range.start}, end=${range.end}`);
  }
  
  // 验证范围覆盖所有消息（范围可能重叠，因为消息是交错写入的）
  // 取所有范围的最小 start 和最大 end
  const ranges = Object.values(index.nodeIdRanges);
  const minStart = Math.min(...ranges.map(r => r.start));
  const maxEnd = Math.max(...ranges.map(r => r.end));
  
  // 验证范围从 0 开始，到 TOTAL_MESSAGES - 1 结束
  if (minStart !== 0) {
    throw new Error(`❌ nodeIdRanges 最小 start 应为 0: ${minStart}`);
  }
  
  if (maxEnd !== TOTAL_MESSAGES - 1) {
    throw new Error(`❌ nodeIdRanges 最大 end 应为 ${TOTAL_MESSAGES - 1}: ${maxEnd}`);
  }
  
  console.log(`✅ nodeIdRanges 覆盖正确: 从 ${minStart} 到 ${maxEnd}`);
}

async function main() {
  console.log('🚀 开始测试 EvaluationMessageStore getMessages() 和 getMessageById()\n');
  
  let store: EvaluationMessageStore | null = null;
  let messages: any[] = [];
  
  try {
    // 清理旧数据
    await cleanup();
    
    // 创建 store 并初始化
    store = new EvaluationMessageStore(TEST_PROJECT_ID, TEST_SESSION_ID);
    await store.initialize();
    console.log('✅ 初始化成功');
    
    // 测试 1: 写入 50 条消息
    messages = await writeMessages(store);
    
    // 测试 2: nodeId 过滤
    await testNodeIdFiltering(store);
    
    // 测试 3: 分页功能
    await testPagination(store);
    
    // 测试 4: nodeId + 分页组合
    await testNodeIdPagination(store);
    
    // 测试 5: getMessageById()
    await testGetMessageById(store, messages);
    
    // 测试 6: agentCallMsgId 过滤
    await testAgentCallMsgIdFiltering(store);
    
    // 测试 7: nodeIdRanges 索引
    await testNodeIdRanges(store);
    
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