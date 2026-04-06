import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// 权限常量
const PERMISSIONS = {
  // 会话权限
  SESSION_CREATE: 'session:create',
  SESSION_READ: 'session:read',
  SESSION_UPDATE: 'session:update',
  SESSION_DELETE: 'session:delete',
  SESSION_SHARE: 'session:share',
  SESSION_REVERT: 'session:revert',

  // 用户管理权限
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_ASSIGN_ROLE: 'user:assign_role',

  // 角色管理权限
  ROLE_CREATE: 'role:create',
  ROLE_READ: 'role:read',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',
  ROLE_ASSIGN_PERMISSION: 'role:assign_permission',

  // 权限管理权限
  PERMISSION_CREATE: 'permission:create',
  PERMISSION_READ: 'permission:read',
  PERMISSION_UPDATE: 'permission:update',
  PERMISSION_DELETE: 'permission:delete',

  // 配置管理权限
  CONFIG_READ: 'config:read',
  CONFIG_UPDATE: 'config:update',
  CONFIG_DELETE: 'config:delete',

  // 搜索权限
  SEARCH_FILE: 'search:file',
  SEARCH_SYMBOL: 'search:symbol',
  SEARCH_TEXT: 'search:text',

  // 文件操作权限
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',

  // 审计日志权限
  AUDIT_READ: 'audit:read',

  // 工作流权限
  WORKFLOW_CREATE: 'workflow:create',
  WORKFLOW_READ: 'workflow:read',
  WORKFLOW_UPDATE: 'workflow:update',
  WORKFLOW_DELETE: 'workflow:delete',
  WORKFLOW_SHARE: 'workflow:share',
  WORKFLOW_EXECUTE: 'workflow:execute',
  WORKFLOW_EXPORT: 'workflow:export',
  WORKFLOW_IMPORT: 'workflow:import',

  // 插件权限
  PLUGIN_CREATE: 'plugin:create',
  PLUGIN_READ: 'plugin:read',
  PLUGIN_UPDATE: 'plugin:update',
  PLUGIN_DELETE: 'plugin:delete',
  PLUGIN_TOGGLE: 'plugin:toggle',
  PLUGIN_EXECUTE: 'plugin:execute',
};

// 角色常量
const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  VIEWER: 'viewer',
  DEVELOPER: 'developer',
  MANAGER: 'manager',
};

// 默认角色权限映射
const DEFAULT_ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: Object.values(PERMISSIONS), // 管理员拥有所有权限

  [ROLES.MANAGER]: [
    PERMISSIONS.SESSION_CREATE,
    PERMISSIONS.SESSION_READ,
    PERMISSIONS.SESSION_UPDATE,
    PERMISSIONS.SESSION_DELETE,
    PERMISSIONS.SESSION_SHARE,
    PERMISSIONS.SESSION_REVERT,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.ROLE_READ,
    PERMISSIONS.CONFIG_READ,
    PERMISSIONS.CONFIG_UPDATE,
    PERMISSIONS.SEARCH_FILE,
    PERMISSIONS.SEARCH_SYMBOL,
    PERMISSIONS.SEARCH_TEXT,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_WRITE,
    PERMISSIONS.AUDIT_READ,
    // 工作流权限
    PERMISSIONS.WORKFLOW_CREATE,
    PERMISSIONS.WORKFLOW_READ,
    PERMISSIONS.WORKFLOW_UPDATE,
    PERMISSIONS.WORKFLOW_DELETE,
    PERMISSIONS.WORKFLOW_SHARE,
    PERMISSIONS.WORKFLOW_EXECUTE,
    PERMISSIONS.WORKFLOW_EXPORT,
    PERMISSIONS.WORKFLOW_IMPORT,
    // 插件权限
    PERMISSIONS.PLUGIN_CREATE,
    PERMISSIONS.PLUGIN_READ,
    PERMISSIONS.PLUGIN_UPDATE,
    PERMISSIONS.PLUGIN_DELETE,
    PERMISSIONS.PLUGIN_TOGGLE,
    PERMISSIONS.PLUGIN_EXECUTE,
  ],

  [ROLES.DEVELOPER]: [
    PERMISSIONS.SESSION_CREATE,
    PERMISSIONS.SESSION_READ,
    PERMISSIONS.SESSION_UPDATE,
    PERMISSIONS.SESSION_SHARE,
    PERMISSIONS.SEARCH_FILE,
    PERMISSIONS.SEARCH_SYMBOL,
    PERMISSIONS.SEARCH_TEXT,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.CONFIG_READ,
    // 工作流权限
    PERMISSIONS.WORKFLOW_CREATE,
    PERMISSIONS.WORKFLOW_READ,
    PERMISSIONS.WORKFLOW_UPDATE,
    PERMISSIONS.WORKFLOW_EXECUTE,
    PERMISSIONS.WORKFLOW_EXPORT,
    PERMISSIONS.WORKFLOW_IMPORT,
  ],

  [ROLES.USER]: [
    PERMISSIONS.SESSION_CREATE,
    PERMISSIONS.SESSION_READ,
    PERMISSIONS.SESSION_UPDATE,
    PERMISSIONS.SEARCH_FILE,
    PERMISSIONS.SEARCH_SYMBOL,
    PERMISSIONS.SEARCH_TEXT,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.CONFIG_READ,
    // 工作流权限
    PERMISSIONS.WORKFLOW_CREATE,
    PERMISSIONS.WORKFLOW_READ,
    PERMISSIONS.WORKFLOW_EXECUTE,
  ],

  [ROLES.VIEWER]: [
    PERMISSIONS.SESSION_READ,
    PERMISSIONS.SEARCH_FILE,
    PERMISSIONS.SEARCH_SYMBOL,
    PERMISSIONS.SEARCH_TEXT,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.CONFIG_READ,
    // 工作流权限
    PERMISSIONS.WORKFLOW_READ,
  ],
};

