import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const taskId = 'task-1778745827484-h3p22wt2';
  
  const events = await prisma.$queryRaw`
    SELECT id, "taskId", type, data::text, "createdAt"
    FROM "CodeswarmEvent"
    WHERE "taskId" = ${taskId}
    ORDER BY "createdAt" DESC
    LIMIT 20
  `;
  
  console.log('Events for task:', taskId);
  console.log('Count:', events.length);
  console.log('Events:', JSON.stringify(events, null, 2));
  
  const task = await prisma.$queryRaw`
    SELECT "taskId", state, "startedAt", "completedAt", "createdAt"
    FROM "CodeswarmTask"
    WHERE "taskId" = ${taskId}
  `;
  
  console.log('\nTask state:', JSON.stringify(task, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());