const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Skills by category
  const skills = await prisma.skill.groupBy({
    by: ['category'],
    _count: { id: true }
  });
  console.log('=== SKILLS BY CATEGORY ===');
  skills.forEach(s => console.log(s.category + ': ' + s._count.id));
  console.log('TOTAL SKILLS: ' + skills.reduce((a, s) => a + s._count.id, 0));
  
  // TechStack by category (not type)
  const techstacks = await prisma.techStackOption.groupBy({
    by: ['category'],
    _count: { id: true }
  });
  console.log('\n=== TECHSTACK BY CATEGORY ===');
  techstacks.forEach(t => console.log(t.category + ': ' + t._count.id));
  console.log('TOTAL TECHSTACKS: ' + techstacks.reduce((a, t) => a + t._count.id, 0));
  
  // VulnerabilityPatterns by category
  const vulns = await prisma.vulnerabilityPattern.groupBy({
    by: ['category'],
    _count: { id: true }
  });
  console.log('\n=== VULNERABILITY PATTERNS BY CATEGORY ===');
  vulns.forEach(v => console.log(v.category + ': ' + v._count.id));
  console.log('TOTAL VULNERABILITY PATTERNS: ' + vulns.reduce((a, v) => a + v._count.id, 0));
}

main().catch(console.error).finally(() => prisma.$disconnect());