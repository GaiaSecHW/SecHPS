# NFS 彻底移除方案 — MinIO 替代

> 日期：2026-05-29
> 状态：待实施

## 摘要

**用 MinIO 替代 NFS，作为 Server 和 Worker 之间的文件传输通道。**

Server 和 Worker 在不同主机，但共享同一块 NFS 磁盘。Worker 扫描代码时每一步文件读写都走网络，大代码库极慢；同时 NFS 挂载带来运维负担，Server 和 Worker 必须绑定在同一存储上，无法独立扩展。

**新架构流程：**

```
任务创建：用户上传 ZIP → Server 解压 + 注入 AgentHarness → 打包 tar.gz → 上传 MinIO
任务执行：Worker 从 MinIO 下载 tar.gz → 解压到本地 SSD → opencode 在本地执行
结果回传：Worker 打包完整 workspace（含 Report/）→ 上传 MinIO → 通知 Server
漏洞解析：Server 从 MinIO 下载结果 tar.gz → 解压到临时目录 → 运行漏洞解析 → 清理
```

MinIO 新增 `workspace` bucket，存两类对象：
- `workspaces/{taskId}.tar.gz` — 原始 workspace，Server 上传，长期保留（支持重试）
- `results/{taskId}.tar.gz` — 执行后完整 workspace，Worker 上传，供 Server 漏洞解析用

**改动范围：** Server 和 Worker 两侧均需改动，部署配置删除 NFS 挂载。

**关键约束：**
- Worker 上传结果必须在通知 Server 之前完成（await），因为 Server 收到通知后立即去 MinIO 下载
- AgentHarness 注入从"执行时"前移到"创建时"，AgentHarness 更新后需重新创建任务
- 任务创建 HTTP 请求会阻塞到 MinIO 上传完成，大代码库需配置反向代理超时 ≥ 10 分钟

---

## 背景

NFS、Server、Worker 分布在不同主机。当前架构强依赖 NFS 共享卷：Server 写 workspace 到 NFS，Worker 从 NFS 直接读（passthrough），Server 再从 NFS 读 Report/ 解析漏洞。这导致三个问题：

1. **性能差**：Worker 扫描代码时每一步文件 I/O 都走网络，大代码库极慢
2. **运维复杂**：需维护 NFS 挂载、权限、跨主机共享卷配置
3. **耦合重**：Server 和 Worker 必须挂载同一块磁盘，无法独立伸缩

目标：**彻底移除 NFS**，用 MinIO（已在部署中）作为 Server↔Worker 的文件传输通道。

## 核心思路

```
┌──────── Server ────────┐              ┌──────── Worker ────────┐
│                         │              │                         │
│  用户上传 ZIP           │              │                         │
│      ↓                  │              │                         │
│  解压到临时目录          │              │                         │
│  + AgentHarness 注入    │              │                         │
│      ↓                  │              │                         │
│  tar.gz 打包 ───────────┼── MinIO ───→ │  下载 tar.gz → 本地 SSD │
│      ↑                  │  workspace   │      ↓                  │
│  清理临时目录            │   bucket     │  opencode 执行（本地）   │
│                         │              │      ↓                  │
│                         │              │  上传 tar.gz ──┐        │
│                         │              │  (含 Report/)  │        │
│                         │              │                │        │
│  下载 results tar.gz ←──┼── MinIO ─────┼────────────────┘        │
│      ↓                  │              │                         │
│  解压到临时目录          │              │  清理本地工作区           │
│  漏洞解析 (opencode run)│              │                         │
│      ↓                  │              │                         │
│  清理临时目录            │              │                         │
└─────────────────────────┘              └─────────────────────────┘
```

**关键变化：**
- **传输机制**：NFS 共享卷 → MinIO 对象存储（tar.gz 打包/解包）
- **执行位置**：NFS 挂载路径 → Worker 本地 SSD
- **结果回传**：rsync 回写 NFS → tar.gz 上传 MinIO
- **Server 读结果**：直接读 NFS → 从 MinIO 下载到临时目录
- **临时文件**：Server 和 Worker 均用临时目录处理，用完即清

