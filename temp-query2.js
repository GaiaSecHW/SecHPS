const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const events = await prisma.codeswarmEvent.findMany({
    where: { taskId: "task-1778748123839-m54xr5og" },
    orderBy: { createdAt: "asc" },
    take: 50
  });
  console.log("Found", events.length, "events for task-1778748123839-m54xr5og");
  events.forEach(e => {
    console.log(e.type, "|", e.data?.substring(0,150), "|", e.createdAt);
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());
