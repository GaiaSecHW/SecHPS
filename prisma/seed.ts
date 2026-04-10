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

  // 5. 创建默认期望输出模板
  console.log('📝 创建默认期望输出模板...');
  const expectedOutputTemplates = [
    {
      name: 'security-audit-report',
      displayName: '安全审计报告',
      description: '完整的安全审计报告输出格式，包含漏洞列表、严重性评级、修复建议等',
      category: 'security',
      template: JSON.stringify({
        vulnerabilities: [
          {
            id: 'string',
            title: 'string',
            type: 'string',
            severity: 'critical | high | medium | low | info',
            description: 'string',
            location: {
              file: 'string',
              line: 'number',
              code: 'string'
            },
            fix: {
              suggestion: 'string',
              codeExample: 'string'
            }
          }
        ],
        summary: {
          total: 'number',
          critical: 'number',
          high: 'number',
          medium: 'number',
          low: 'number',
          info: 'number'
        }
      }),
      example: `# 安全审计报告

## 漏洞列表

### 1. SQL注入漏洞 [HIGH]

**位置**: \`src/api/users.ts:45\`

**代码片段**:
\`\`\`typescript
const query = \`SELECT * FROM users WHERE id = \${userId}\`;
\`\`\`

**问题描述**: 直接拼接用户输入到 SQL 查询中，可能导致 SQL 注入攻击。

**修复建议**:
\`\`\`typescript
const query = 'SELECT * FROM users WHERE id = ?';
const result = await db.query(query, [userId]);
\`\`\`

## 摘要统计

- 总计: 5 个漏洞
- 高危: 2 个
- 中危: 2 个
- 低危: 1 个
`,
      isBuiltin: true,
      sortOrder: 1,
    },
    {
      name: 'vulnerability-list',
      displayName: '漏洞列表',
      description: '简洁的漏洞列表格式，适合快速查看',
      category: 'security',
      template: JSON.stringify([
        {
          id: 'string',
          title: 'string',
          severity: 'critical | high | medium | low | info',
          file: 'string',
          line: 'number',
          status: 'new | confirmed | false-positive | fixed'
        }
      ]),
      example: `| ID | 漏洞标题 | 严重性 | 文件 | 行号 | 状态 |
|----|---------|--------|------|------|------|
| VUL-001 | SQL注入 | HIGH | api/users.ts | 45 | new |
| VUL-002 | XSS跨站脚本 | MEDIUM | components/Input.tsx | 23 | confirmed |
`,
      isBuiltin: true,
      sortOrder: 2,
    },
    {
      name: 'code-review-report',
      displayName: '代码审查报告',
      description: '代码审查报告格式，包含代码质量、最佳实践、潜在问题等',
      category: 'code-review',
      template: JSON.stringify({
        issues: [
          {
            id: 'string',
            type: 'bug | security | performance | style | best-practice',
            severity: 'critical | high | medium | low | info',
            title: 'string',
            description: 'string',
            location: {
              file: 'string',
              line: 'number',
              code: 'string'
            },
            suggestion: 'string'
          }
        ],
        score: {
          overall: 'number (0-100)',
          security: 'number',
          performance: 'number',
          maintainability: 'number'
        }
      }),
      example: `# 代码审查报告

## 问题列表

### 1. 未处理的异常 [BUG - MEDIUM]

**位置**: \`src/services/auth.ts:78\`

\`\`\`typescript
const user = await getUser(id); // 可能抛出异常
return user.name; // 未处理异常情况
\`\`\`

**建议**:
\`\`\`typescript
try {
  const user = await getUser(id);
  return user?.name ?? 'Unknown';
} catch (error) {
  logger.error('Failed to get user', { id, error });
  return 'Unknown';
}
\`\`\`

## 代码质量评分

- 总体评分: 78/100
- 安全性: 85/100
- 性能: 72/100
- 可维护性: 80/100
`,
      isBuiltin: true,
      sortOrder: 3,
    },
    {
      name: 'api-audit-report',
      displayName: 'API审计报告',
      description: 'API接口审计报告，包含认证、授权、输入验证等问题',
      category: 'api',
      template: JSON.stringify({
        endpoints: [
          {
            method: 'GET | POST | PUT | DELETE',
            path: 'string',
            issues: [
              {
                type: 'auth | validation | rate-limit | cors',
                severity: 'critical | high | medium | low | info',
                description: 'string',
                recommendation: 'string'
              }
            ]
          }
        ]
      }),
      example: `# API 审计报告

## 端点列表

### POST /api/users

- ⚠️ **MEDIUM**: 缺少速率限制 - 可能遭受暴力破解攻击
- 🔴 **HIGH**: 输入验证不足 - email 字段未验证格式
- ℹ️ **INFO**: 建议添加请求日志记录

### GET /api/users/:id

- ⚠️ **MEDIUM**: 缺少授权检查 - 任何用户可访问其他用户信息
- ✅ 已实现认证中间件
`,
      isBuiltin: true,
      sortOrder: 4,
    },
    {
      name: 'dependency-check',
      displayName: '依赖检查报告',
      description: '第三方依赖安全检查报告',
      category: 'security',
      template: JSON.stringify({
        dependencies: [
          {
            name: 'string',
            version: 'string',
            vulnerabilities: [
              {
                id: 'string (CVE编号)',
                severity: 'critical | high | medium | low',
                description: 'string',
                fixedIn: 'string (修复版本)'
              }
            ]
          }
        ]
      }),
      example: `# 依赖检查报告

## 漏洞依赖

### lodash@4.17.15

- **CVE-2020-8203** [HIGH]: 原型污染漏洞
  - 修复版本: 4.17.19+
  - 描述: 在 merge 函数中存在原型污染风险

### node-fetch@2.6.0

- **CVE-2022-0235** [MEDIUM]: 信息泄露
  - 修复版本: 2.6.7+
  - 描述: 授权头可能在重定向时泄露

## 建议

运行 \`npm audit fix\` 自动修复已知漏洞。
`,
      isBuiltin: true,
      sortOrder: 5,
    },
  ];

  for (const template of expectedOutputTemplates) {
    await prisma.expectedOutputTemplate.upsert({
      where: { name: template.name },
      update: {},
      create: template,
    });
  }
  console.log(`✅ 已创建 ${expectedOutputTemplates.length} 个期望输出模板`);

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