## MinIO 存储设计

**新增 Bucket：** `workspace`（与现有 `codedmap-dbs`、`vuln-file` 并列）

| 对象 Key | 上传方 | 内容 | 生命周期 |
|----------|--------|------|----------|
| `workspaces/{taskId}.tar.gz` | Server | 原始 workspace（源码 + AgentHarness + instruction.txt + opencode.json） | 长期保留，支持任务重试 |
| `results/{taskId}.tar.gz` | Worker | 执行后完整 workspace（含 Report/、workspace/ 等结果目录） | 长期保留 |

说明：
- `results/` 包含完整 workspace 而非仅 Report/，因为 Server 侧漏洞解析需在 workspace 目录下运行 `opencode run`，需要源码上下文
- tar.gz 格式：单对象操作、压缩减少存储/传输量、保留目录结构和权限

---

## 改动清单

### Step 1: 类型定义变更

**文件：** `codeswarm/packages/types/src/index.ts`

**TaskPayloadSchema 变更**（~line 101）：

```typescript
export const TaskPayloadSchema = z.object({
  taskId: z.string(),
  instruction: z.string().nullable().optional(),
  projectPath: z.string().optional().default(''),
  // ...
  // 删除: workspacePath: z.string().optional(),  // NFS passthrough 已移除
  // 新增: MinIO workspace 对象 key
  workspaceStorageKey: z.string().optional(),  // e.g. "workspaces/{taskId}.tar.gz"
  // ...
});
```

**TaskResultSchema 变更**（~line 190）：

```typescript
export const TaskResultSchema = z.object({
  taskId: z.string(),
  nodeId: z.string(),
  status: TaskResultStatusEnum,
  result: z.string().optional(),
  error: z.string().optional(),
  reportContent: z.string().optional(),
  // 新增: Worker 上传的结果对象 key
  resultStorageKey: z.string().optional(),  // e.g. "results/{taskId}.tar.gz"
});
```

### Step 2: 数据库 Schema 变更

**文件：** `prisma/schema.prisma`

TaskInstance 模型新增两个字段：

```prisma
model TaskInstance {
  // ... 现有字段 ...
  projectPath           String?    // 保留但置空，不再使用（原 NFS 路径）
  workspaceStorageKey   String?    // 新增: MinIO workspace 对象 key，e.g. "workspaces/{taskId}.tar.gz"
  resultStorageKey      String?    // 新增: MinIO results 对象 key，e.g. "results/{taskId}.tar.gz"
}
```

CodeswarmTask 模型：`workspacePath` 字段改为存储 MinIO key（原存 NFS 路径），在 schema 注释中标注语义变化。

**迁移 SQL：**

```sql
ALTER TABLE "TaskInstance" ADD COLUMN "workspaceStorageKey" TEXT;
ALTER TABLE "TaskInstance" ADD COLUMN "resultStorageKey" TEXT;
```

### Step 3: 新建 MinIO workspace 存储模块（Server 侧）

**新建文件：** `src/lib/minio-workspace.ts`

```typescript
export const WORKSPACE_BUCKET = process.env.MINIO_WORKSPACE_BUCKET || 'workspace';

/** 确保 workspace bucket 存在 */
export async function ensureWorkspaceBucket(): Promise<void>

/** 将本地目录打包为 tar.gz 并上传到 MinIO */
export async function uploadDirectory(
  localDir: string,
  objectKey: string,
  opts?: { exclude?: string[] }
): Promise<{ objectKey: string; bytes: number }>

/** 从 MinIO 下载 tar.gz 并解压到本地目录 */
export async function downloadAndExtract(
  objectKey: string,
  destDir: string
): Promise<{ bytes: number }>

/** 检查对象是否存在 */
export async function workspaceObjectExists(objectKey: string): Promise<boolean>
```

