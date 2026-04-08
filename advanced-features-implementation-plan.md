# AI4WEB 高级功能实施计划

## 📋 功能清单

根据 CloudCLI UI 的实现，需要为 AI4WEB 添加以下功能：

### 1. MCP 配置支持
- 加载全局 MCP 配置（~/.claude.json）
- 加载项目特定 MCP 配置
- MCP 服务器管理界面

### 2. CLAUDE.md 支持
- 项目级 CLAUDE.md 读取
- 用户级 CLAUDE.md 读取
- 系统提示词集成

### 3. 会话恢复功能
- SDK 会话 ID 存储
- 会话恢复 API
- 会话历史管理

### 4. 工具权限管理
- 工具权限规则存储
- 权限检查逻辑
- 权限管理界面

### 5. 增强系统提示词配置
- 自定义系统提示词
- 预设模板支持
- 多级配置（项目、用户、全局）

---

## 🗄️ 数据库模型设计

### 1. MCP 配置模型

```prisma
// MCP 服务器配置
model McpServerConfig {
  id          String   @id @default(cuid())
  userId      String?
  projectId   String?
  
  // MCP 服务器信息
  name        String   // 服务器名称
  type        String   // local | remote
  command     String?  // 本地命令
  args        String?  // JSON: 参数数组
  url         String?  // 远程 URL
  env         String?  // JSON: 环境变量
  
  // 配置
  isEnabled   Boolean  @default(true)
  autoStart   Boolean  @default(false)
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  user        User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  project     Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([projectId])
  @@index([name])
}

// Project 模型添加关联
model Project {
  // ... 现有字段
  
  mcpServers  McpServerConfig[]  // MCP 服务器配置
}
```

### 2. 工具权限模型

```prisma
// 工具权限规则
model ToolPermission {
  id          String   @id @default(cuid())
  projectId   String
  
  // 权限规则
  toolPattern String   // 工具名称或模式（如 Bash(npm:*)）
  permission  String   // allow | deny | ask
  
  // 元数据
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@unique([projectId, toolPattern])
  @@index([projectId])
}

// Project 模型添加关联
model Project {
  // ... 现有字段
  
  toolPermissions ToolPermission[]  // 工具权限规则
}
```

### 3. 系统提示词模型

```prisma
// 系统提示词配置
model SystemPrompt {
  id          String   @id @default(cuid())
  userId      String?
  projectId   String?
  
  // 提示词内容
  name        String   // 配置名称
  type        String   // preset | custom
  content     String   // 提示词内容（Markdown）
  
  // 配置
  isEnabled   Boolean  @default(true)
  priority    Int      @default(0)  // 优先级（数字越大优先级越高）
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  user        User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  project     Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([projectId])
  @@index([type])
}
```

### 4. 增强 OpencodeConfig 模型

```prisma
model OpencodeConfig {
  // ... 现有字段
  
  // 新增字段
  customSystemPrompt String?  // 自定义系统提示词
  claudemdPath       String?  // CLAUDE.md 文件路径
  resumeSession      Boolean  @default(false)  // 是否启用会话恢复
}
```

---

## 🔧 API 端点设计

### 1. MCP 配置 API

```
GET    /api/projects/:id/mcp-servers        - 获取项目的 MCP 服务器列表
POST   /api/projects/:id/mcp-servers        - 创建 MCP 服务器配置
GET    /api/projects/:id/mcp-servers/:mcpId - 获取单个 MCP 服务器配置
PUT    /api/projects/:id/mcp-servers/:mcpId - 更新 MCP 服务器配置
DELETE /api/projects/:id/mcp-servers/:mcpId - 删除 MCP 服务器配置
POST   /api/projects/:id/mcp-servers/test   - 测试 MCP 服务器连接
```

### 2. 工具权限 API

```
GET    /api/projects/:id/tool-permissions         - 获取项目的工具权限规则
POST   /api/projects/:id/tool-permissions         - 创建工具权限规则
PUT    /api/projects/:id/tool-permissions/:permId - 更新工具权限规则
DELETE /api/projects/:id/tool-permissions/:permId - 删除工具权限规则
```

### 3. 系统提示词 API

```
GET    /api/projects/:id/system-prompts        - 获取项目的系统提示词列表
POST   /api/projects/:id/system-prompts        - 创建系统提示词
GET    /api/projects/:id/system-prompts/:promptId - 获取单个系统提示词
PUT    /api/projects/:id/system-prompts/:promptId - 更新系统提示词
DELETE /api/projects/:id/system-prompts/:promptId - 删除系统提示词
```

