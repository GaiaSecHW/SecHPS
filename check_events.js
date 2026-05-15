const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // First check ALL recent events
  const allEvents = await prisma.codeswarmEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log('All recent events (last 20):');
  allEvents.forEach(e => console.log(`  [${e.createdAt}] ${e.taskId} | ${e.type}`));
  
  // Also check all events for the last task
  const latestTask = await prisma.codeswarmTask.findFirst({
    orderBy: { createdAt: 'desc' }
  });
  if (latestTask) {
    console.log('\n--- Latest Task ---');
    console.log('Task ID:', latestTask.id);
    console.log('Status:', latestTask.status);
    console.log('Command:', latestTask.command);
    
    const taskEvents = await prisma.codeswarmEvent.findMany({
      where: { taskId: latestTask.id },
      orderBy: { createdAt: 'asc' }
    });
    console.log('\n--- Events for latest task (' + taskEvents.length + ' events) ---');
    taskEvents.forEach(e => {
      console.log(`[${e.createdAt}] ${e.type}: ${JSON.stringify(e.data).substring(0, 100)}`);
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => {
    console.error(e);
    prisma.$disconnect();
  });