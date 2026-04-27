const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkLatest() {
  // 查询最新的评估，按 lastActivity 排序
  const result = await prisma.$queryRaw`
    SELECT id, workflowType, status, lastActivity, projectId 
    FROM EvaluationSession 
    ORDER BY lastActivity DESC 
    LIMIT 10
  `;
  
  console.log('Latest EvaluationSessions:');
  result.forEach(r => console.log(`  ${r.id} - workflowType: ${r.workflowType} - status: ${r.status} - projectId: ${r.projectId}`));
  
  await prisma.$disconnect();
}

checkLatest().catch(e => console.error('Error:', e.message));