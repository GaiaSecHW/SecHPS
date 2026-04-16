# AI4WEB 测试平台 - 威胁分析报告

**分析日期**: 2026/04/16  
**项目路径**: D:/claude-web-platform  
**项目类型**: Next.js/TypeScript 项目  
**分析版本**: master分支

---

## 一、项目概述

### 1.1 项目简介

AI4WEB 测试平台是一个基于AI的代码安全审计和漏洞挖掘平台，主要功能包括：

- **AI驱动的代码审计**：使用Claude Agent SDK执行安全扫描
- **漏洞管理**：记录、追踪和管理发现的漏洞
- **工作流编排**：可视化工作流编辑器，用于编排多个Agent任务
- **Skill系统**：可扩展的安全检测技能模块
- **多用户RBAC**：基于角色的访问控制系统

### 1.2 技术栈分析

| 技术组件 | 版本/类型 | 安全评估 |
|---------|----------|---------|
| 框架 | Next.js 16.2.3 | 最新版本，安全 |
| 前端框架 | React 19.2.4 | 最新版本，安全 |
| 数据库 | SQLite (Prisma ORM) | 开发数据库，生产环境建议更换 |
| 认证 | JWT (jsonwebtoken 9.0.2) | 标准实现 |
| 密码哈希 | bcryptjs 2.4.3 | 安全实现 |
| AI集成 | @anthropic-ai/claude-agent-sdk 0.2.92 | 官方SDK |
| WebSocket | ws 8.20.0 | 标准库 |
| HTTP服务 | Fastify 5.4.0 | 独立API服务 |

### 1.3 项目架构

```
claude-web-platform/
├── prisma/                 # 数据库Schema和迁移
│   ├── schema.prisma       # 数据库模型定义
│   └── dev.db              # SQLite开发数据库
├── src/
│   ├── app/
│   │   ├── api/            # Next.js API路由 (60+ API端点)
│   │   └── (pages)/        # 页面组件
│   ├── lib/                # 核心库
│   │   ├── auth.ts         # 认证模块
│   │   ├── permissions.ts  # 权限检查
│   │   ├── audit/          # 审计日志
│   │   ├── claude-router/  # AI模型路由
│   │   └── websocket-server.ts
│   ├── services/           # 业务服务
│   └── types/              # TypeScript类型定义
└── workspace/              # 工作目录
```

---

## 二、业务模块分析

### 2.1 核心业务模块

| 模块 | 功能描述 | API数量 | 安全等级 |
|------|---------|--------|---------|
| 认证模块 | 用户登录、注册 | 2 | 中等 |
| 项目管理 | 项目CRUD、文件管理 | 15+ | 高风险 |
| 评估会话 | AI评估执行、结果管理 | 12+ | 高风险 |
| 工作流 | 可视化编排、执行 | 10+ | 中等 |
| Skill系统 | 安全检测技能 | 8+ | 中等 |
| 漏洞管理 | 漏洞记录、追踪 | 6+ | 中等 |
| 管理后台 | 系统配置、模型管理 | 15+ | 高风险 |
| 代理服务 | AI模型代理 | 1 | 极高风险 |

### 2.2 数据模型分析

#### 用户与权限模型

```
User (用户)
  ├── UserRole (用户-角色关联)
  │     └── Role (角色)
  │           └── Permission (权限)
  └── OpencodeConfig (配置)
```

**安全发现**：
- RBAC系统设计完整
- 支持多角色、多权限
- 权限粒度较细（按模块和操作划分）
- 但API层实现不一致，部分API缺少权限检查

#### 项目与评估模型

```
Project (项目)
  ├── ProjectFile (项目文件)
  ├── EvaluationSession (评估会话)
  │     ├── SessionMessage (会话消息)
  │     ├── NodeExecution (节点执行)
  │     └── TokenUsage (Token使用)
  ├── Vulnerability (漏洞记录)
  └── ToolPermission (工具权限)
```

**敏感字段**：
- `Project.adminPassword` - 管理员密码
- `Project.normalPassword` - 普通用户密码
- `ModelConfig.apiKey` - AI模型API密钥
- `McpServerConfig.apiKey` - MCP服务密钥

---

## 三、API接口安全分析

### 3.1 认证机制分析

#### 登录API (`/api/auth/login`)

```typescript
// 认证流程
1. 验证用户名和密码非空
2. 查询用户记录
3. bcrypt验证密码
4. 检查账户是否激活
5. 获取用户权限
6. 生成JWT Token
7. 记录审计日志
```

