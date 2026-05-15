import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const taskId = process.argv[2] || 'task-1778746694490-zpn6mwxw';

async function checkEvents() {
  const events = await prisma.codeswarmEvent.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' }
  });
  
  console.log(`Task: ${taskId}`);
  console.log(`Total events: ${events.length}`);
  console.log('Events:');
  console.log('Full event data:');
  console.log(JSON.stringify(events, null, 2));
  
  events.forEach(e => {
    console.log(`- eventType: ${e.eventType}, createdAt: ${e.createdAt}`);
    if (e.payload) {
      console.log(`  payload: ${JSON.stringify(e.payload)}`);
    }
  });
  
  await prisma.$disconnect();
}

checkEvents();