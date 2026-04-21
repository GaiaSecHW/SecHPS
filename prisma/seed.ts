import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PERMISSIONS, ROLES, DEFAULT_ROLE_PERMISSIONS } from '../src/types/permissions';

const prisma = new PrismaClient();

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
              Permission: {
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
      include: { Permission: true },
    });
    console.log(`  ✅ 角色 ${roleName} 已分配 ${roleWithPermissions?.Permission?.length || 0} 个权限`);
  }
  console.log('✅ 权限分配完成');

  // 4. 创建测试管理员账户（如果不存在）
  console.log('👤 创建测试管理员账户...');
  const adminEmail = 'admin@ai4web.com';
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    // 使用环境变量或生成随机密码
    const adminPassword = process.env.ADMIN_SEED_PASSWORD || 
      require('crypto').randomBytes(12).toString('base64').slice(0, 16);
    
    const passwordHash = await bcrypt.hash(adminPassword, 10);
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
    if (process.env.ADMIN_SEED_PASSWORD) {
      console.log(`   密码: (使用 ADMIN_SEED_PASSWORD 环境变量)`);
    } else {
      console.log(`   密码: ${adminPassword}`);
      console.log(`   ⚠️  请保存此密码，或使用 ADMIN_SEED_PASSWORD 环境变量设置自定义密码`);
    }
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
