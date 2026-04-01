# 数据库更新说明

## 问题
项目数据库架构已更新，但数据库表结构尚未同步，导致以下错误：
```
The column `main.Session.description` does not exist in the current database.
```

## 解决方案

### 方法 1：使用命令提示符（CMD）

1. 打开命令提示符（CMD）
2. 运行以下命令：

```cmd
cd D:\opencode-web-platform
npm run db:push
```

或者直接使用 Prisma CLI：

```cmd
cd D:\opencode-web-platform
npx prisma db push
```

### 方法 2：使用 PowerShell（需要管理员权限）

1. 以管理员身份运行 PowerShell
2. 运行以下命令：

```powershell
cd D:\opencode-web-platform
npm run db:push
```

### 方法 3：使用 Git Bash

1. 打开 Git Bash
2. 运行以下命令：

```bash
cd /d/opencode-web-platform
npm run db:push
```

## 数据库变更内容

### 1. OpencodeConfig 模型新增字段
- `projectUploadDir`: 项目上传目录路径

### 2. Session 模型新增字段
- `description`: 项目描述
- `projectPath`: 项目目录路径

### 3. 新增 SessionFile 模型
用于记录项目上传的文件：
- `id`: 文件 ID
- `sessionId`: 关联的项目 ID
- `fileName`: 文件名
- `filePath`: 文件路径
- `fileSize`: 文件大小
- `fileType`: 文件类型
- `uploadedAt`: 上传时间

## 验证更新

运行以下命令验证数据库更新成功：

```cmd
npm run db:generate
```

## 常见问题

### Q: 为什么会出现这个错误？
A: 我们修改了 Prisma Schema 文件，添加了新的字段和模型，但数据库表结构还没有同步更新。

### Q: 会影响现有数据吗？
A: 不会。`db:push` 命令会保留现有数据，只添加新的字段和表。

### Q: 需要重新启动服务器吗？
A: 是的，更新数据库后需要重启 Next.js 开发服务器。

## 更新后需要重启开发服务器

1. 停止当前运行的服务器（Ctrl+C）
2. 重新启动：

```cmd
npm run dev
```
