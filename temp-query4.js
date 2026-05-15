const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const events = await prisma.codeswarmEvent.findMany({
    where: { taskId: "task-1778747679930-cptp3lnw" },
    orderBy: { createdAt: "asc" }
  });
  console.log("Found", events.length, "events for task-1778747679930-cptp3lnw");
  events.forEach(e => console.log(e.type, "|", e.createdAt));
}
main().catch(console.error).finally(() => prisma.$disconnect());