实现要点：
- **tar 库**：使用 npm `tar` 包（`import tar from 'tar'`），不依赖系统 `tar` 命令，跨平台兼容（Linux 容器 + Windows 开发环境均可用）
- `uploadDirectory`: `tar.c({ gzip: true, cwd: localDir }, ['.'])` 生成 ReadableStream → `MinIO.putObject(bucket, key, stream)`（流式上传，避免临时 tar 文件）
- `downloadAndExtract`: `MinIO.getObject(bucket, key)` 返回 ReadableStream → `tar.x({ gzip: true, cwd: destDir })` 流式解压
- 超时：`WORKSPACE_UPLOAD_TIMEOUT_MS`（默认 600000 = 10min），通过 `AbortSignal.timeout()` 控制
- 依赖：`tar`（已在 Node.js 生态广泛使用，Worker 侧同样使用此包）

### Step 4: 任务创建流程改造

**文件：** `src/lib/task-creation.ts`

**核心变更：** `createTaskWithFiles()` 不再写 NFS，改为写临时目录 + 上传 MinIO。

```
原流程:
  用户上传 ZIP → 解压到 {NFS_MOUNT_PATH}/{taskId}/ → 存 projectPath = NFS路径

新流程:
  用户上传 ZIP → 解压到临时目录 → 注入 AgentHarness → tar.gz 上传 MinIO
  → 存 workspaceStorageKey = "workspaces/{taskId}.tar.gz"
  → 存 projectPath = workspaceStorageKey（兼容旧字段读取）
  → 清理临时目录
```

关键改动点：

1. **`SHARED_WORKSPACE_BASE` 替换**（line 191）：

```typescript
// 删除: const SHARED_WORKSPACE_BASE = process.env.NFS_MOUNT_PATH || ...
// 改为临时目录
import { tmpdir } from 'os';
const TEMP_WORKSPACE_BASE = join(tmpdir(), 'sehps-workspaces');
```

2. **`createTaskWithFiles` 末尾添加 MinIO 上传**（line 292 之后）：

```typescript
projectPath = taskDir;

// AgentHarness 注入（原在 execute/route.ts 中做，现前移到创建阶段）
// 注意：AgentHarness 在创建时注入，执行时不再重新注入。
// 如需更新 AgentHarness，需重新创建任务（重新上传文件）。
if (agentId) {
  const agentApp = await prisma.agentApp.findUnique({
    where: { id: agentId },
    select: { agentHarnessPath: true },
  });
  if (agentApp?.agentHarnessPath) {
    await copyAgentHarnessFromLocal(agentApp.agentHarnessPath, taskDir);
  }
}

// 上传到 MinIO（同步等待，任务创建 HTTP 请求在此阻塞直到上传完成）
// 大代码库上传可能耗时较长，需确保反向代理超时 >= WORKSPACE_UPLOAD_TIMEOUT_MS
const workspaceStorageKey = `workspaces/${taskId}.tar.gz`;
await uploadDirectory(taskDir, workspaceStorageKey, {
  exclude: ['.git', 'node_modules']
});

// 清理临时目录
await rm(taskDir, { recursive: true, force: true });
```

3. **DB 记录变更**（line 294-315）：

```typescript
const task = await prisma.taskInstance.create({
  data: {
    // ...
    projectPath: null,              // 不再存储路径，置空
    workspaceStorageKey,            // 新字段：MinIO key
    // ...
  },
});
```

### Step 5: 任务调度流程改造

**文件：** `src/app/api/task-builder/tasks/[id]/execute/route.ts`

**核心变更：** 不再传 NFS 路径给 Worker，改为传 MinIO key。

1. **移除 AgentHarness 注入逻辑**（line 126-143）：已前移到 Step 4 的创建阶段，此处删除。

2. **workspacePath 替换**（line 123）：

