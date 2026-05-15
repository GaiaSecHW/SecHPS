const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const task = await prisma.codeswarmTask.findUnique({
    where: { taskId: "task-1778748123839-m54xr5og" }
  });
  console.log("Task state:", task?.state);
  console.log("Worker:", task?.workerId);
  console.log("Instruction:", task?.instruction);
}
main().catch(console.error).finally(() => prisma.$disconnect());