**安全评估**：
- 密码使用bcrypt哈希（10轮）
- 返回错误信息统一（防止用户枚举）
- 有审计日志记录
- **问题**：没有登录失败次数限制（暴力破解风险）

#### 注册API (`/api/auth/register`)

```typescript
// 注册流程
1. 验证用户名和密码非空
2. 检查用户名唯一性
3. 检查邮箱唯一性（可选）
4. bcrypt哈希密码
5. 创建用户并分配默认角色
```

**安全评估**：
- 有输入验证
- 密码安全哈希
- **问题**：没有密码复杂度要求
- **问题**：没有邮箱验证机制
- **问题**：默认分配USER角色（正常）

### 3.2 高危API分析

#### 3.2.1 Claude代理API (`/api/claude-proxy/[...path]/route.ts`)

**风险等级**: 极高 (Critical)

```typescript
// 问题代码片段
export async function POST(request: NextRequest) {
  // CCR 是内部服务，不需要认证  <-- 严重问题！
  const body = await request.json();
  const isStream = body.stream === true;
  // 直接转发请求到AI模型
}
```

**安全问题**：
1. **无认证检查**：任何人都可以调用此API
2. **API Key泄露风险**：调用时会使用存储的API Key
3. **资源滥用风险**：恶意用户可以消耗AI资源
4. **CORS配置宽松**：`Access-Control-Allow-Origin: '*'`

**攻击场景**：
- 攻击者可直接调用API消耗AI资源
- 可能导致API Key配额耗尽
- 可能产生高额费用

**修复建议**：
1. 添加JWT认证检查
2. 添加IP白名单限制
3. 实施请求速率限制
4. 记录所有调用的审计日志

#### 3.2.2 项目管理API (`/api/projects/[id]/route.ts`)

**风险等级**: 高 (High)

```typescript
// GET方法 - 缺少权限和归属检查
export async function GET(request: Request, { params }) {
  const payload = verifyToken(token);
  // 没有检查用户是否有权限访问此项目
  // 没有检查项目是否属于该用户
  const project = await prisma.project.findUnique({ where: { id } });
  return NextResponse.json({ project });
}

// PATCH方法 - 可以更新敏感字段
export async function PATCH(request: Request, { params }) {
  const updateData: any = {};
  // 允许更新密码字段！
  if (body.adminPassword !== undefined) updateData.adminPassword = body.adminPassword;
  if (body.normalPassword !== undefined) updateData.normalPassword = body.normalPassword;
  const project = await prisma.project.update({ where: { id }, data: updateData });
}
```

**安全问题**：
1. **缺少权限检查**：没有验证PROJECT_READ/UPDATE/DELETE权限
2. **缺少归属检查**：任何认证用户都可以访问/修改/删除任意项目
3. **敏感字段可更新**：可以修改项目的管理员密码
4. **横向越权风险**：用户可以访问其他用户的项目

**修复建议**：
```typescript
// 添加归属检查
const project = await prisma.project.findUnique({ where: { id } });
if (project.userId !== payload.userId) {
  if (!payload.roles.includes('admin')) {
    return NextResponse.json({ error: '禁止访问' }, { status: 403 });
  }
}

// 添加权限检查
if (!hasPermission(payload.permissions, PERMISSIONS.PROJECT_READ)) {
  return NextResponse.json({ error: '禁止访问' }, { status: 403 });
}
```

#### 3.2.3 评估会话API (`/api/evaluations/[id]/route.ts`)

**风险等级**: 高 (High)

```typescript
// GET方法 - 缺少权限检查
export async function GET(request: Request, { params }) {
  const payload = verifyToken(token);
  // 没有权限检查
  // 没有归属检查
  const evaluation = await prisma.evaluationSession.findUnique({ where: { id } });
  return NextResponse.json({ evaluation });
}

// DELETE方法 - 任何用户都可以删除任意评估会话
export async function DELETE(request: Request, { params }) {
  const payload = verifyToken(token);
  // 没有检查用户是否有权限删除此评估
  await prisma.evaluationSession.delete({ where: { id } });
}
```

**安全问题**：
1. **缺少权限检查**：没有验证EVALUATION_READ/DELETE权限
2. **缺少归属检查**：任何认证用户都可以访问/删除任意评估会话
3. **数据泄露风险**：可以查看其他用户的评估结果

#### 3.2.4 模型配置API (`/api/admin/models/route.ts`)

**风险等级**: 高 (High)

```typescript
// GET方法 - 返回API Key明文
export async function GET(request: Request) {
  const models = await prisma.modelConfig.findMany();
  const formattedModels = models.map(model => ({
    // ... 其他字段
    apiKey: model.apiKey,  // 直接返回API Key！
  }));
  return NextResponse.json({ models: formattedModels });
}
```