```typescript
// 删除: const workspacePath = task.projectPath || undefined;
// 改为（注意：execute route 的 DB 查询需在 select 中包含 workspaceStorageKey）:
const workspaceStorageKey = task.workspaceStorageKey || undefined;
```

DB 查询（route 顶部 `prisma.taskInstance.findUnique`）需在 `include` 或 `select` 中加入 `workspaceStorageKey`。

3. **CodeswarmTask 创建**（line 171-187）：

```typescript
await withRetry(() => prisma.$executeRaw`
  INSERT INTO "CodeswarmTask" (
    id, "taskId", state, instruction, "projectPath", "workspacePath",
    ...
  ) VALUES (
    ${codeswarmDbId}, ${codeswarmTaskId}, 'queued',
    ${instruction}, NULL, ${workspaceStorageKey || null},
    ...
  )
`);
```

`workspacePath` 字段改为存储 MinIO key（如 `workspaces/{taskId}.tar.gz`）。

4. **DB fallback 分发**（line 218-236）：

```typescript
const taskRow = {
  // ...
  projectPath: null,
  workspacePath: workspaceStorageKey || null,  // MinIO key
  // ...
};
```

### Step 6: Worker 端改造

#### 6a: MinIO workspace 客户端

**文件：** `codeswarm/packages/worker/src/minio-client.ts`

扩展现有 MinIO 客户端，新增 workspace bucket 支持：

```typescript
const WORKSPACE_BUCKET = process.env.MINIO_WORKSPACE_BUCKET || 'workspace';

/** 下载 tar.gz 并解压到本地目录 */
export async function downloadAndExtractWorkspace(
  objectKey: string,
  destDir: string
): Promise<{ bytes: number }>

/** 将本地目录打包为 tar.gz 并上传到 MinIO */
export async function uploadWorkspaceResult(
  localDir: string,
  objectKey: string
): Promise<{ objectKey: string; bytes: number }>

/** 确保 workspace bucket 存在 */
export async function ensureWorkspaceBucket(): Promise<void>
```

实现方式与 Step 3 相同：使用 npm `tar` 包流式打包/解包，不依赖系统 `tar` 命令。

#### 6b: environment.ts 改造

**文件：** `codeswarm/packages/worker/src/environment.ts`

**BuildResult 不变**（workspacePath 仍为本地路径）：

```typescript
export interface BuildResult {
  workspacePath: string;       // Agent 实际使用的本地路径
  agent?: string;
  instruction?: string;
  commandTemplate?: string;
  model?: string;
  engine?: 'opencode' | 'claudecode';
  resultStorageKey?: string;   // 新增: 结果上传到 MinIO 的 key
}
```

**build() 方法变更**：

原来的 NFS passthrough 分支（`if (payload.workspacePath)`）改为 MinIO 下载分支：

```typescript
if (payload.workspaceStorageKey) {
  // MinIO 下载模式
  const localBase = process.env.WORKSPACE_LOCAL_PATH || '/data/worker_workspaces';
  const localPath = path.join(localBase, payload.taskId);

  progress(`Downloading workspace from MinIO: ${payload.workspaceStorageKey}`);
  await mkdir(localPath, { recursive: true });

  try {
    await downloadAndExtractWorkspace(payload.workspaceStorageKey, localPath);
  } catch (err) {
    // 下载失败 → 清理本地目录，抛出错误
    await rm(localPath, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Workspace download failed: ${err}`);
  }

  // 读取 opencode.json / instruction.txt（与原 NFS passthrough 逻辑相同，路径从 NFS 改为 localPath）
  // ... 后续逻辑使用 localPath 替代原来的 workspacePath

  return {
    workspacePath: localPath,
    resultStorageKey: `results/${payload.taskId}.tar.gz`,
    // ...
  };
}
```

原 `projectPath` 分支（本地 copy 模式）保留不变。

**cleanup() 变更**：移除 NFS 路径保护逻辑。无论路径来源，均执行 `rm -rf` 清理。

#### 6c: daemon.ts 改造

**文件：** `codeswarm/packages/worker/src/daemon.ts`

**executeTask() 变更**：

1. 解构 `buildResult` 时取出 `resultStorageKey`
2. 在 `collectReport()` 之后、`postResult()` 之前，上传结果到 MinIO：

```typescript
// 上传结果到 MinIO（必须在 postResult 之前完成）
if (resultStorageKey && status === 'completed') {
  try {
    await uploadWorkspaceResult(workspacePath, resultStorageKey);
  } catch (err) {
    // 上传失败：reportContent 已内联，任务结果不丢失
    // 但 Server 侧无法从 MinIO 下载完整 workspace 进行漏洞解析
    logger.warn(`Result upload to MinIO failed: ${err}`);
  }
}

