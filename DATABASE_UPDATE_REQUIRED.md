# 数据库更新说明

## ⚠️ 重要：需要更新数据库

由于修改了 Prisma Schema，需要运行以下命令更新数据库：

### 方法 1：使用命令提示符（CMD）

```cmd
cd D:\opencode-web-platform
npm run db:push
npm run db:generate
npm run dev
```

### 方法 2：使用 PowerShell（管理员权限）

```powershell
cd D:\opencode-web-platform
npm run db:push
npm run db:generate
npm run dev
```

---

## 📊 数据库变更内容

### Session 模型修改

**变更前：**
```prisma
model Session {
  opencodeSessionId String  // 必需字段
}
```

**变更后：**
```prisma
model Session {
  opencodeSessionId String?  // 可选字段
  status            String   @default("idle")  // 新增字段
}
```

### 变更说明

1. **opencodeSessionId 改为可选**
   - 原因：新建项目时不启动评估，所以没有 session ID
   - 只有在用户点击"启动评估"后才会有值

2. **新增 status 字段**
   - 类型：String
   - 默认值：`"idle"`
   - 可能的值：
     - `idle` - 待启动
     - `running` - 运行中
     - `completed` - 已完成
     - `failed` - 失败

---

## 🔄 工作流程

### 新的项目流程

1. **新建项目**
   ```
   用户点击"新建项目"
   ↓
   填写项目信息 + 上传文件
   ↓
   保存到数据库
   - opencodeSessionId: null 或 ""
   - status: "idle"
   ```

2. **启动评估**
   ```
   用户点击"启动评估"
   ↓
   调用 AI4WEB SDK 创建 session
   ↓
   更新数据库
   - opencodeSessionId: "session_xxx"
   - status: "running"
   ```

3. **项目状态更新**
   ```
   评估完成
   ↓
   status: "completed"
   ```

---

## 🛠️ API 变更

### 创建项目 API (`POST /api/projects`)

**变更前：**
```typescript
// 创建项目时需要 opencodeSessionId
const project = await prisma.session.create({
  data: {
    userId: payload.userId,
    configId: config.id,
    opencodeSessionId: '???', // 问题：这里没有值
    title: name,
    description: description,
  }
});
```

**变更后：**
```typescript
// 创建项目时 opencodeSessionId 为可选
const project = await prisma.session.create({
  data: {
    userId: payload.userId,
    configId: config.id,
    opencodeSessionId: '', // 初始为空
    title: name,
    description: description,
    status: 'idle', // 初始状态
    files: {
      create: uploadedFiles,
    },
  }
});
```

### 启动项目 API (`POST /api/projects/[id]/start`)

**逻辑：**
```typescript
// 1. 检查项目是否存在
// 2. 检查项目是否已启动
// 3. 调用 AI4WEB SDK 创建 session
// 4. 更新项目
const updatedProject = await prisma.session.update({
  where: { id: projectId },
  data: {
    opencodeSessionId: session.id,
    status: 'running',
  }
});
```

---

## 📝 前端变更

### 项目列表显示

**状态标签颜色：**
- `idle` → 灰色（待启动）
- `running` → 蓝色（运行中）
- `completed` → 绿色（已完成）
- `failed` → 红色（失败）

**按钮显示：**
- `idle` 状态：显示"启动评估"按钮
- 其他状态：显示"打开"链接

---

## ⚠️ 注意事项

1. **必须更新数据库**
   - 不更新会导致创建项目失败
   - 错误信息：`Argument 'opencodeSessionId' is missing`

2. **现有项目处理**
   - 已有的项目需要手动设置 `status` 字段
   - 可以运行迁移脚本更新现有数据

3. **API 兼容性**
   - 所有使用 Session 模型的 API 都需要更新
   - 确保所有查询都正确处理可选的 `opencodeSessionId`

---

## 🚀 迁移脚本（可选）

如果需要更新现有项目的状态，可以运行：

```sql
-- 更新所有没有 opencodeSessionId 的项目
UPDATE Session
SET status = 'idle', opencodeSessionId = ''
WHERE opencodeSessionId IS NULL OR opencodeSessionId = '';

-- 更新所有有 opencodeSessionId 的项目
UPDATE Session
SET status = 'running'
WHERE opencodeSessionId IS NOT NULL AND opencodeSessionId != '';
```

---

## ✅ 验证步骤

更新数据库后，请验证：

1. **创建新项目**
   - 应该能成功创建项目
   - `status` 字段应该为 `idle`
   - `opencodeSessionId` 应该为空字符串

2. **启动评估**
   - 应该能成功启动项目
   - `status` 应该更新为 `running`
   - `opencodeSessionId` 应该有值

3. **项目列表**
   - 应该正确显示项目状态
   - "启动评估"按钮应该只在 `idle` 状态显示