async function main() {
  console.log('🌱 开始数据库初始化...');

  // 1. 创建所有权限
  console.log('📋 创建权限...');
  for (const [key, value] of Object.entries(PERMISSIONS)) {
    const [module, action] = value.split(':');
    await prisma.permission.upsert({
      where: { name: value },
      update: {},
      create: {
        name: value,
        module,
        action,
      },
    });
  }
  console.log(`✅ 已创建 ${Object.keys(PERMISSIONS).length} 个权限`);

  // 2. 创建所有角色
  console.log('👥 创建角色...');
  const createdRoles: Record<string, any> = {};
  for (const [key, value] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { name: value },
      update: {},
      create: {
        name: value,
        description: `${value} role`,
        isSystem: true,
      },
    });
    createdRoles[value] = role;
  }
  console.log(`✅ 已创建 ${Object.keys(ROLES).length} 个角色`);

  // 3. 为角色分配权限
  console.log('🔗 分配权限到角色...');
  for (const [roleName, permissionNames] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const role = createdRoles[roleName];
    if (!role) continue;

    console.log(`  为角色 ${roleName} 分配权限...`);
    for (const permissionName of permissionNames) {
      const permission = await prisma.permission.findUnique({
        where: { name: permissionName },
      });

      if (permission) {
        // 使用 Prisma API 创建关系
        try {
          await prisma.role.update({
            where: { id: role.id },
            data: {
              permissions: {
                connect: { id: permission.id },
              },
            },
          });
        } catch (error) {
          // 忽略已存在的关系
          // @ts-ignore
          if (error.code !== 'P2009') {
            throw error;
          }
        }
      } else {
        console.log(`    ⚠️  权限 ${permissionName} 不存在`);
      }
    }
    
    // 验证权限分配
    const roleWithPermissions = await prisma.role.findUnique({
      where: { id: role.id },
      include: { permissions: true },
    });
    console.log(`  ✅ 角色 ${roleName} 已分配 ${roleWithPermissions?.permissions.length || 0} 个权限`);
  }
  console.log('✅ 权限分配完成');

  // 4. 创建测试管理员账户（如果不存在）
  console.log('👤 创建测试管理员账户...');
  const adminEmail = 'admin@ai4web.com';
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        username: 'admin',
        passwordHash,
        name: 'Administrator',
        isActive: true,
      },
    });

    // 分配 admin 角色
    const adminRole = createdRoles[ROLES.ADMIN];
    if (adminRole) {
      await prisma.userRole.create({
        data: {
          userId: admin.id,
          roleId: adminRole.id,
        },
      });
    }

    // 创建默认 AI4WEB 配置
    await prisma.opencodeConfig.create({
      data: {
        userId: admin.id,
        name: 'Default',
        baseURL: 'http://localhost:54321',
        description: 'Default AI4WEB configuration',
        isActive: true,
      },
    });

    console.log('✅ 测试管理员账户已创建');
    console.log(`   邮箱: ${adminEmail}`);
    console.log(`   密码: admin123`);
  } else {
    console.log('ℹ️  测试管理员账户已存在');
  }

  console.log('🎉 数据库初始化完成！');
}

main()
  .catch((e) => {
    console.error('❌ 初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
