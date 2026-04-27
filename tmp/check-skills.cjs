const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const nodeId = 'wn-1777050632034-lke4zm0b2';
  
  const node = await prisma.workflowNode.findUnique({
    where: { id: nodeId },
    select: {
      skills: true,
    }
  });
  
  if (node?.skills) {
    console.log('=== Skills 配置 ===');
    const skills = JSON.parse(node.skills);
    console.log('Skills count:', skills.length);
    
    skills.forEach((s, i) => {
      console.log(`\n${i+1}. ${s.name || s.skillName || s.id || s}`);
      if (typeof s === 'object') {
        console.log('  详细:', JSON.stringify(s, null, 2));
      }
    });
  } else {
    console.log('节点没有 skills 配置');
  }
  
  // 查询评估执行时使用的 skills
  const evalId = 'eval-1777268403518-z8x6rv8gu';
  
  // 检查是否有 SkillExecution 记录
  const skillExecs = await prisma.$queryRaw`
    SELECT * FROM SkillExecution WHERE evaluationSessionId = ${evalId}
  `;
  
  console.log('\n=== SkillExecution 记录 ===');
  console.log('Count:', Array.isArray(skillExecs) ? skillExecs.length : 0);
  
  // 检查 AgentTeamExecution（可能是子任务）
  const agentTeams = await prisma.$queryRaw`
    SELECT * FROM AgentTeamExecution WHERE evaluationSessionId = ${evalId}
  `;
  
  console.log('\n=== AgentTeamExecution 记录 ===');
  console.log('Count:', Array.isArray(agentTeams) ? agentTeams.length : 0);
}

main().catch(console.error).finally(() => prisma.$disconnect());