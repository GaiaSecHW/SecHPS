const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

async function main() {
  // 查找最新的评估
  const eval = await prisma.evaluationSession.findFirst({
    where: { id: { contains: '1777287928441' } },
    orderBy: { createdAt: 'desc' },
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
  console.log('Project:', eval.Project?.name);
  
  console.log('\n=== 节点状态 ===');
  eval.NodeExecution.forEach(n => {
    const updateAge = Date.now() - new Date(n.updatedAt).getTime();
    const ageMinutes = Math.floor(updateAge / 60000);
    console.log(`#${n.order}: ${n.nodeLabel} - ${n.status}`);
    console.log(`  updatedAt: ${n.updatedAt} (${ageMinutes} 分钟前)`);
    console.log(`  sessionId: ${n.opencodeSessionId || 'NULL'}`);
  });
  
  // 检查 stream 文件最后更新时间
  const nodeId = eval.NodeExecution[1]?.workflowNodeId;
  if (nodeId) {
    const streamPath = path.join('data/sessions', eval.projectId, eval.id, `node-${nodeId}`, 'stream.jsonl');
    if (fs.existsSync(streamPath)) {
      const stat = fs.statSync(streamPath);
      const streamAge = Date.now() - stat.mtime.getTime();
      const streamMinutes = Math.floor(streamAge / 60000);
      console.log('\n=== Stream 文件 ===');
      console.log('路径:', streamPath);
      console.log('最后修改:', stat.mtime, `(${streamMinutes} 分钟前)`);
      console.log('大小:', stat.size, 'bytes');
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());