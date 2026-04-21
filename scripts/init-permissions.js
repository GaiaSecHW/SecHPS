/**
 * 初始化生产环境权限 v3
 * 
 * 修复：不使用外键约束创建表，避免关联失败
 */

const { PrismaClient } = require('@prisma/client');

const PROD_DB_PATH = '/home/web/data/dev3.db';

const prisma = new PrismaClient({
  datasources: { db: { url: `file:${PROD_DB_PATH}` } }
});

// ============================================
// 完整权限定义
// ============================================

const PERMISSIONS = [
  // 会话管理
  { name: 'session:create', module: 'session', action: 'create', description: '创建会话' },
  { name: 'session:read', module: 'session', action: 'read', description: '查看会话' },
  { name: 'session:update', module: 'session', action: 'update', description: '更新会话' },
  { name: 'session:delete', module: 'session', action: 'delete', description: '删除会话' },
  { name: 'session:share', module: 'session', action: 'share', description: '分享会话' },
  { name: 'session:revert', module: 'session', action: 'revert', description: '回退会话' },
  
  // 用户管理
  { name: 'user:create', module: 'user', action: 'create', description: '创建用户' },
  { name: 'user:read', module: 'user', action: 'read', description: '查看用户' },
  { name: 'user:update', module: 'user', action: 'update', description: '更新用户' },
  { name: 'user:delete', module: 'user', action: 'delete', description: '删除用户' },
  { name: 'user:assign_role', module: 'user', action: 'assign_role', description: '分配角色' },
  
  // 角色管理
  { name: 'role:create', module: 'role', action: 'create', description: '创建角色' },
  { name: 'role:read', module: 'role', action: 'read', description: '查看角色' },
  { name: 'role:update', module: 'role', action: 'update', description: '更新角色' },
  { name: 'role:delete', module: 'role', action: 'delete', description: '删除角色' },
  { name: 'role:assign_permission', module: 'role', action: 'assign_permission', description: '分配权限' },
  
  // 权限管理
  { name: 'permission:create', module: 'permission', action: 'create', description: '创建权限' },
  { name: 'permission:read', module: 'permission', action: 'read', description: '查看权限' },
  { name: 'permission:update', module: 'permission', action: 'update', description: '更新权限' },
  { name: 'permission:delete', module: 'permission', action: 'delete', description: '删除权限' },
  
  // 项目管理
  { name: 'project:create', module: 'project', action: 'create', description: '创建项目' },
  { name: 'project:read', module: 'project', action: 'read', description: '查看项目' },
  { name: 'project:update', module: 'project', action: 'update', description: '更新项目' },
  { name: 'project:delete', module: 'project', action: 'delete', description: '删除项目' },
  
  // 工作流管理
  { name: 'workflow:create', module: 'workflow', action: 'create', description: '创建工作流' },
  { name: 'workflow:read', module: 'workflow', action: 'read', description: '查看工作流' },
  { name: 'workflow:update', module: 'workflow', action: 'update', description: '更新工作流' },
  { name: 'workflow:delete', module: 'workflow', action: 'delete', description: '删除工作流' },
  { name: 'workflow:execute', module: 'workflow', action: 'execute', description: '执行工作流' },
  { name: 'workflow:share', module: 'workflow', action: 'share', description: '分享工作流' },
  
  // 技能管理
  { name: 'skill:create', module: 'skill', action: 'create', description: '创建技能' },
  { name: 'skill:read', module: 'skill', action: 'read', description: '查看技能' },
  { name: 'skill:update', module: 'skill', action: 'update', description: '更新技能' },
  { name: 'skill:delete', module: 'skill', action: 'delete', description: '删除技能' },
  { name: 'skill:execute', module: 'skill', action: 'execute', description: '执行技能' },
  { name: 'skill:merge', module: 'skill', action: 'merge', description: '合并技能' },
  { name: 'skill:approve', module: 'skill', action: 'approve', description: '审批技能' },
  
  // MCP服务器管理
  { name: 'mcp:create', module: 'mcp', action: 'create', description: '创建MCP服务器' },
  { name: 'mcp:read', module: 'mcp', action: 'read', description: '查看MCP服务器' },
  { name: 'mcp:update', module: 'mcp', action: 'update', description: '更新MCP服务器' },
  { name: 'mcp:delete', module: 'mcp', action: 'delete', description: '删除MCP服务器' },
  
  // 模型管理
  { name: 'model:create', module: 'model', action: 'create', description: '创建模型配置' },
  { name: 'model:read', module: 'model', action: 'read', description: '查看模型配置' },
  { name: 'model:update', module: 'model', action: 'update', description: '更新模型配置' },
  { name: 'model:delete', module: 'model', action: 'delete', description: '删除模型配置' },
  { name: 'model:test', module: 'model', action: 'test', description: '测试模型配置' },
  
  // 漏洞管理
  { name: 'vulnerability:create', module: 'vulnerability', action: 'create', description: '创建漏洞' },
  { name: 'vulnerability:read', module: 'vulnerability', action: 'read', description: '查看漏洞' },
  { name: 'vulnerability:update', module: 'vulnerability', action: 'update', description: '更新漏洞状态' },
  { name: 'vulnerability:delete', module: 'vulnerability', action: 'delete', description: '删除漏洞' },
  
  // 评估管理
  { name: 'evaluation:create', module: 'evaluation', action: 'create', description: '创建评估' },
  { name: 'evaluation:read', module: 'evaluation', action: 'read', description: '查看评估' },
  { name: 'evaluation:update', module: 'evaluation', action: 'update', description: '更新评估' },
  { name: 'evaluation:delete', module: 'evaluation', action: 'delete', description: '删除评估' },
  
  // 审计日志
  { name: 'audit:read', module: 'audit', action: 'read', description: '查看审计日志' },
  
  // 系统配置
  { name: 'config:read', module: 'config', action: 'read', description: '查看配置' },
  { name: 'config:update', module: 'config', action: 'update', description: '更新配置' },
  { name: 'config:delete', module: 'config', action: 'delete', description: '删除配置' },
  
  // 搜索权限
  { name: 'search:file', module: 'search', action: 'file', description: '搜索文件' },
  { name: 'search:symbol', module: 'search', action: 'symbol', description: '搜索符号' },
  { name: 'search:text', module: 'search', action: 'text', description: '搜索文本' },
  
  // 文件权限
  { name: 'file:read', module: 'file', action: 'read', description: '读取文件' },
  { name: 'file:write', module: 'file', action: 'write', description: '写入文件' },
  
  // Token统计
  { name: 'token:read', module: 'token', action: 'read', description: '查看Token统计' },
  { name: 'token:detail', module: 'token', action: 'detail', description: '查看Token详情' },
  
  // 插件管理
  { name: 'plugin:create', module: 'plugin', action: 'create', description: '创建插件' },
  { name: 'plugin:read', module: 'plugin', action: 'read', description: '查看插件' },
  { name: 'plugin:update', module: 'plugin', action: 'update', description: '更新插件' },
  { name: 'plugin:delete', module: 'plugin', action: 'delete', description: '删除插件' },
  { name: 'plugin:toggle', module: 'plugin', action: 'toggle', description: '切换插件状态' },
  { name: 'plugin:execute', module: 'plugin', action: 'execute', description: '执行插件' },
  
  // Agent权限
  { name: 'agent:chat', module: 'agent', action: 'chat', description: 'Agent聊天' },
  { name: 'agent:execute', module: 'agent', action: 'execute', description: 'Agent执行' },
  { name: 'agent:read', module: 'agent', action: 'read', description: 'Agent读取' },
  
  // Agent定义
  { name: 'agent-definition:create', module: 'agent-definition', action: 'create', description: '创建Agent定义' },
  { name: 'agent-definition:read', module: 'agent-definition', action: 'read', description: '查看Agent定义' },
  { name: 'agent-definition:update', module: 'agent-definition', action: 'update', description: '更新Agent定义' },
  { name: 'agent-definition:delete', module: 'agent-definition', action: 'delete', description: '删除Agent定义' },
  
  // Agent团队
  { name: 'agent-team:create', module: 'agent-team', action: 'create', description: '创建Agent团队' },
  { name: 'agent-team:read', module: 'agent-team', action: 'read', description: '查看Agent团队' },
  { name: 'agent-team:update', module: 'agent-team', action: 'update', description: '更新Agent团队' },
  { name: 'agent-team:delete', module: 'agent-team', action: 'delete', description: '删除Agent团队' },
  { name: 'agent-team:execute', module: 'agent-team', action: 'execute', description: '执行Agent团队' },
  
  // 自主进化
  { name: 'autonomous_evolution:read', module: 'autonomous_evolution', action: 'read', description: '查看自主进化' },
  { name: 'autonomous_evolution:create', module: 'autonomous_evolution', action: 'create', description: '创建自主进化' },
  { name: 'autonomous_evolution:update', module: 'autonomous_evolution', action: 'update', description: '更新自主进化' },
  { name: 'autonomous_evolution:delete', module: 'autonomous_evolution', action: 'delete', description: '删除自主进化' },
  { name: 'autonomous_evolution:extract', module: 'autonomous_evolution', action: 'extract', description: '提取自主进化' },
  { name: 'autonomous_evolution:inject', module: 'autonomous_evolution', action: 'inject', description: '注入自主进化' },
  
  // 代码分析
  { name: 'code:analyze', module: 'code', action: 'analyze', description: '分析代码' },
  { name: 'code:read', module: 'code', action: 'read', description: '读取代码' },
  
  // 通知管理
  { name: 'notification:create', module: 'notification', action: 'create', description: '创建通知' },
  { name: 'notification:read', module: 'notification', action: 'read', description: '查看通知' },
  { name: 'notification:update', module: 'notification', action: 'update', description: '更新通知' },
  { name: 'notification:delete', module: 'notification', action: 'delete', description: '删除通知' },
  
  // Skills治理
  { name: 'skill-governance:read', module: 'skill-governance', action: 'read', description: '查看技能治理' },
  { name: 'skill-governance:update', module: 'skill-governance', action: 'update', description: '更新技能治理' },
  
  // 治理管理
  { name: 'governance:read', module: 'governance', action: 'read', description: '查看治理' },
  { name: 'governance:update', module: 'governance', action: 'update', description: '管理治理' },
];

