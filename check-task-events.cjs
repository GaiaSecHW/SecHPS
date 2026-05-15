const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const taskId = process.argv[2] || 'task-1778747143806-2ezjtdjo';

async function checkEvents() {
  try {
    const events = await prisma.codeswarmEvent.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' }
    });
    
    console.log(`Task: ${taskId}`);
    console.log(`Total events: ${events.length}`);
    console.log('Events:');
    events.forEach(e => {
      console.log(`- type: ${e.type}, createdAt: ${e.createdAt}`);
      if (e.data) {
        try {
          const data = JSON.parse(e.data);
          console.log(`  data: ${JSON.stringify(data)}`);
        } catch {
          console.log(`  data (raw): ${e.data}`);
        }
      }
    });
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    await prisma.$disconnect();
  }
}

checkEvents();