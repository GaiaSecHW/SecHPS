// 手动添加插件权限到数据库
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 开始添加插件权限...');

  // 1. 创建插件权限
  const pluginPermissions = [
    { name: 'plugin:create', module: 'plugin', action: 'create' },
    { name: 'plugin:read', module: 'plugin', action: 'read' },
    { name: 'plugin:update', module: 'plugin', action: 'update' },
    { name: 'plugin:delete', module: 'plugin', action: 'delete' },
    { name: 'plugin:toggle', module: 'plugin', action: 'toggle' },
  ];

  for (const perm of pluginPermissions) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
    console.log(`✅ 创建权限: ${perm.name}`);
  }

  // 2. 获取 admin 角色
  const adminRole = await prisma.role.findUnique({
    where: { name: 'admin' },
  });

  if (!adminRole) {
    console.error('❌ 未找到 admin 角色');
    return;
  }

  // 3. 为 admin 角色添加插件权限
  for (const permName of pluginPermissions.map(p => p.name)) {
    const permission = await prisma.permission.findUnique({
      where: { name: permName },
    });

    if (permission) {
      // 检查是否已存在
      const existing = await prisma.$queryRaw`
        SELECT * FROM "_RoleToPermission" 
        WHERE "A" = ${adminRole.id} AND "B" = ${permission.id}
      `;
      
      if (!existing || (existing as any[]).length === 0) {
        await prisma.$executeRaw`
          INSERT INTO "_RoleToPermission" ("A", "B")
          VALUES (${adminRole.id}, ${permission.id})
        `;
        console.log(`✅ 为 admin 角色添加权限: ${permName}`);
      } else {
        console.log(`⏭️  admin 角色已有权限: ${permName}`);
      }
    }
  }

  // 4. 获取 manager 角色
  const managerRole = await prisma.role.findUnique({
    where: { name: 'manager' },
  });

  if (managerRole) {
    // 为 manager 角色添加插件权限
    for (const permName of pluginPermissions.map(p => p.name)) {
      const permission = await prisma.permission.findUnique({
        where: { name: permName },
      });

      if (permission) {
        // 检查是否已存在
        const existing = await prisma.$queryRaw`
          SELECT * FROM "_RoleToPermission" 
          WHERE "A" = ${managerRole.id} AND "B" = ${permission.id}
        `;
        
        if (!existing || (existing as any[]).length === 0) {
          await prisma.$executeRaw`
            INSERT INTO "_RoleToPermission" ("A", "B")
            VALUES (${managerRole.id}, ${permission.id})
          `;
          console.log(`✅ 为 manager 角色添加权限: ${permName}`);
        } else {
          console.log(`⏭️  manager 角色已有权限: ${permName}`);
        }
      }
    }
  }

  console.log('✅ 权限添加完成！');
  console.log('\n⚠️  请重新登录以获取最新权限');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
