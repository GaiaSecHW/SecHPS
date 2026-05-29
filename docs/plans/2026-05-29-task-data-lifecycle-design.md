# 任务数据生命周期管理方案

## 背景

当前系统所有任务数据只增不减：
- MinIO `workspaces/{taskId}.tar.gz`（上传代码包）永不删除
- NFS `{SHARED_WORKSPACE_BASE}/{taskId}/` 目录永不清理
- DB 记录永久保留
- `cleanupTaskDirectory()` 已定义但从未调用（死代码）

长期运行会导致存储耗尽。

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 保留期 | 30 天，可配置 | 平衡存储与回溯需求 |
| 清理行为 | 直接删除文件，DB 记录保留 | DB 记录体积小，保留可追溯 |
| 清理范围 | MinIO workspace 包 + NFS 目录 | 结果包和 DB 记录保留 |
| 清理时机 | 每日定时扫描 | 批量处理效率高 |
| 扫描频率 | 每天一次（凌晨 3 点，服务器本地时间） | 低峰期执行 |

## 清理范围

| 维度 | 清理 | 保留 |
|------|------|------|
| MinIO `workspaces/{taskId}.tar.gz` | 删除 | - |
| NFS `{SHARED_WORKSPACE_BASE}/{taskId}/` | 删除 | - |
| MinIO `results/{taskId}.tar.gz` | - | 保留 |
| MinIO `vuln-file` 桶（报告/漏洞文件） | - | 保留（用户查看漏洞的核心数据） |
| DB TaskInstance / CodeswarmTask | - | 永久保留 |
| DB TaskExecutionLog / Vulnerability | - | 永久保留 |

## 架构

```
每日定时扫描（Server 侧，codeswarm-dispatcher.ts）
     │
     ├─ 查询：status in ['completed','failed']
     │        AND completedAt < now - RETENTION_DAYS   ← 用 completedAt，不用 updatedAt
     │        AND filesCleanedAt IS NULL
     │
     ├─ 对每个过期任务（每批最多100个，分批渐进清理）：
     │   ├─ MinIO: 删除 workspaces/{taskId}.tar.gz（如存在）
     │   ├─ NFS:   删除 {SHARED_WORKSPACE_BASE}/{taskId}/（如存在）
     │   └─ 标记 filesCleanedAt = now()
     │
     └─ 日志：本次清理 N 个任务，错误 M 个
```

**注意**：保留期不得低于任务最大执行时长（默认7天，由 `TASK_TIMEOUT_SEC` 控制）。建议最小值为14天。

## 重新执行已清理任务的处理

`execute/route.ts` 允许 `completed`/`failed` 状态的任务重新执行。若任务文件已被清理（`filesCleanedAt != null`），重新执行时 Worker 将找不到 workspace 文件。

**处理方式**：execute 路由在发起执行前检查 `filesCleanedAt`，若已清理则返回 400 错误，提示用户需要重新创建任务并上传文件。

## 改动清单

### 1. 新文件：`src/lib/task-cleanup.ts`

核心清理模块，导出：

```typescript
export async function cleanupExpiredTasks(): Promise<{ cleaned: number; errors: number }>
```

逻辑：
1. 读取 `TASK_CLEANUP_RETENTION_DAYS`（默认 30）计算截止时间（基于 `completedAt`）
2. 查询过期未清理任务（`filesCleanedAt IS NULL`，`completedAt NOT NULL`），每批 `take: 100`
3. 逐个处理：
   - MinIO：`removeObject(WORKSPACE_BUCKET, workspaces/{taskId}.tar.gz)`，try/catch 忽略不存在
   - NFS：`rm(dir, { recursive: true, force: true })`，先 `existsSync` 检查
4. 更新 `filesCleanedAt = new Date()`
5. 返回 `{ cleaned, errors }` 统计

### 2. 改文件：`prisma/schema.prisma`

TaskInstance 模型新增：

```prisma
filesCleanedAt  DateTime?  // 文件清理时间，null = 未清理
```

**依赖说明**：此字段需要在 dev-nonfs 分支合并后一并添加（dev-nonfs 已新增 `workspaceStorageKey`、`resultStorageKey`）。在 dev 分支单独实施时，需单独添加此字段。

### 3. 改文件：`src/services/codeswarm-dispatcher.ts`

新增方法：

```typescript
private cleanupTimer: NodeJS.Timeout | null = null;

startCleanupScheduler(): void {
  // 计算距下次执行时间（TASK_CLEANUP_HOUR，默认凌晨3点，服务器本地时间）
  // setTimeout 到点后执行 cleanupExpiredTasks()
  // 执行完后再 setTimeout 明天同一时间
}

// shutdown() 中增加：
if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
```

### 4. 改文件：`src/app/api/task-builder/tasks/[id]/execute/route.ts`

在执行前增加检查：

```typescript
if (task.filesCleanedAt) {
  return NextResponse.json(
    { error: '任务文件已被清理，请重新创建任务并上传文件' },
    { status: 400 }
  );
}
```

### 5. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TASK_CLEANUP_RETENTION_DAYS` | `30` | 任务文件保留天数（最小建议14天） |
| `TASK_CLEANUP_HOUR` | `3` | 每天几点执行清理（0-23，服务器本地时间） |

## 异常处理

| 场景 | 处理 |
|------|------|
| MinIO 删除失败（网络/权限） | 跳过该对象，errors++，继续处理其他 |
| NFS 目录删除失败 | 跳过，errors++ |
| DB 更新 filesCleanedAt 失败 | 整个任务不计入 cleaned，下次重试 |
| 查询返回 0 条 | 无操作，日志记录 |
| 清理过程中服务重启 | 幂等设计（filesCleanedAt 防重复），下次启动重新调度 |
| 超过100个过期任务 | 本次清理前100个，剩余下次定时任务处理（分批渐进） |
| 重新执行已清理任务 | execute 路由返回 400，提示重新创建任务 |
| 保留期设置过短（< 7天） | 不阻断，但日志警告（任务最大执行时长为7天） |

## 验证方式

1. 设 `TASK_CLEANUP_RETENTION_DAYS=0` 使所有已完成任务过期
2. 手动调用 `cleanupExpiredTasks()`
3. 验证 MinIO workspace 包被删除
4. 验证 NFS 目录被清理
5. 验证 DB 记录保留，`filesCleanedAt` 已更新
6. 验证 `results/{taskId}.tar.gz` 未被删除
7. 验证 `vuln-file` 桶报告文件未被删除
8. 尝试重新执行已清理任务，验证返回 400 错误提示