// 角色权限分配
const ROLE_PERMISSIONS = {
  admin: '*',
  manager: [
    'session:*', 'user:read', 'user:update', 'role:read', 'project:*', 
    'workflow:*', 'skill:*', 'mcp:*', 'model:*', 'vulnerability:*',
    'audit:read', 'config:read', 'token:read'
  ],
  developer: [
    'session:*', 'project:*', 'workflow:*', 'skill:read', 'skill:execute',
    'mcp:read', 'model:read', 'vulnerability:read', 'token:read'
  ],
  user: [
    'session:create', 'session:read', 'session:update', 'session:delete',
    'project:create', 'project:read', 'project:update', 'project:delete',
    'workflow:create', 'workflow:read', 'workflow:update', 'workflow:execute',
    'skill:read', 'skill:execute', 'mcp:read', 'model:read',
    'vulnerability:read', 'token:read'
  ],
  viewer: [
    'session:read', 'project:read', 'workflow:read', 'skill:read',
    'mcp:read', 'model:read', 'vulnerability:read'
  ]
};

function generateId() {
  return 'c' + Math.random().toString(36).substring(2, 12);
}

async function tableExists(tableName) {
  const result = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`
  );
  return result.length > 0;
}

async function dropTable(tableName) {
  try {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${tableName}"`);
    return true;
  } catch (e) {
    return false;
  }
}