**安全问题**：
1. **API Key明文返回**：任何有MODEL_READ权限的用户都可以看到API Key
2. **API Key明文存储**：数据库中直接存储明文API Key
3. **敏感信息泄露风险**：前端可能记录或显示API Key

**修复建议**：
```typescript
// 返回时脱敏API Key
const formattedModels = models.map(model => ({
  // ... 其他字段
  apiKey: model.apiKey ? `${model.apiKey.slice(0, 8)}...${model.apiKey.slice(-4)}` : null,
}));
```

### 3.3 中危API分析

#### 3.3.1 文件上传API (`/api/projects/[id]/files/route.ts`)

**风险等级**: 中 (Medium)

```typescript
export async function POST(request: Request, { params }) {
  const payload = verifyToken(token);
  // 缺少权限检查
  // 缺少项目归属检查
  const formData = await request.formData();
  const files = formData.getAll('files');
  // 直接保存文件
  await writeFile(filePath, buffer);
}
```

**安全问题**：
1. **缺少权限检查**：没有验证FILE_WRITE权限
2. **缺少归属检查**：任何认证用户都可以上传文件到任意项目
3. **文件类型验证缺失**：没有验证上传文件的类型

#### 3.3.2 自主进化注入API (`/api/autonomous-evolution/[id]/inject/route.ts`)

**风险等级**: 中 (Medium)

```typescript
export async function PATCH(request: Request, { params }) {
  const payload = verifyToken(token);
  // 缺少权限检查
  // 缺少归属检查
  const updated = await prisma.autonomousEvolutionExperience.update({
    where: { id },
    data: { isInjected: !current.isInjected },
  });
}
```

---

## 四、数据流安全分析

### 4.1 认证数据流

```
用户登录请求
    │
    ▼
POST /api/auth/login
    │
    ├── 验证用户名/密码
    ├── bcrypt密码验证
    ├── 获取用户权限
    │
    ▼
生成JWT Token (有效期7天)
    │
    ▼
返回Token和用户信息
```

**安全评估**：
- JWT有效期7天（较长）
- Token包含用户ID、邮箱、角色、权限
- 没有Token刷新机制
- 没有Token黑名单机制

### 4.2 敏感数据存储

| 数据类型 | 存储方式 | 安全评估 |
|---------|---------|---------|
| 用户密码 | bcrypt哈希(10轮) | 安全 |
| JWT密钥 | 环境变量 | 安全（需确保不泄露） |
| API Key | 明文存储 | 不安全 |
| 项目密码 | 明文存储 | 不安全 |

### 4.3 数据传输安全

```
前端 <---> Next.js API <---> 数据库
           │
           ├── JWT认证
           └── HTTPS (生产环境)

Next.js API <---> Claude API
           │
           └── API Key认证
```

---

## 五、安全相关发现

### 5.1 正面发现

1. **完整的RBAC系统**：设计了完整的角色权限体系
2. **密码安全处理**：使用bcrypt哈希，不存储明文密码
3. **审计日志系统**：记录关键操作，包含IP和User-Agent
4. **路径遍历防护**：文件操作API有路径检查
5. **文件大小限制**：限制上传/读取文件大小
6. **WebSocket认证**：WebSocket连接需要JWT验证

### 5.2 负面发现

#### 严重问题 (Critical)

| 编号 | 问题 | 位置 | 影响 |
|-----|------|-----|------|
| C1 | Claude代理API无认证 | `/api/claude-proxy/[...path]` | 资源滥用、费用风险 |
| C2 | API Key明文泄露 | `/api/admin/models` | 密钥泄露风险 |
| C3 | 项目API缺少归属检查 | `/api/projects/[id]` | 横向越权 |
| C4 | 评估API缺少权限检查 | `/api/evaluations/[id]` | 数据泄露 |

#### 高危问题 (High)

| 编号 | 问题 | 位置 | 影响 |
|-----|------|-----|------|
| H1 | 敏感密码字段可任意更新 | 项目PATCH API | 数据篡改 |
| H2 | 文件上传缺少权限检查 | `/api/projects/[id]/files` | 文件上传攻击 |
| H3 | 项目删除缺少归属检查 | 项目DELETE API | 数据丢失 |
| H4 | API Key在SSE流中传递 | Agent执行API | 密钥泄露 |

#### 中危问题 (Medium)