await postResult(payload, {
  taskId,
  nodeId: this.config.nodeId,
  status,
  result: isCancelled ? undefined : (result.stdout || undefined),
  error: isCancelled ? 'Task cancelled by user' : (result.exitCode !== 0 ? result.stderr || `Process exited with code ${result.exitCode}` : undefined),
  reportContent: isCancelled ? undefined : reportContent,
  resultStorageKey: resultStorageKey || undefined,  // 新增
});
```

**catch 块同样传递 resultStorageKey**（buildResult 可能已成功，workspace 已下载）：

```typescript
// catch 块中的 postResult 调用也需传入 resultStorageKey
this.postResult(payload, {
  taskId,
  nodeId: this.config.nodeId,
  status: 'failed',
  error: errorMsg,
  resultStorageKey: buildResult?.resultStorageKey || undefined,  // 新增
}).catch(...);
```

3. `finally` 块：`cleanup(buildResult.workspacePath)` 清理本地工作区（无论成功/失败/取消）

### Step 7: Server 结果处理改造

**文件：** `src/app/api/codeswarm/worker/result/route.ts`

**executeVulnerabilityParseAsync 变更**：

不再从 NFS 路径读取 workspace，改为从 MinIO 下载到临时目录。

```typescript
async function executeVulnerabilityParseAsync(
  taskId: string,
  resultStorageKey: string | null,   // 新增参数，替代 projectPath
  taskInstanceId: string,
  context: ParseContext
): Promise<void> {
  // 1. 从 MinIO 下载结果到临时目录
  const projectPath = join(tmpdir(), `sehps-parse-${taskId}`);
  await mkdir(projectPath, { recursive: true });

  try {
    if (resultStorageKey) {
      await downloadAndExtract(resultStorageKey, projectPath);
    } else {
      logger.warn(`No resultStorageKey for task ${taskId}, skipping vulnerability parse`);
      return;
    }

    // 2. 后续逻辑不变：findReportFolder、uploadReportFolder、runOpencodeParse
    //    全部使用 projectPath（临时目录），行为与原 NFS 模式一致

    // ... 原有 Phase 1 / Phase 2 逻辑 ...

  } finally {
    // 3. 清理临时目录
    await rm(projectPath, { recursive: true, force: true }).catch(() => {});
  }
}
```

**POST handler 变更**（~line 554-583）：

```typescript
// 1. 从 body 中解构 resultStorageKey
const { taskId, nodeId, status, result, error, reportContent, resultStorageKey } = body;

// 2. 在事务的 TaskInstance.update 中保存 resultStorageKey
await tx.taskInstance.update({
  where: { id: taskInstance.id },
  data: {
    status: finalState,
    completedAt: new Date(),
    updatedAt: new Date(),
    errorMessage: error || null,
    executionResult: result || null,
    reportPath: reportContent || null,
    resultStorageKey: resultStorageKey || null,  // 新增：保存 MinIO key
  },
});

