const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('\n=== 检查漏洞数据 ===\n');
  
  // 检查漏洞总数
  const vulnCount = await prisma.vulnerability.count();
  console.log('漏洞总数:', vulnCount);
  
  // 检查评估结果
  const resultCount = await prisma.evaluationResult.count();
  console.log('评估结果总数:', resultCount);
  
  // 检查最近的评估会话
  const evals = await prisma.evaluationSession.findMany({
    orderBy: { startedAt: 'desc' },
    take: 3,
    select: {
      id: true,
      status: true,
      projectId: true,
      startedAt: true,
      completedAt: true,
      _count: {
        select: {
          messages: true,
          vulnerabilities: true,
        }
      }
    }
  });
  
  console.log('\n最近 3 个评估会话:');
  evals.forEach((e, i) => {
    console.log(`\n${i + 1}. ${e.id}`);
    console.log(`   状态: ${e.status}`);
    console.log(`   消息数: ${e._count.messages}`);
    console.log(`   漏洞数: ${e._count.vulnerabilities}`);
    console.log(`   开始时间: ${e.startedAt}`);
  });
  
  // 检查最近的漏洞
  if (vulnCount > 0) {
    const vulns = await prisma.vulnerability.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        id: true,
        title: true,
        type: true,
        severity: true,
        skill: true,
        projectId: true,
        evaluationId: true,
        createdAt: true,
      }
    });
    
    console.log('\n最近 3 个漏洞:');
    vulns.forEach((v, i) => {
      console.log(`\n${i + 1}. ${v.title}`);
      console.log(`   类型: ${v.type}`);
      console.log(`   严重程度: ${v.severity}`);
      console.log(`   工具: ${v.skill || '(未设置)'}`);
      console.log(`   项目ID: ${v.projectId}`);
      console.log(`   评估ID: ${v.evaluationId || '(未关联)'}`);
    });
  }
  
  // 检查评估结果
  if (resultCount > 0) {
    const results = await prisma.evaluationResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    
    console.log('\n最近 3 个评估结果:');
    results.forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.id}`);
      console.log(`   评估ID: ${r.evaluationId}`);
      console.log(`   总漏洞: ${r.totalVulns}`);
      console.log(`   严重: ${r.criticalCount}, 高危: ${r.highCount}, 中危: ${r.mediumCount}`);
      console.log(`   工具: ${r.skillsUsed || '(未设置)'}`);
    });
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
