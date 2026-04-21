/**
 * 修复权限关联表 - 纠正 A/B 字段的顺序
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:e:\\dev.db' } } });

async function fix() {
  console.log('=== 修复权限关联表 ===\n');
  
  // 获取所有现有关联
  const existing = await prisma.$queryRawUnsafe('SELECT * FROM "_PermissionToRole"');
  console.log('现有关联数:', existing.length);
  
  // 清空表
  await prisma.$executeRawUnsafe('DELETE FROM "_PermissionToRole"');
  console.log('已清空');
  
  // 重新插入（交换 A 和 B）
  let count = 0;
  for (const row of existing) {
    // A 应该是 RoleID, B 应该是 PermissionID
    // 但现有数据是反的，所以需要交换
    const roleId = row.B;  // 原来存的 B 实际上是 RoleID
    const permId = row.A;  // 原来存的 A 实际上是 PermissionID
    
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_PermissionToRole" ("A", "B") VALUES ('${roleId}', '${permId}')`
    );
    count++;
  }
  
  console.log('重新插入:', count, '条');
  
  // 验证
  const roles = await prisma.$queryRawUnsafe('SELECT id, name FROM "Role"');
  for (const role of roles) {
    const permCount = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM "_PermissionToRole" WHERE "A" = '${role.id}'`
    );
    console.log(`${role.name}: ${permCount[0].count} 个权限`);
  }
  
  await prisma.$disconnect();
  console.log('\n✓ 修复完成');
}

fix();
