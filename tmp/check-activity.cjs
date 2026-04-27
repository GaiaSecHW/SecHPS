const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

async function main() {
  const evalId = 'eval-1777287928441-sixzjlcf1';
  
  const eval = await prisma.evaluationSession.findUnique({
    where: { id: evalId },
    include: {
      Project: { select: { name: true } },
      NodeExecution: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          workflowNodeId: true,
          nodeLabel: true,
          nodeType: true,
          status: true,
          order: true,
          opencodeSessionId: true,
          startedAt: true,
          updatedAt: true,
        }
      }
    }
  });
  
  if (!eval) {
    console.log('未找到评估');
    return;
  }
  
  console.log('=== 评估状态 ===');
  console.log('ID:', eval.id);
  console.log('workflowType:', eval.workflowType);
  console.log('Status:', eval.status);
  console.log('LastActivity:', eval.lastActivity);
  
  const now = Date.now();
  const lastActivityAge = (now - new Date(eval.lastActivity).getTime()) / 60000;
  console.log('LastActivity 年龄:', lastActivityAge.toFixed(2), '分钟');
  
  console.log('\n=== 节点状态 ===');
  eval.NodeExecution.forEach(n => {
    const updateAge = (now - new Date(n.updatedAt).getTime()) / 60000;
    console.log(`#${n.order}: ${n.nodeLabel} - ${n.status}`);
    console.log(`  updatedAt: ${n.updatedAt}`);
    console.log(`  年龄: ${updateAge.toFixed(2)} 分钟`);
    console.log(`  sessionId: ${n.opencodeSessionId || 'NULL'}`);
  });
  
  // 检查 stream 文件最后更新时间
  const nodeId = eval.NodeExecution[1]?.workflowNodeId;
  if (nodeId) {
    const streamPath = path.join('data/sessions', eval.projectId, eval.id, `node-${nodeId}`, 'stream.jsonl');
    console.log('\n=== Stream 文件 ===');
    console.log('路径:', streamPath);
    
    if (fs.existsSync(streamPath)) {
      const stat = fs.statSync(streamPath);
      const streamAge = (now - stat.mtime.getTime()) / 60000;
      console.log('最后修改:', stat.mtime);
      console.log('年龄:', streamAge.toFixed(2), '分钟');
      console.log('大小:', stat.size, 'bytes');
      
      // 判断是否正在执行
      if (streamAge < 5) {
        console.log('\n结论: stream 文件在5分钟内更新，节点正在执行');
      } else {
        console.log('\n结论: stream 文件超过5分钟未更新，节点可能中断');
      }
    } else {
      console.log('文件不存在');
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());