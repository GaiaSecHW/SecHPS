const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. 获取第一个管理员用户
  let admin = await prisma.user.findFirst({
    where: {
      userRoles: {
        some: {
          role: {
            name: 'admin',
          },
        },
      },
    },
  });

  if (!admin) {
    console.log('未找到管理员用户，尝试获取第一个用户');
    admin = await prisma.user.findFirst();
    if (!admin) {
      console.error('数据库中没有用户，请先创建用户');
      return;
    }
  }

  console.log(`将使用用户: ${admin.username || admin.id} (${admin.id}) 作为现有 MCP 的拥有者`);

  // 2. 用原始 SQL 更新（因为 Prisma 客户端还没有 isShared 字段）
  await prisma.$executeRawUnsafe(
    `UPDATE McpServerConfig SET userId = '${admin.id}' WHERE userId IS NULL`
  );
  console.log('已更新 userId 为 null 的 MCP 配置');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());