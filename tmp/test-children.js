const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const result = await prisma.evaluationSession.findUnique({
      where: { id: 'eval-1776918813706-o0cymfcxu' },
      select: { projectId: true },
    });
    console.log('Session:', JSON.stringify(result));
    
    if (result) {
      // Test messages
      const messages = await prisma.sessionMessage.findMany({
        where: { evaluationSessionId: 'eval-1776918813706-o0cymfcxu' },
        select: { id: true, role: true },
        take: 5,
      });
      console.log('Messages:', messages.length);
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();