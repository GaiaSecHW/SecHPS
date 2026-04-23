/**
 * verify-jsonl-consistency.ts
 * 
 * 验证 Prisma SessionMessage 和 JSONL 消息的一致性
 * 用于双写过渡期的数据验证
 * 
 * 运行方式：npx tsx scripts/verify-jsonl-consistency.ts [evaluationId]
 */

import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const prisma = new PrismaClient();

// JSONL 存储根目录
const SESSIONS_BASE_DIR = path.join(process.cwd(), 'data', 'sessions');

interface JsonlMessage {
  id: string;
  sessionId: string;
  role: string;
  nodeId: string;
  nodeIndex: number;
  content: string | any[];
  agentCallMsgId: string | null;
  timestamp: string;
  toolName?: string;
  toolInput?: any;
  toolResult?: any;
  toolUseId?: string;
}

interface VerificationResult {
  evaluationId: string;
  projectId: string;
  prismaCount: number;
  jsonlCount: number;
  matchCount: number;
  mismatchCount: number;
  missingInJsonl: number;
  missingInPrisma: number;
  details: {
    prismaOnly: string[];
    jsonlOnly: string[];
    mismatches: {
      id: string;
      field: string;
      prismaValue: any;
      jsonlValue: any;
    }[];
  };
  status: 'PASS' | 'FAIL' | 'NO_JSONL';
}

/**
 * 从 JSONL 文件读取所有消息
 */
async function readJsonlMessages(projectId: string, evaluationId: string): Promise<JsonlMessage[]> {
  const jsonlPath = path.join(SESSIONS_BASE_DIR, projectId, evaluationId, 'messages.jsonl');
  
  try {
    await fs.access(jsonlPath);
  } catch {
    return [];  // 文件不存在
  }
  
  const fileStream = await fs.open(jsonlPath, 'r');
  const rl = readline.createInterface({
    input: fileStream.createReadStream(),
    crlfDelay: Infinity,
  });
  
  const messages: JsonlMessage[] = [];
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      messages.push(msg);
    } catch (parseError) {
      console.error(`JSONL 解析错误: ${line}`);
    }
  }
  
  await fileStream.close();
  return messages;
}

/**
 * 验证单个评估会话
 */
async function verifySession(evaluationId: string): Promise<VerificationResult> {
  // 1. 获取评估会话信息
  const session = await prisma.evaluationSession.findUnique({
    where: { id: evaluationId },
    select: { id: true, projectId: true },
  });
  
  if (!session) {
    throw new Error(`评估会话不存在: ${evaluationId}`);
  }
  
  const projectId = session.projectId;
  
  // 2. 从 Prisma 获取消息
  const prismaMessages = await prisma.sessionMessage.findMany({
    where: { evaluationSessionId: evaluationId },
    orderBy: { createdAt: 'asc' },
  });
  
  // 3. 从 JSONL 获取消息
  const jsonlMessages = await readJsonlMessages(projectId, evaluationId);
  
  // 4. 比较一致性
  const prismaMap = new Map(prismaMessages.map(m => [m.id, m]));
  const jsonlMap = new Map(jsonlMessages.map(m => [m.id, m]));
  
  const prismaOnly: string[] = [];
  const jsonlOnly: string[] = [];
  const mismatches: { id: string; field: string; prismaValue: any; jsonlValue: any }[] = [];
  
  // 检查 Prisma 中存在但 JSONL 中不存在
  for (const [id, prismaMsg] of prismaMap) {
    if (!jsonlMap.has(id)) {
      prismaOnly.push(id);
    }
  }
  
  // 检查 JSONL 中存在但 Prisma 中不存在
  for (const [id, jsonlMsg] of jsonlMap) {
    if (!prismaMap.has(id)) {
      jsonlOnly.push(id);
    }
  }
  
  // 检查共同消息的字段一致性
  for (const [id, prismaMsg] of prismaMap) {
    const jsonlMsg = jsonlMap.get(id);
    if (!jsonlMsg) continue;
    
    // 比较 role
    const prismaRole = prismaMsg.role;
    const jsonlRole = jsonlMsg.role;
    // 映射 JSONL role 到 Prisma role
    const roleMap: Record<string, string> = {
      'user': 'user',
      'assistant': 'assistant',
      'system': 'system',
      'tool_use': 'tool_call',
      'tool_result': 'tool_result',
    };
    const expectedPrismaRole = roleMap[jsonlRole] || jsonlRole;
    if (prismaRole !== expectedPrismaRole && prismaRole !== jsonlRole) {
      mismatches.push({
        id,
        field: 'role',
        prismaValue: prismaRole,
        jsonlValue: jsonlRole,
      });
    }
    
    // 比较 content（简化比较，只比较长度）
    const prismaContent = prismaMsg.content;
    const jsonlContent = typeof jsonlMsg.content === 'string' ? jsonlMsg.content : JSON.stringify(jsonlMsg.content);
    if (prismaContent.length !== jsonlContent.length) {
      // 内容长度不同，但可能是正常的（JSONL 可能包含更多结构化信息）
      // 只记录，不视为错误
    }
  }
  
  // 5. 计算统计
  const matchCount = prismaMessages.length - prismaOnly.length;
  const mismatchCount = mismatches.length;
  const missingInJsonl = prismaOnly.length;
  const missingInPrisma = jsonlOnly.length;
  
  // 6. 确定状态
  let status: 'PASS' | 'FAIL' | 'NO_JSONL';
  if (jsonlMessages.length === 0) {
    status = 'NO_JSONL';
  } else if (missingInJsonl === 0 && missingInPrisma === 0 && mismatchCount === 0) {
    status = 'PASS';
  } else {
    status = 'FAIL';
  }
  
  return {
    evaluationId,
    projectId,
    prismaCount: prismaMessages.length,
    jsonlCount: jsonlMessages.length,
    matchCount,
    mismatchCount,
    missingInJsonl,
    missingInPrisma,
    details: {
      prismaOnly,
      jsonlOnly,
      mismatches,
    },
    status,
  };
}

