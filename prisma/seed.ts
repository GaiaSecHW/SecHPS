import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PERMISSIONS, ROLES, DEFAULT_ROLE_PERMISSIONS } from '../src/types/permissions';
import { generateId } from '../src/lib/id-generator';

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
        id: generateId('perm'),
        name: value,
        module,
        action,
        updatedAt: new Date(),
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
        id: generateId('role'),
        name: value,
        description: `${value} role`,
        isSystem: true,
        updatedAt: new Date(),
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
  const adminPassword = process.env.ADMIN_SEED_PASSWORD ||
    require('crypto').randomBytes(12).toString('base64').slice(0, 16);
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // 使用 upsert 避免唯一约束冲突 - 使用 username 作为唯一键
  const adminUsername = 'admin';
  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: {},
    create: {
      id: generateId('user'),
      email: adminEmail,
      username: adminUsername,
      passwordHash,
      name: 'Administrator',
      tenantId: null,  // 平台管理员无租户
      isActive: true,
      updatedAt: new Date(),
    },
  });

  // 分配 admin 角色
  const adminRole = createdRoles[ROLES.ADMIN];
  if (adminRole) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: { userId: admin.id, roleId: adminRole.id }
      },
      update: {},
      create: {
        id: generateId('ur'),
        userId: admin.id,
        roleId: adminRole.id,
      },
    });
  }

  // 创建默认 AI4WEB 配置
  await prisma.opencodeConfig.upsert({
    where: { id: admin.id + '-config' },
    update: {},
    create: {
      id: generateId('cfg'),
      name: 'Default',
      baseURL: 'http://localhost:54321',
      description: 'Default AI4WEB configuration',
      isActive: true,
      updatedAt: new Date(),
      User: {
        connect: { id: admin.id },
      },
    },
  });

  console.log('✅ 测试管理员账户已存在/已创建');
  console.log(`   邮箱: ${adminEmail}`);
  console.log(`   用户名: admin`);
  console.log(`   租户: 无 (平台管理员)`);

  // 5. 创建默认期望输出模板
  console.log('📝 创建默认期望输出模板...');
  const expectedOutputTemplates = [
    {
      id: generateId('eot'),
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
      updatedAt: new Date(),
    },
    {
      id: generateId('eot'),
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
      updatedAt: new Date(),
    },
    {
      id: generateId('eot'),
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
      updatedAt: new Date(),
    },
    {
      id: generateId('eot'),
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
      updatedAt: new Date(),
    },
    {
      id: generateId('eot'),
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
      updatedAt: new Date(),
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

  // 8. 创建 FSM 模板
  console.log('📋 创建 FSM 模板...');
  
  // 威胁建模模板的默认角色
  const THREAT_MODELING_DEFAULT_ROLES = JSON.stringify([
    { id: 'role-analyst', name: '分析师', description: '负责系统理解和安全评估', color: '#3B82F6', order: 1 },
    { id: 'role-threat-analyst', name: '威胁分析师', description: '负责STRIDE威胁分析', color: '#F59E0B', order: 2 },
    { id: 'role-penetration', name: '渗透测试师', description: '负责渗透测试执行', color: '#EF4444', order: 3 },
    { id: 'role-reporter', name: '报告生成师', description: '负责生成威胁建模报告', color: '#10B981', order: 4 }
  ]);
  
  // 固定流程：P1 → P2 → P3 → P4 → P5 → 渗透测试 → P6
  // 每个 P 阶段单独一个节点，各自配置角色
  const THREAT_MODELING_NODES = JSON.stringify([
    {
      id: 'fsm-node-p1',
      label: 'P1-项目理解',
      phase: 'P1',
      fsmPhase: 1,
      fsmFixed: true,
      fsmOrder: 1,
      skillPath: 'threat-modeling/phases/P1-PROJECT-UNDERSTANDING.md',
      description: '理解项目结构、技术栈、模块划分、入口点',
      roleId: 'role-analyst'
    },
    {
      id: 'fsm-node-p2',
      label: 'P2-DFD分析',
      phase: 'P2',
      fsmPhase: 2,
      fsmFixed: true,
      fsmOrder: 2,
      skillPath: 'threat-modeling/phases/P2-DFD-ANALYSIS.md',
      description: '绘制数据流图(DFD)，识别数据流向和存储',
      roleId: 'role-analyst'
    },
    {
      id: 'fsm-node-p3',
      label: 'P3-信任边界',
      phase: 'P3',
      fsmPhase: 3,
      fsmFixed: true,
      fsmOrder: 3,
      skillPath: 'threat-modeling/phases/P3-TRUST-BOUNDARY.md',
      description: '定义信任边界，识别跨边界数据流',
      roleId: 'role-analyst'
    },
    {
      id: 'fsm-node-p4',
      label: 'P4-安全设计评审',
      phase: 'P4',
      fsmPhase: 4,
      fsmFixed: true,
      fsmOrder: 4,
      skillPath: 'threat-modeling/phases/P4-SECURITY-DESIGN-REVIEW.md',
      description: '安全设计评审，识别安全缺口',
      roleId: 'role-analyst'
    },
    {
      id: 'fsm-node-p5',
      label: 'P5-STRIDE分析',
      phase: 'P5',
      fsmPhase: 5,
      fsmFixed: true,
      fsmOrder: 5,
      skillPath: 'threat-modeling/phases/P5-STRIDE-ANALYSIS.md',
      description: 'STRIDE威胁分析，识别潜在威胁',
      roleId: 'role-threat-analyst'
    },
    {
      id: 'fsm-node-penetration',
      label: '渗透测试',
      phase: null,
      fsmPhase: 6,
      fsmFixed: false,  // 用户自由编排区
      fsmOrder: 6,
      skillPath: null,
      description: '用户自定义渗透测试Agent（自由编排）',
      roleId: 'role-penetration'
    },
    {
      id: 'fsm-node-p6',
      label: 'P6-报告生成',
      phase: 'P6',
      fsmPhase: 7,
      fsmFixed: true,
      fsmOrder: 7,
      skillPath: 'threat-modeling/phases/P6-REPORT-GENERATION.md',
      description: '生成完整威胁建模报告',
      roleId: 'role-reporter'
    }
  ]);

  const THREAT_MODELING_AGENT_ZONE = JSON.stringify({
    position: 6,  // 渗透测试阶段 (fsmPhase=6)
    allowAdd: true,
    allowDelete: true,
    allowReorder: true,
    parallel: true,
    defaultAgents: [
      { id: 'sast-agent', name: 'SAST Agent', tool: 'Semgrep', output: 'vulnerabilities/sast-report.json' },
      { id: 'secret-scanner', name: 'Secret Scanner', tool: 'truffleHog', output: 'vulnerabilities/secrets-report.json' },
      { id: 'dep-scanner', name: 'Dependency Scanner', tool: 'Snyk', output: 'vulnerabilities/dependency-report.json' }
    ]
  });

  await prisma.fSMTemplate.upsert({
    where: { name: 'threat-modeling' },
    update: {
      displayName: '威胁建模分析',
      description: '固定流程：P1(项目理解) → P2(DFD分析) → P3(信任边界) → P4(安全评审) → P5(STRIDE) → 渗透测试 → P6(报告)',
      nodeCount: 7,
      nodes: THREAT_MODELING_NODES,
      agentZone: THREAT_MODELING_AGENT_ZONE,
      skillPath: 'skills/threat-modeling',
      version: '3.0.0',
      isActive: true,
      isBuiltin: true,
      updatedAt: new Date(),
    },
    create: {
      id: 'threat-modeling',
      name: 'threat-modeling',
      displayName: '威胁建模分析',
      description: '固定流程：P1(项目理解) → P2(DFD分析) → P3(信任边界) → P4(安全评审) → P5(STRIDE) → 渗透测试 → P6(报告)',
      nodeCount: 7,
      nodes: THREAT_MODELING_NODES,
      agentZone: THREAT_MODELING_AGENT_ZONE,
      skillPath: 'skills/threat-modeling',
      version: '3.0.0',
      isActive: true,
      isBuiltin: true,
      updatedAt: new Date(),
    },
  });
  console.log('✅ 已创建 threat-modeling FSM 模板');

  // 创建代码审计模板
  await prisma.fSMTemplate.upsert({
    where: { name: 'code-audit' },
    update: {
      displayName: '代码审计',
      description: '3阶段FSM代码审计工作流',
      nodeCount: 3,
      nodes: JSON.stringify([
        { id: 'fsm-node-1', label: '代码理解', phases: ['P1'], fsmPhase: 1, fsmFixed: true, fsmOrder: 1, description: '代码结构分析' },
        { id: 'fsm-node-2', label: '漏洞扫描', phases: ['P2'], fsmPhase: 2, fsmFixed: true, fsmOrder: 2, description: '静态分析' },
        { id: 'fsm-node-3', label: '报告生成', phases: ['P3'], fsmPhase: 3, fsmFixed: true, fsmOrder: 3, description: '审计报告' }
      ]),
      agentZone: JSON.stringify({ position: 2, allowAdd: true, parallel: true, defaultAgents: [{ id: 'semgrep', name: 'Semgrep', tool: 'Semgrep' }] }),
      skillPath: 'data/skills/code-audit',
      version: '1.0.0',
      isActive: true,
      isBuiltin: true,
      updatedAt: new Date(),
    },
    create: {
      id: 'code-audit',
      name: 'code-audit',
      displayName: '代码审计',
      description: '3阶段FSM代码审计工作流',
      nodeCount: 3,
      nodes: JSON.stringify([
        { id: 'fsm-node-1', label: '代码理解', phases: ['P1'], fsmPhase: 1, fsmFixed: true, fsmOrder: 1, description: '代码结构分析' },
        { id: 'fsm-node-2', label: '漏洞扫描', phases: ['P2'], fsmPhase: 2, fsmFixed: true, fsmOrder: 2, description: '静态分析' },
        { id: 'fsm-node-3', label: '报告生成', phases: ['P3'], fsmPhase: 3, fsmFixed: true, fsmOrder: 3, description: '审计报告' }
      ]),
      agentZone: JSON.stringify({ position: 2, allowAdd: true, parallel: true, defaultAgents: [{ id: 'semgrep', name: 'Semgrep', tool: 'Semgrep' }] }),
      skillPath: 'data/skills/code-audit',
      version: '1.0.0',
      isActive: true,
      isBuiltin: true,
      updatedAt: new Date(),
    },
  });
  console.log('✅ 已创建 code-audit FSM 模板');

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