| 编号 | 问题 | 位置 | 影响 |
|-----|------|-----|------|
| M1 | 无全局中间件 | 项目架构 | 权限检查不一致 |
| M2 | CORS配置过于宽松 | 代理API | 跨域攻击风险 |
| M3 | 无登录失败限制 | 登录API | 暴力破解风险 |
| M4 | 无密码复杂度要求 | 注册API | 弱密码风险 |
| M5 | JWT有效期过长 | 认证系统 | Token被盗风险 |
| M6 | 无Token刷新/撤销机制 | 认证系统 | 会话管理风险 |

---

## 六、潜在风险点

### 6.1 业务逻辑风险

1. **权限检查不一致**
   - 部分API有权限检查，部分没有
   - 缺少统一的权限检查中间件
   - 开发者容易遗漏权限检查

2. **资源归属验证缺失**
   - 多个API缺少资源归属检查
   - 用户可以访问/修改其他用户的资源
   - 典型的横向越权漏洞

3. **敏感操作无二次验证**
   - 删除项目等敏感操作无确认
   - 修改密码无二次验证

### 6.2 数据安全风险

1. **敏感数据明文存储**
   - API Key明文存储在数据库
   - 项目密码明文存储
   - 建议使用加密存储

2. **敏感数据传输**
   - API Key可能在SSE流中传输
   - 可能在前端日志中暴露

### 6.3 输入验证风险

1. **文件上传验证不足**
   - 缺少文件类型验证
   - 缺少文件内容检查
   - 可能上传恶意文件

2. **配置导入验证不足**
   - 仅检查来源标识
   - 可导入恶意配置

### 6.4 拒绝服务风险

1. **无速率限制**
   - API无请求速率限制
   - 可能被滥用消耗资源

2. **文件大小限制有限**
   - 虽然有大小限制，但缺少请求频率限制

---

## 七、修复优先级建议

### 立即修复 (Critical - 1-3天)

1. **为Claude代理API添加认证**
   ```typescript
   // /api/claude-proxy/[...path]/route.ts
   const authHeader = request.headers.get('authorization');
   if (!authHeader) {
     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
   }
   const payload = verifyToken(authHeader.replace('Bearer ', ''));
   if (!payload) {
     return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
   }
   ```

2. **API Key脱敏处理**
   ```typescript
   // 返回时脱敏
   apiKey: model.apiKey ? `${model.apiKey.slice(0, 8)}***` : null
   ```

3. **添加项目归属检查**
   - 在项目相关API中添加userId验证

### 高优先级修复 (High - 1周内)

1. **统一添加权限检查**
   - 为所有缺少权限检查的API添加验证

2. **添加全局中间件**
   ```typescript
   // src/middleware.ts
   export function middleware(request: NextRequest) {
     // 统一认证检查
     // 统一权限验证
     // 统一审计日志
   }
   ```

3. **敏感字段保护**
   - 禁止通过API直接更新密码字段

### 中优先级修复 (Medium - 2周内)

1. **添加速率限制**
2. **添加密码复杂度验证**
3. **实现Token刷新机制**
4. **加密存储API Key**

---

## 八、安全最佳实践建议

### 8.1 认证安全

1. 实施登录失败次数限制（如5次失败锁定30分钟）
2. 添加密码复杂度要求（最少8位，包含大小写和数字）
3. 实现JWT Token刷新机制
4. 添加Token黑名单（用于注销功能）

### 8.2 授权安全

1. 创建全局中间件统一处理认证和授权
2. 所有API都应该检查权限
3. 资源访问必须验证归属关系
4. 实施最小权限原则

### 8.3 数据安全

1. 敏感数据（API Key、密码）加密存储
2. API响应脱敏敏感信息
3. 实施数据分类和标记
4. 定期数据备份

### 8.4 输入验证

1. 所有用户输入必须验证
2. 文件上传检查类型和内容
3. 配置导入完整验证
4. 实施输入白名单

### 8.5 监控与审计

1. 完善审计日志覆盖所有敏感操作
2. 实施异常行为检测
3. 设置资源使用告警
4. 定期安全审计

---

## 九、总结

AI4WEB测试平台是一个功能完整的AI驱动安全审计平台，具有以下特点：

**安全优势**：
- 完整的RBAC权限系统设计
- 安全的密码哈希处理
- 完善的审计日志系统
- 文件操作有路径遍历防护

**安全风险**：
- 多个API缺少认证和授权检查
- 敏感信息（API Key）明文存储和返回
- 存在横向越权风险
- Claude代理API完全无认证

**建议**：
1. 立即修复Critical级别的安全问题
2. 建立统一的安全中间件
3. 实施代码安全审查流程
4. 定期进行渗透测试

---

**报告编写**: Claude Code 安全分析Agent  
**分析完成时间**: 2026/04/16