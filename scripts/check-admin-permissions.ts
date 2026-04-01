import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 更新 admin 用户权限...');

  // 查找 admin 角色
  const adminRole = await prisma.role.findUnique({
    where: { name: 'admin' },
    include: { permissions: true },
  });

  if (!adminRole) {
    console.error('❌ 未找到 admin 角色');
    return;
  }

  console.log(`✅ admin 角色有 ${adminRole.permissions.length} 个权限`);

  // 查找所有 admin 用户
  const adminUsers = await prisma.user.findMany({
    where: {
      userRoles: {
        some: {
          roleId: adminRole.id,
        },
      },
    },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              permissions: true,
            },
          },
        },
      },
    },
  });

  console.log(`✅ 找到 ${adminUsers.length} 个 admin 用户`);

  for (const user of adminUsers) {
    console.log(`\n👤 用户: ${user.email}`);
    
    // 获取用户所有角色的权限
    const allPermissions = new Set<string>();
    for (const userRole of user.userRoles) {
      for (const perm of userRole.role.permissions) {
        allPermissions.add(perm.name);
      }
    }
    
    console.log(`   当前权限数: ${allPermissions.size}`);
    console.log(`   包含 workflow:create: ${allPermissions.has('workflow:create')}`);
    console.log(`   包含 workflow:read: ${allPermissions.has('workflow:read')}`);
  }

  console.log('\n💡 解决方案：请重新登录以获取新的权限');
  console.log('   或者清除浏览器中的 token 和 user 数据后重新登录');
}

main()
  .catch((e) => {
    console.error('❌ 错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
