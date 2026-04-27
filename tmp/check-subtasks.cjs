const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const evalId = 'eval-1777268403518-z8x6rv8gu';
  
  // 查询 opencode session 目录下的子任务进度
  // 1. 检查是否有进度文件
  
  const fs = require('fs');
  const path = require('path');
  
  const sessionDir = path.join('data/sessions', 'proj-1777021450958-ow16z9t27', evalId);
  
  console.log('=== Session 目录内容 ===');
  console.log('目录:', sessionDir);
  
  if (fs.existsSync(sessionDir)) {
    const files = fs.readdirSync(sessionDir, { withFileTypes: true });
    files.forEach(f => {
      console.log(`  ${f.name} ${f.isDirectory() ? '[DIR]' : '[FILE]'}`);
      
      // 如果是目录，检查内部文件
      if (f.isDirectory()) {
        const subDir = path.join(sessionDir, f.name);
        const subFiles = fs.readdirSync(subDir);
        console.log(`    子目录内容 (${subFiles.length}):`);
        subFiles.forEach(sf => {
          console.log(`      ${sf}`);
        });
      }
    });
  }
  
  // 2. 检查 agents 目录（可能有子agent进度）
  const agentsDir = path.join(sessionDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    console.log('\n=== Agents 目录 ===');
    const agentFiles = fs.readdirSync(agentsDir);
    agentFiles.forEach(af => {
      console.log(`  ${af}`);
      
      // 读取每个 agent 的状态文件
      const agentPath = path.join(agentsDir, af);
      if (fs.statSync(agentPath).isDirectory()) {
        const agentStatusFiles = fs.readdirSync(agentPath);
        agentStatusFiles.forEach(asf => {
          console.log(`    ${asf}`);
        });
      }
    });
  }
  
  // 3. 检查 NodeExecution 的其他字段（可能有进度信息）
  const nodeExec = await prisma.nodeExecution.findUnique({
    where: { id: 'nodeexec-1777268714644-up23qhdxs' },
    select: {
      id: true,
      status: true,
      nodeLabel: true,
      opencodeSessionId: true,
      modelConfigId: true,
      modelName: true,
      inputTokens: true,
      outputTokens: true,
      errorMessage: true,
      metadata: true,
    }
  });
  
  console.log('\n=== NodeExecution 详细 ===');
  console.log('ID:', nodeExec?.id);
  console.log('Status:', nodeExec?.status);
  console.log('SessionId:', nodeExec?.opencodeSessionId);
  console.log('InputTokens:', nodeExec?.inputTokens);
  console.log('OutputTokens:', nodeExec?.outputTokens);
  console.log('Metadata:', nodeExec?.metadata);
}

main().catch(console.error).finally(() => prisma.$disconnect());