async function main() {
  console.log('================================================');
  console.log('初始化生产环境权限 v3');
  console.log('================================================\n');

  // Step 1: 删除旧表（按依赖顺序，先删除关联表）
  console.log('Step 1: 删除旧表...');
  await dropTable('_PermissionToRole');
  await dropTable('UserRole');
  await dropTable('Permission');
  await dropTable('Role');
  console.log('  ✓ 旧表已删除');

  // Step 2: 创建新表（不带外键约束）
  console.log('\nStep 2: 创建新表...');
  
  // Permission 表
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Permission" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL UNIQUE,
      "description" TEXT,
      "module" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "resource" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  + Permission');
  
  // Role 表
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Role" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL UNIQUE,
      "description" TEXT,
      "isSystem" BOOLEAN NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('  + Role');
  
  // UserRole 表（不带外键）
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "UserRole" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "roleId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE("userId", "roleId")
    )
  `);
  console.log('  + UserRole');
  
  // _PermissionToRole 表（不带外键）
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "_PermissionToRole" (
      "A" TEXT NOT NULL,
      "B" TEXT NOT NULL,
      CONSTRAINT "_PermissionToRole_AB_unique" UNIQUE("A", "B")
    )
  `);
  console.log('  + _PermissionToRole');

  // Step 3: 创建权限
  console.log('\nStep 3: 创建权限...');
  const permissionIds = {};
  const now = new Date().toISOString();
  
  for (const perm of PERMISSIONS) {
    const id = generateId();
    permissionIds[perm.name] = id;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Permission" (id, name, description, module, action, "createdAt", "updatedAt")
       VALUES ('${id}', '${perm.name}', '${perm.description}', '${perm.module}', '${perm.action}', '${now}', '${now}')`
    );
  }
  console.log(`  ✓ 权限: ${PERMISSIONS.length} 个`);

  // Step 4: 创建角色
  console.log('\nStep 4: 创建角色...');
  const roleIds = {};
  const roles = [
    { name: 'admin', description: '系统管理员', isSystem: true },
    { name: 'manager', description: '项目经理', isSystem: true },
    { name: 'developer', description: '开发者', isSystem: true },
    { name: 'user', description: '普通用户', isSystem: true },
    { name: 'viewer', description: '访客', isSystem: true },
  ];
  
  for (const role of roles) {
    const id = generateId();
    roleIds[role.name] = id;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Role" (id, name, description, "isSystem", "createdAt", "updatedAt")
       VALUES ('${id}', '${role.name}', '${role.description}', ${role.isSystem ? 1 : 0}, '${now}', '${now}')`
    );
  }
  console.log(`  ✓ 角色: ${roles.length} 个`);

  // Step 5: 分配角色权限
  console.log('\nStep 5: 分配角色权限...');
  
  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleIds[roleName];
    let count = 0;
    
    if (perms === '*') {
      for (const permId of Object.values(permissionIds)) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "_PermissionToRole" ("A", "B") VALUES ('${roleId}', '${permId}')`
        );
        count++;
      }
    } else {
      for (const permPattern of perms) {
        if (permPattern.includes('*')) {
          const [module] = permPattern.split(':');
          for (const [permName, permId] of Object.entries(permissionIds)) {
            if (permName.startsWith(module + ':')) {
              await prisma.$executeRawUnsafe(
                `INSERT INTO "_PermissionToRole" ("A", "B") VALUES ('${roleId}', '${permId}')`
              );
              count++;
            }
          }
        } else {
          const permId = permissionIds[permPattern];
          if (permId) {
            await prisma.$executeRawUnsafe(
              `INSERT INTO "_PermissionToRole" ("A", "B") VALUES ('${roleId}', '${permId}')`
            );
            count++;
          }
        }
      }
    }
    console.log(`  ${roleName}: ${count} 个权限`);
  }

  // Step 6: 为用户分配角色
  console.log('\nStep 6: 为用户分配角色...');
  
  const users = await prisma.$queryRaw`SELECT id, email, username FROM "User"`;
  
  for (const user of users) {
    const isAdmin = user.email === 'admin@ai4web.com' || 
                    user.email.includes('admin') || 
                    user.username === 'admin' ||
                    (user.username && user.username.includes('admin'));
    
    const roleId = isAdmin ? roleIds.admin : roleIds.user;
    
    await prisma.$executeRawUnsafe(
      `INSERT INTO "UserRole" (id, "userId", "roleId", "createdAt")
       VALUES ('${generateId()}', '${user.id}', '${roleId}', '${now}')`
    );
    console.log(`  + ${user.email} -> ${isAdmin ? 'admin' : 'user'}`);
  }

  // Step 7: 验证
  console.log('\nStep 7: 验证...');
  
  const adminPermCount = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM "_PermissionToRole" WHERE "A" = '${roleIds.admin}'`
  );
  const totalPermCount = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM "Permission"`
  );
  const userRoleCount = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM "UserRole"`
  );
  
  console.log(`  管理员权限: ${adminPermCount[0].count} / 总权限: ${totalPermCount[0].count}`);
  console.log(`  用户角色分配: ${userRoleCount[0].count} 个`);

  console.log('\n================================================');
  console.log('✓ 权限初始化完成！');
  console.log('================================================');
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => {
    console.error('失败:', e);
    prisma.$disconnect();
    process.exit(1);
  });