### 4. 会话恢复 API

```
GET    /api/sessions/:id/resume     - 恢复会话
POST   /api/sessions/:id/resume     - 创建恢复点
DELETE /api/sessions/:id/resume     - 删除恢复点
```

---

## 🎨 界面设计

### 1. MCP 配置管理界面

**位置**: Dashboard > 项目详情 > MCP 配置

**组件结构**:
```
McpServerManager/
├── McpServerList.tsx          // 服务器列表
├── McpServerForm.tsx          // 添加/编辑表单
├── McpServerTest.tsx          // 连接测试
└── McpServerDocs.tsx          // 文档链接
```

**功能**:
- 显示已配置的 MCP 服务器列表
- 添加新的 MCP 服务器（本地/远程）
- 编辑现有配置
- 测试连接
- 启用/禁用服务器
- 查看服务器文档

### 2. 工具权限管理界面

**位置**: Dashboard > 项目详情 > 工具权限

**组件结构**:
```
ToolPermissionManager/
├── ToolPermissionList.tsx     // 权限规则列表
├── ToolPermissionForm.tsx     // 添加/编辑规则
└── ToolPermissionTest.tsx     // 规则测试
```

**功能**:
- 显示工具权限规则列表
- 添加新规则（允许/拒绝/询问）
- 编辑现有规则
- 测试规则匹配
- 批量导入/导出

### 3. 系统提示词管理界面

**位置**: Dashboard > 项目详情 > 系统提示词

**组件结构**:
```
SystemPromptManager/
├── SystemPromptList.tsx       // 提示词列表
├── SystemPromptEditor.tsx     // Markdown 编辑器
└── SystemPromptPreview.tsx    // 预览
```

**功能**:
- 显示系统提示词列表
- 添加新提示词
- Markdown 编辑器
- 实时预览
- 模板选择
- 导入/导出

---

## 🔨 实施步骤

### 阶段 1：数据库模型（1 天）

1. 添加 MCP 配置模型
2. 添加工具权限模型
3. 添加系统提示词模型
4. 增强 OpencodeConfig 模型
5. 运行数据库迁移

### 阶段 2：后端 API（2 天）

1. 实现 MCP 配置 API
2. 实现工具权限 API
3. 实现系统提示词 API
4. 实现会话恢复 API
5. 集成到启动评估流程

### 阶段 3：SDK 集成（2 天）

1. 实现 MCP 配置加载
2. 实现 CLAUDE.md 读取
3. 实现会话恢复逻辑
4. 实现工具权限检查
5. 实现系统提示词配置

### 阶段 4：前端界面（3 天）

1. 创建 MCP 配置管理界面
2. 创建工具权限管理界面
3. 创建系统提示词管理界面
4. 集成到项目详情页
5. 添加导航菜单

### 阶段 5：测试和文档（1 天）

1. 单元测试
2. 集成测试
3. 用户文档
4. API 文档

---

## 📝 实施优先级

### P0（必须实现）
- [x] 数据库模型设计
- [ ] MCP 配置 API
- [ ] 会话恢复功能
- [ ] CLAUDE.md 支持

### P1（重要功能）
- [ ] 工具权限管理
- [ ] 系统提示词配置
- [ ] MCP 配置界面

### P2（增强功能）
- [ ] 工具权限界面
- [ ] 系统提示词界面
- [ ] MCP 服务器测试

---

## 🎯 成功标准

### 功能完整性
- ✅ MCP 服务器配置可正常加载和使用
- ✅ CLAUDE.md 文件可正常读取和应用
- ✅ 会话可正常恢复
- ✅ 工具权限可正常检查
- ✅ 系统提示词可正常配置

### 性能指标
- MCP 配置加载时间 < 100ms
- CLAUDE.md 读取时间 < 50ms
- 会话恢复时间 < 200ms
- 工具权限检查时间 < 10ms

### 用户体验
- 界面简洁直观
- 配置操作流畅
- 错误提示清晰
- 文档完整详细

---

## 📚 参考文档

- CloudCLI UI MCP 配置实现：`server/claude-sdk.js`
- CloudCLI UI 工具权限管理：`server/claude-sdk.js`
- Claude Agent SDK 文档：https://docs.anthropic.com/claude-agent-sdk
- MCP 协议规范：https://modelcontextprotocol.io/
