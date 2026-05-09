const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSchema() {
  // 直接查询数据库看 workflowType 列是否存在
  const result = await prisma.$queryRaw`
    SELECT id, workflowType FROM EvaluationSession LIMIT 5
  `;
  
  console.log('EvaluationSessions:');
  result.forEach(r => console.log(`  ${r.id} - workflowType: ${r.workflowType}`));
  
  await prisma.$disconnect();
}

checkSchema().catch(e => console.error('Error:', e.message));