// 3. 触发漏洞解析时读取 resultStorageKey
if (finalState === 'completed') {
  const taskInstanceForParse = await prisma.taskInstance.findFirst({
    where: { codeswarmTaskId: taskId },
    select: { id: true, resultStorageKey: true, name: true, targetProduct: true },
  });

  if (taskInstanceForParse?.resultStorageKey && !vulnParseInProgress.has(taskId)) {
    vulnParseInProgress.add(taskId);
    // ...
    executeVulnerabilityParseAsync(
      taskId,
      taskInstanceForParse.resultStorageKey,
      taskInstanceForParse.id,
      { productName, taskName }
    );
  }
}
```

### Step 8: 清理 NFS 相关代码

| 文件 | 操作 |
|------|------|
| `src/lib/nfs-upload.ts` | 整文件删除 |
| `src/app/api/task-builder/nfs-status/route.ts` | 整文件删除 |
| `src/lib/monitoring/health-check.ts` | 删除 `checkNFS()` 函数和调用 |
| `src/lib/task-creation.ts` | 删除 `SHARED_WORKSPACE_BASE`、`cleanupTaskDirectory`（NFS 路径清理） |
| `deploy/.env.server` | 删除 `NFS_MOUNT_PATH`、`SHARED_WORKSPACE_PATH` |
| `deploy/run.sh` | 删除 `SHARED_VOLUME` NFS 挂载行 |
| `codeswarm/packages/worker/src/environment.ts` | 删除 NFS passthrough 分支、`mapRemotePathToLocal()`、NFS 路径保护逻辑 |

全局搜索确认无遗漏（搜索范围限定 `src/` 和 `codeswarm/`，排除 `.opencode/`）：
- `NFS_MOUNT_PATH` — 应为 0 结果
- `SHARED_WORKSPACE_PATH` — 应为 0 结果
- `nfs-upload` — 应为 0 结果
- `payload\.workspacePath` — 应为 0 结果（区别于局部变量 `workspacePath`）
- `CodeswarmTask.*workspacePath` — 确认所有读取点已更新为 MinIO key 语义

### Step 9: 部署配置变更

**文件：** `deploy/.env.server`

```
# 删除
# NFS_MOUNT_PATH=/mnt/luyuxin/ai4_worker
# SHARED_WORKSPACE_PATH=/mnt/luyuxin/ai4_worker

# 新增
MINIO_WORKSPACE_BUCKET=workspace
WORKSPACE_UPLOAD_TIMEOUT_MS=600000
```

**文件：** `deploy/.env.worker`

```
# 新增
MINIO_WORKSPACE_BUCKET=workspace
WORKSPACE_LOCAL_PATH=/data/worker_workspaces
```

**文件：** `Dockerfile.worker`

```dockerfile
# 新增: Worker 本地工作区目录
RUN mkdir -p /data/worker_workspaces
```

**文件：** `Dockerfile.server`（如有）

确保 Server 容器有 `tar` 命令可用（Alpine 镜像默认包含）。

**文件：** `deploy/run.sh`

删除 `SHARED_VOLUME` 行，Worker 容器不再需要 NFS 挂载。

---

## 环境变量

### Server 侧

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINIO_WORKSPACE_BUCKET` | `workspace` | workspace/results 存储 bucket |
| `WORKSPACE_UPLOAD_TIMEOUT_MS` | `600000` | tar.gz 上传/下载超时（毫秒） |

