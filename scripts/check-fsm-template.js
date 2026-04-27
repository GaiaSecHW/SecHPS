const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const template = await prisma.fsmTemplate.findFirst({
    where: { name: 'threat-modeling' },
    select: { 
      name: true, 
      displayName: true,
      nodes: true, 
      agentZone: true,
      skillPath: true
    }
  });
  
  console.log('FSM Template:');
  console.log('Name:', template?.name);
  console.log('DisplayName:', template?.displayName);
  console.log('SkillPath:', template?.skillPath);
  console.log('\nNodes (raw JSON):');
  console.log(template?.nodes);
  console.log('\nAgentZone (raw JSON):');
  console.log(template?.agentZone);
  
  // Parse nodes
  if (template?.nodes) {
    try {
      const nodes = JSON.parse(template.nodes);
      console.log('\nParsed Nodes:');
      for (const node of nodes) {
        console.log(`- ID: ${node.id}, Label: ${node.label}, fsmPhase: ${node.fsmPhase}, skillPath: ${node.skillPath}`);
      }
    } catch (e) {
      console.log('Failed to parse nodes:', e.message);
    }
  }
}

main().finally(() => prisma.$disconnect());