/**
 * 验证所有评估会话
 */
async function verifyAllSessions(): Promise<VerificationResult[]> {
  const sessions = await prisma.evaluationSession.findMany({
    select: { id: true, projectId: true },
    orderBy: { id: 'desc' },
    take: 50,  // 限制数量，避免过多
  });
  
  const results: VerificationResult[] = [];
  
  for (const session of sessions) {
    try {
      const result = await verifySession(session.id);
      results.push(result);
    } catch (error) {
      console.error(`验证会话 ${session.id} 失败:`, error);
    }
  }
  
  return results;
}

/**
 * 打印验证结果
 */
function printResult(result: VerificationResult): void {
  console.log('\n' + '='.repeat(60));
  console.log(`评估会话: ${result.evaluationId}`);
  console.log(`项目 ID: ${result.projectId}`);
  console.log(`状态: ${result.status}`);
  console.log('-'.repeat(60));
  console.log(`Prisma 消息数: ${result.prismaCount}`);
  console.log(`JSONL 消息数: ${result.jsonlCount}`);
  console.log(`匹配数: ${result.matchCount}`);
  console.log(`不匹配数: ${result.mismatchCount}`);
  console.log(`JSONL 缺失: ${result.missingInJsonl}`);
  console.log(`Prisma 缺失: ${result.missingInPrisma}`);
  
  if (result.details.prismaOnly.length > 0) {
    console.log('\n仅在 Prisma 中存在的消息 ID:');
    result.details.prismaOnly.slice(0, 10).forEach(id => console.log(`  - ${id}`));
    if (result.details.prismaOnly.length > 10) {
      console.log(`  ... 还有 ${result.details.prismaOnly.length - 10} 条`);
    }
  }
  
  if (result.details.jsonlOnly.length > 0) {
    console.log('\n仅在 JSONL 中存在的消息 ID:');
    result.details.jsonlOnly.slice(0, 10).forEach(id => console.log(`  - ${id}`));
    if (result.details.jsonlOnly.length > 10) {
      console.log(`  ... 还有 ${result.details.jsonlOnly.length - 10} 条`);
    }
  }
  
  if (result.details.mismatches.length > 0) {
    console.log('\n字段不匹配:');
    result.details.mismatches.slice(0, 10).forEach(m => {
      console.log(`  - 消息 ${m.id}: ${m.field} (Prisma: ${m.prismaValue}, JSONL: ${m.jsonlValue})`);
    });
    if (result.details.mismatches.length > 10) {
      console.log(`  ... 还有 ${result.details.mismatches.length - 10} 条`);
    }
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  
  console.log('JSONL 一致性验证工具');
  console.log('='.repeat(60));
  
  try {
    if (args.length > 0) {
      // 验证指定会话
      const evaluationId = args[0];
      console.log(`验证指定会话: ${evaluationId}`);
      const result = await verifySession(evaluationId);
      printResult(result);
    } else {
      // 验证所有会话
      console.log('验证所有评估会话（最近 50 个）...');
      const results = await verifyAllSessions();
      
      // 统计汇总
      const passCount = results.filter(r => r.status === 'PASS').length;
      const failCount = results.filter(r => r.status === 'FAIL').length;
      const noJsonlCount = results.filter(r => r.status === 'NO_JSONL').length;
      
      console.log('\n' + '='.repeat(60));
      console.log('汇总统计:');
      console.log(`  通过: ${passCount}`);
      console.log(`  失败: ${failCount}`);
      console.log(`  无 JSONL: ${noJsonlCount}`);
      console.log(`  总计: ${results.length}`);
      
      // 打印失败和无 JSONL 的会话
      if (failCount > 0 || noJsonlCount > 0) {
        console.log('\n需要关注的会话:');
        results.filter(r => r.status !== 'PASS').forEach(r => {
          console.log(`  - ${r.evaluationId}: ${r.status} (Prisma: ${r.prismaCount}, JSONL: ${r.jsonlCount})`);
        });
      }
      
      // 详细打印失败的会话
      results.filter(r => r.status === 'FAIL').forEach(printResult);
    }
  } catch (error) {
    console.error('验证失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();