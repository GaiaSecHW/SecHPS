const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:e:\\dev.db' } } });

async function check() {
  // 查看权限数量
  const permCount = await prisma.$queryRawUnsafe('SELECT COUNT(*) as count FROM "Permission"');
  console.log('权限数量:', permCount[0].count);
  
  // 查看权限示例
  const perms = await prisma.$queryRawUnsafe('SELECT id, name FROM "Permission" LIMIT 5');
  console.log('权限示例:', perms);
  
  // 查看 _PermissionToRole 总数
  const linkCount = await prisma.$queryRawUnsafe('SELECT COUNT(*) as count FROM "_PermissionToRole"');
  console.log('\n关联表总数:', linkCount[0].count);
  
  // 查看所有关联
  const links = await prisma.$queryRawUnsafe('SELECT * FROM "_PermissionToRole"');
  console.log('所有关联:', links);
  
  await prisma.$disconnect();
}
check();