### Worker 侧

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINIO_WORKSPACE_BUCKET` | `workspace` | workspace bucket（与 Server 一致） |
| `WORKSPACE_LOCAL_PATH` | `/data/worker_workspaces` | Worker 本地工作区基路径 |
| `MINIO_ENDPOINT` | — | MinIO 地址（已有） |
| `MINIO_PORT` | `9000` | MinIO 端口（已有） |
| `MINIO_ACCESS_KEY` | — | MinIO 访问密钥（已有） |
| `MINIO_SECRET_KEY` | — | MinIO 秘密密钥（已有） |

### 删除的环境变量

| 变量 | 原位置 |
|------|--------|
| `NFS_MOUNT_PATH` | .env.server |
| `SHARED_WORKSPACE_PATH` | .env.server |

---

## 异常处理

| 场景 | 处理 |
|------|------|
| MinIO 上传 workspace 失败（任务创建时） | 抛出错误，任务创建失败，前端提示；临时目录已清理 |
| Worker 下载 workspace 失败 | 清理本地目录，任务失败，日志记录 |
| Worker 上传 results 失败 | 日志警告，继续 postResult（reportContent 已内联，任务结果不丢失）；Server 侧无法做漏洞解析 |
| Server 下载 results 失败（漏洞解析时） | 日志警告，跳过漏洞解析，任务仍标记完成 |
| tar.gz 解压失败 | 同上，清理临时目录 |
| 任务取消时 MinIO 传输进行中 | finally 块清理本地目录；MinIO 侧不清理（结果对象可能不完整但不影响后续） |
| MinIO workspace bucket 不存在 | Worker 启动时 `ensureWorkspaceBucket()` **阻塞完成后**再调用 `server.listen()`，确保 bucket 就绪后才接受任务 |
| 大代码库上传超时（HTTP 层） | 任务创建 HTTP 请求在 MinIO 上传期间阻塞；需确保反向代理超时 >= `WORKSPACE_UPLOAD_TIMEOUT_MS`（默认 10min）；nginx 配置 `proxy_read_timeout 600s` |

---

## 与原 rsync 方案对比

| | rsync + NFS 方案 | MinIO 方案（本方案） |
|---|---|---|
| NFS 依赖 | 保留（结果回写仍需 NFS） | **彻底移除** |
| 改动范围 | 仅 Worker 侧 | Server + Worker 均需改 |
| Server 代码 | 不变 | task-creation、execute route、result route 均需改 |
| 传输方式 | rsync 增量同步 | tar.gz 全量打包/解包 |
| 重试支持 | NFS 路径始终可用 | MinIO 原始 workspace 保留，可重新下载 |
| 运维复杂度 | NFS 挂载 + rsync + 磁盘空间 | MinIO bucket 管理 |
| 部署约束 | Server/Worker 必须共享 NFS | Server/Worker 只需访问同一 MinIO |

---

## 实施顺序

建议按以下顺序实施，每步可独立验证：

1. **Step 3** — MinIO workspace 模块（Server 侧），可独立测试上传/下载
2. **Step 6a** — MinIO workspace 模块（Worker 侧），可独立测试上传/下载
3. **Step 1 + 2** — 类型定义 + 数据库迁移
4. **Step 4** — 任务创建流程改造，验证上传到 MinIO
5. **Step 5** — 任务调度改造，验证 payload 传递 MinIO key
6. **Step 6b + 6c** — Worker 端改造，验证下载/执行/上传
7. **Step 7** — Server 结果处理改造，验证漏洞解析
8. **Step 8** — 清理 NFS 代码
9. **Step 9** — 部署配置变更

---

## 验证方式

1. 创建任务 → 验证 workspace 上传到 MinIO `workspaces/{taskId}.tar.gz`，`TaskInstance.workspaceStorageKey` 已写入
2. 执行任务 → Worker 日志显示从 MinIO 下载 workspace → opencode 在本地路径执行 → results 上传到 MinIO `results/{taskId}.tar.gz`
3. 任务完成 → `TaskInstance.resultStorageKey` 已写入 → Server 从 MinIO 下载 results → 漏洞解析正常 → 漏洞入库
4. 任务重试 → Worker 从 MinIO 重新下载原始 workspace（`workspaces/` 对象不变，`workspaceStorageKey` 复用）
5. 确认 `NFS_MOUNT_PATH` 不再被任何代码引用（grep 结果为 0）
6. 删除 NFS 挂载后，所有功能正常
