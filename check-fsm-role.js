const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const template = await prisma.fSMTemplate.findUnique({
    where: { id: 'threat-modeling' },
    select: { nodes: true }
  });
  
  const nodes = JSON.parse(template.nodes);
  console.log('FSM Nodes:');
  nodes.forEach(n => {
    console.log(`  ${n.label}: roleId=${n.roleId || 'undefined'}`);
  });
  
  const nodesWithoutRole = nodes.filter(n => !n.roleId);
  console.log(`\nNodes without role: ${nodesWithoutRole.length}`);
}

main().finally(() => prisma.$disconnect());
