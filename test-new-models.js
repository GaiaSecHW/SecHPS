const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function test() {
  try {
    const count = await p.evaluationResult.count();
    console.log('EvaluationResult exists, count:', count);
  } catch (e) {
    console.log('Error:', e.message);
  }
  try {
    const vulnCount = await p.vulnerability.count();
    console.log('Vulnerability exists, count:', vulnCount);
  } catch (e) {
    console.log('Error:', e.message);
  }
  await p.$disconnect();
}

test();
