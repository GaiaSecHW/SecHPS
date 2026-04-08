# 数据库迁移指南

## 问题说明

由于 Windows PowerShell 执行策略限制，无法直接运行 `npx prisma generate` 和 `npx prisma db push`。

## 解决方案

### 方法 1：手动执行（推荐）

请手动在项目根目录打开命令行（CMD 或 Git Bash），执行以下命令：

```bash
# 生成 Prisma 客户端
npx prisma generate

# 推送 schema 变更到数据库
npx prisma db push

# 如果需要，运行数据库种子
npm run db:seed
```

### 方法 2：使用 CMD

在项目根目录打开 CMD，执行：

```cmd
npx prisma generate
npx prisma db push
```

### 方法 3：使用 Git Bash

在项目根目录打开 Git Bash，执行：

```bash
npx prisma generate
npx prisma db push
```

## Schema 变更内容

### 1. Project 模型新增字段
- `displayName` - 显示名称
- `fullPath` - 完整路径
- `sessionMeta` - 会话元数据关联

### 2. EvaluationSession 模型新增字段
- `provider` - 提供者（claude | cursor | codex | gemini）
- `title` - 会话标题
- `summary` - 会话摘要
- `messageCount` - 消息数量
- `lastActivity` - 最近活动时间

### 3. 新增 SessionMeta 模型
用于统计项目的会话信息，包括：
- 总会话数
- 各提供者会话数
- 各状态会话数

### 4. 新增 SystemConfig 模型
用于存储系统配置（键值对）

## 验证迁移

迁移完成后，验证以下内容：

1. **检查数据库表**
```bash
npx prisma studio
```

2. **检查新增字段**
- `Project` 表是否有 `displayName`、`fullPath` 字段
- `EvaluationSession` 表是否有 `provider`、`messageCount`、`lastActivity` 字段
- `SessionMeta` 表是否存在
- `SystemConfig` 表是否存在

3. **测试 API**
- GET /api/projects - 获取项目列表
- GET /api/projects/:id - 获取项目详情
- GET /api/projects/:id/sessions - 获取项目会话

## 后续步骤

迁移成功后，继续执行：

1. 实现 API 路由（多提供者会话查询）
2. 实现会话元数据统计
3. 前端组件更新

## 故障排查

### 错误：EPERM: operation not permitted

**原因**：Windows 文件权限问题

**解决**：
1. 关闭所有编辑器和 IDE
2. 以管理员身份运行命令行
3. 重新执行 `npx prisma generate`

### 错误：数据库已锁定

**原因**：SQLite 数据库被其他进程占用

**解决**：
1. 关闭所有数据库连接
2. 重启开发服务器
3. 重新执行 `npx prisma db push`

### 错误：Schema 变更未生效

**原因**：Prisma 客户端未更新

**解决**：
```bash
# 删除 node_modules 和 Prisma 客户端
rm -rf node_modules/.prisma
rm -rf node_modules/@prisma/client

# 重新安装
npm install

# 重新生成
npx prisma generate
```
