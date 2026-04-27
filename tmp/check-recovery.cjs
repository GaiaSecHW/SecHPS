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
          completedAt: true,
          updatedAt: true,
        }
      }
    }
  });
  
  console.log('=== 评估状态 ===');
  console.log('ID:', eval.id);
  console.log('Status:', eval.status);
  console.log('Project:', eval.Project?.name);
  console.log('LastActivity:', eval.lastActivity);
  
  console.log('\n=== 节点执行 ===');
  eval.NodeExecution.forEach(n => {
    console.log(`Node #${n.order}: ${n.nodeLabel} - status=${n.status}, sessionId=${n.opencodeSessionId || 'NULL'}`);
    console.log(`  Started: ${n.startedAt}`);
    console.log(`  Completed: ${n.completedAt || 'NOT COMPLETED'}`);
    console.log(`  Updated: ${n.updatedAt}`);
  });
  
  // 检查 JSONL 文件
  const sessionDir = path.join('data/sessions', eval.projectId, evalId);
  console.log('\n=== Session 目录 ===');
  console.log('路径:', sessionDir);
  
  if (fs.existsSync(sessionDir)) {
    const files = fs.readdirSync(sessionDir);
    files.forEach(f => {
      console.log('  ', f);
    });
    
    // 检查 messages.jsonl
    const messagesFile = path.join(sessionDir, 'messages.jsonl');
    if (fs.existsSync(messagesFile)) {
      const content = fs.readFileSync(messagesFile, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      console.log('\n=== messages.jsonl ===');
      console.log('行数:', lines.length);
      
      // 搜索恢复消息
      const recoveryLines = lines.filter(l => l.includes('请反馈当前任务的进度'));
      console.log('包含恢复消息的行数:', recoveryLines.length);
      
      // 显示每条消息的关键信息
      lines.forEach((l, i) => {
        try {
          const obj = JSON.parse(l);
          console.log(`\n消息 ${i+1}:`);
          console.log('  role:', obj.role);
          console.log('  nodeId:', obj.nodeId);
          console.log('  content (前100字):', obj.content?.substring(0, 100));
        } catch(e) {
          console.log(`  行 ${i+1}: 解析失败`);
        }
      });
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());