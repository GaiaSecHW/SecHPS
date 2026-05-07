

---

## 项目代号：**CodeSwarm**

### 1. 系统目标
- 用户通过API提交任务，指定需求、Skills、MCP工具。
- **任务分发系统（编排器）** 将任务分发到**智能体集群**中的多个工作节点。
- 每个工作节点运行一个 **Worker Daemon**，管理本机多个 OpenCode 进程。
- 工作节点通过**共享文件系统**获取被测项目文件，通过**网络协议**与编排器通信。
- 任务完成后清理工作区，流式返回结果。

### 1.1 整体架构
```
┌──────────────────────────────────────────┐
│         任务分发系统 (Machine A)          │
│  ┌──────────┐  ┌─────┐  ┌─────────────┐ │
│  │ FastAPI   │  │Redis│  │ 任务调度器   │ │
│  │ REST/WS   │  │     │  │ (Dispatcher)│ │
│  └─────┬────┘  └──┬──┘  └──────┬──────┘ │
│        └───────┬───┘             │        │
│                │                 │        │
└────────────────┼─────────────────┼────────┘
                 │    网络协议      │
          ┌──────┴─────────────────┴──────┐
          │         Message Bus            │
          │   (Redis Pub/Sub 或 gRPC)      │
          └──┬──────────┬──────────┬──────┘
             │          │          │
     ┌───────┴───┐ ┌───┴───────┐ ┌┴──────────┐
     │ Agent Node│ │ Agent Node│ │ Agent Node│
     │ (Machine B)│ │(Machine C)│ │(Machine D)│
     │           │ │           │ │           │
     │ Worker    │ │ Worker    │ │ Worker    │
     │ Daemon    │ │ Daemon    │ │ Daemon    │
     │ ├─OC proc1│ │ ├─OC proc1│ │ ├─OC proc1│
     │ ├─OC proc2│ │ ├─OC proc2│ │ └─OC proc2│
     │ └─OC proc3│ │ └─OC proc3│ │           │
     │           │ │           │ │           │
     │ NFS/S3    │ │ NFS/S3    │ │ NFS/S3    │
     │ Mount     │ │ Mount     │ │ Mount     │
     └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
           └──────────────┴─────────────┘
                    共享文件存储
              (NFS / S3 / MinIO)
```

---

### 2. 技术选型
| 组件              | 技术                                                         |
| ----------------- | ------------------------------------------------------------ |
| 智能体运行时      | [OpenCode](https://github.com/anomalyco/opencode)，通过 ACP 协议 (stdin/stdout nd-JSON) 交互 |
| 编排器 + Worker   | **TypeScript + Fastify**（复用 ACEHarness 的 ACP、进程管理、事件流模式） |
| 进程管理          | Node.js `child_process.spawn`（参考 ACEHarness `acp-engine.ts`） |
| 隔离方式          | 文件系统级：每个任务拷贝独立工作区目录                         |
| 共享文件存储      | NFS（局域网）或 S3/MinIO（跨地域），存放被测项目文件          |
| 任务队列/状态     | Redis（任务队列、节点状态、事件流管道）                       |
| 节点间通信        | HTTP（任务分发、事件回传、心跳）+ Redis Pub/Sub（事件广播）   |
| Schema 校验       | Zod（全链路类型安全：API → 协议 → Worker payload）            |
| 实时通信          | WebSocket（向用户推送输出流）                                 |
| 引擎复用          | Engine Pool + TTL（参考 ACEHarness `engine-factory.ts`）      |
| 项目结构          | monorepo（pnpm workspace），共享 `packages/types`、`packages/acp` |

---

### 3. 核心数据结构（Zod Schema → TypeScript）

#### 3.1 Skill 定义
```typescript
// 存储在 skills_repo/ 下，以 skill_id 为子目录
// OpenCode 要求文件名为 SKILL.md，带 YAML frontmatter
interface SkillDef {
  id: string;               // "data-analysis"，1-64字符
  version: string;          // "1.2.0"
  name: string;             // frontmatter name
  description: string;      // frontmatter description（必填）
  requiresMcp: string[];    // 所需MCP服务名
  mdContent: string;        // 完整 Markdown 内容
  // 文件路径: skills_repo/{id}/{version}/SKILL.md
}
```

#### 3.2 MCP 服务注册
```typescript
interface MCPServiceLocal {
  type: "local";
  command: string[];           // ["npx", "-y", "@modelcontextprotocol/server-postgres"]
  environment: Record<string, string>;
  enabled: boolean;
  timeout: number;             // 毫秒，默认 5000
}

interface MCPServiceRemote {
  type: "remote";
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  timeout: number;
}

type MCPService = MCPServiceLocal | MCPServiceRemote;
```

#### 3.3 任务请求
```typescript
const TaskRequestSchema = z.object({
  instruction: z.string(),
  projectId: z.string(),
  skills: z.array(z.string()).default([]),
  skillVersion: z.string().default("latest"),
  mcps: z.array(z.string()).default([]),
  model: z.string().default("anthropic/claude-sonnet-4"),
  apiKey: z.string().optional(),
  timeoutSec: z.number().default(300),
  mcpEnvOverrides: z.record(z.string()).default({}),
});
type TaskRequest = z.infer<typeof TaskRequestSchema>;
```

#### 3.4 任务状态
```typescript
enum TaskState {
  QUEUED = "queued",
  DISPATCHED = "dispatched",
  BUILDING = "building",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

interface Task {
  taskId: string;
  state: TaskState;
  request: TaskRequest;
  assignedNode: string | null;
  workspacePath: string | null;
  result: string | null;
  error: string | null;
  createdAt: Date;
}
```

#### 3.5 Agent Node
```typescript
interface AgentNode {
  nodeId: string;               // "agent-node-01"
  address: string;              // "10.0.1.20:8080"
  status: "online" | "offline" | "draining";
  maxConcurrent: number;        // 最大并行任务数，默认 5
  currentTasks: number;
  capabilities: string[];       // 可用 MCP、特殊硬件等
  lastHeartbeat: Date;
}
```

#### 3.6 Worker 通信协议
```typescript
// 编排器 → Worker：任务分发
interface TaskPayload {
  taskId: string;
  instruction: string;
  projectPath: string;          // 共享存储上的路径
  skills: Array<{ id: string; version: string }>;
  mcps: Record<string, MCPService>;
  model: string;
  timeoutSec: number;
  apiKey: string;
}

// Worker → 编排器：事件回传
interface WorkerEvent {
  taskId: string;
  nodeId: string;
  events: Array<{
    type: "agent_message_chunk" | "tool_call" | "tool_call_update" | "error";
    content?: string;
    tool?: string;
    input?: unknown;
    output?: string;
    timestamp: string;
  }>;
}

// Worker → 编排器：任务结果
interface TaskResult {
  taskId: string;
  nodeId: string;
  status: "completed" | "failed";
  result?: string;
  error?: string;
}
```
---

### 4. 组件拆解

系统分为**编排器侧**（Machine A）和 **Worker 侧**（Machine B/C/D...）两大模块。

#### 4.1 编排器侧组件

##### 4.1.1 任务调度器 (Dispatcher)
- **职责**：接收用户 API 请求，将任务分发到合适的 Agent Node。
- **调度策略**：
  - 轮询（Round-Robin）：简单均匀分配。
  - 最少负载优先：选择 `current_tasks < max_concurrent` 且负载最低的节点。
  - 能力匹配：根据任务所需 MCP 和节点 `capabilities` 匹配。
- **通信方式**：通过 Redis Pub/Sub 向 Worker 发布任务，或直接 HTTP POST 到 Worker。
- **节点管理**：维护在线节点列表，心跳超时（30s）标记为 offline。

##### 4.1.2 事件聚合器 (Event Aggregator)
- **职责**：收集所有 Worker 回传的事件，按 task_id 聚合，推送 WebSocket。
- **实现**：Worker 通过 HTTP POST 将 ACP 事件回传到编排器 `/api/v1/worker/event`。
- **事件流**：
  ```
  Worker → HTTP POST → 编排器 Event Aggregator → WebSocket → 用户
  ```
- 支持后加入的 WebSocket 客户端获取历史输出（从 Redis 缓存读取）。

##### 4.1.3 技能仓库 (Skill Registry)
- **实现**：共享存储目录 `/shared/skills_registry/`，所有节点可读。
  ```
  /shared/skills_registry/
    data-analysis/
      1.0.0/SKILL.md
      1.2.0/SKILL.md
    code-review/
      2.0.0/SKILL.md
  ```
- **SKILL.md 格式**：YAML frontmatter + Markdown 内容。
- **注入方式**：Worker 从共享存储拷贝 SKILL.md 到工作区 `.opencode/skills/<id>/SKILL.md`。

##### 4.1.4 MCP 注册中心
- **实现**：配置文件 `mcp_services.yaml`，编排器加载后随任务分发发送给 Worker。
- 配置格式对齐 OpenCode 的 `"mcp"` 字段（type: `local` / `remote`）。

##### 4.1.5 共享文件管理
- **职责**：管理被测项目文件在共享存储上的生命周期。
- **共享存储**：NFS 挂载到所有节点（`/shared/projects/`），或 S3/MinIO。
- **项目上传**：用户通过 API 上传或关联 Git 仓库，编排器同步到共享存储。
- **Worker 读取**：Worker 从共享存储拷贝项目文件到本地工作区。

#### 4.2 Worker 侧组件

##### 4.2.1 Worker Daemon
- **职责**：每个 Agent Node 上运行的常驻进程，管理本机 OpenCode 实例。
- **核心功能**：
  1. 启动时向编排器注册（`POST /api/v1/worker/register`），上报能力。
  2. 定时心跳（每 10s，`POST /api/v1/worker/heartbeat`）。
  3. 监听任务分发通道（Redis Pub/Sub 或长轮询）。
  4. 收到任务后，调用环境工厂准备工作区，启动 OpenCode 进程。
  5. 通过 ACP 协议与 OpenCode 交互，将事件回传编排器。
  6. 任务完成后清理工作区，上报结果。
- **并发控制**：本机最大并行任务数 `max_concurrent`，超出则拒绝任务。

##### 4.2.2 环境工厂 (Environment Factory)
- **职责**：为每个任务在**本地**创建独立工作区，组装 Skills 和 MCP 配置。
- **流程**：
  1. 从共享存储拷贝项目文件到本地工作区 `/data/task_workspaces/<task_id>/`。
  2. 拷贝 Skills 到 `.opencode/skills/`。
  3. 生成 `opencode.json`（含 MCP 配置、模型、权限）。
  4. 写入 `instruction.txt`。

##### 4.2.3 进程管理器 (Process Manager)
- **职责**：管理本机多个 OpenCode 子进程，通过 ACP 协议双向通信。
- **核心机制**：每个任务启动一个 `opencode acp --cwd <workspace>` 子进程。
- **事件回传**：从 ACP stdout 读取事件，通过 HTTP POST 回传编排器。
- **Engine Pool**（可选）：空闲进程可被新任务复用（需清理后重置）。

##### 4.2.4 流式输出处理
- Worker 从 ACP stdout 读取 nd-JSON 事件流，按类型回传编排器：
  - `agent_message_chunk` → 文本输出
  - `tool_call` → 工具调用
  - `tool_call_update` → 工具结果
  - `error` → 错误信息

---

### 5. 分布式配置注入与文件传递

#### 共享文件存储
- **用途**：存放被测项目源码、Skills 仓库、MCP 配置等，所有 Agent Node 共享读取。
- **方案选择**：
  - **NFS**（推荐，局域网）：所有节点挂载同一 NFS 卷到 `/shared/`，读写一致性好。
  - **S3/MinIO**（跨地域）：适合节点分布在不同机房，需下载到本地工作区。
- **目录结构**：
  ```
  /shared/
    projects/                  # 被测项目
      project-a/               # 每个项目一个目录
        src/...
        tests/...
    skills_registry/           # Skills 仓库
      data-analysis/1.2.0/SKILL.md
    mcp_services.yaml          # MCP 配置（全局）
  ```

#### 任务分发协议
编排器与 Worker 之间的通信协议：

**任务分发**（编排器 → Worker）：
```json
// Redis channel: "task:dispatch:{node_id}" 或 HTTP POST
{
  "task_id": "uuid",
  "instruction": "...",
  "project_path": "/shared/projects/project-a",
  "skills": [{"id": "data-analysis", "version": "1.2.0"}],
  "mcps": {"postgresql-readonly": {"type": "local", "command": [...], ...}},
  "model": "anthropic/claude-sonnet-4",
  "timeout_sec": 300,
  "api_key": "sk-xxx"
}
```

**事件回传**（Worker → 编排器）：
```json
// HTTP POST /api/v1/worker/event
{
  "task_id": "uuid",
  "node_id": "agent-node-01",
  "events": [
    {"type": "agent_message_chunk", "content": "...", "timestamp": "..."},
    {"type": "tool_call", "tool": "bash", "input": {...}, "timestamp": "..."}
  ]
}
```

**任务结果**（Worker → 编排器）：
```json
// HTTP POST /api/v1/worker/result
{
  "task_id": "uuid",
  "node_id": "agent-node-01",
  "status": "completed",
  "result": "...",
  "error": null
}
```

#### Worker 本地工作区隔离
- Worker 收到任务后，从 `/shared/projects/{project}/` 拷贝到本地 `/data/task_workspaces/{task_id}/`。
- 拷贝使用并行文件 worker 加速。
- 所有 OpenCode 文件操作（读、写、工具调用）都在本地拷贝内进行。
- 任务完成后删除本地拷贝。共享存储上的源项目**永远不被修改**。

#### Skill 注入
- Worker 从 `/shared/skills_registry/` 拷贝 SKILL.md 到本地工作区 `.opencode/skills/<id>/SKILL.md`。
- OpenCode 自动扫描 `.opencode/skills/` 发现并加载。

#### MCP 配置注入
- 编排器在任务分发时已解析好 MCP 配置，随任务 payload 发送给 Worker。
- Worker 将配置写入工作区 `opencode.json`。
- OpenCode 启动 `opencode acp --cwd <workspace>` 时自动加载。

#### Engine Pool 复用（第二版优化）
- Worker 内部维护空闲 `opencode acp` 进程池，任务间清理 Skills/MCP 后复用。
- 节省冷启动时间（约 1-2s）。
- 待验证项：Skill 热重载、MCP 热替换、Session 清理。
- 第一版每任务独立进程，验证后引入 Pool。

---

### 6. 任务执行全流程（分布式时序图）

```
用户         编排器          Worker Daemon          共享存储      OpenCode(ACP)
(Machine A)                (Machine B)
 |              |                 |                    |              |
 |--POST /task>|                 |                    |              |
 |<--task_id---|                 |                    |              |
 |             |                 |                    |              |
 |             |--分发任务------->| (Redis/HTTP)       |              |
 |             |   (含MCP配置,   |                    |              |
 |             |    Skills列表)  |                    |              |
 |             |                 |                    |              |
 |             |                 |--拷贝项目---------->|              |
 |             |                 |  /shared/project   |              |
 |             |                 |  → /data/task_ws/  |              |
 |             |                 |                    |              |
 |             |                 |--拷贝Skills-------->|              |
 |             |                 |  /shared/skills/   |              |
 |             |                 |  → .opencode/skills|              |
 |             |                 |                    |              |
 |             |                 |--生成opencode.json |              |
 |             |                 |                    |              |
 |             |                 |--启动ACP进程------>|              |
 |             |                 |                    |--opencode acp|
 |             |                 |                    |  加载Config  |
 |             |                 |                    |  启动MCP     |
 |             |                 |                    |              |
 |             |                 |--ACP stdin:指令--->|--stdin ----->|
 |             |                 |                    |  执行任务    |
 |             |                 |                    |              |
 |--WS连接---->|                 |                    |              |
 |             |<--HTTP POST事件-|                    |              |
 |             |  (ACP events)   |                    |<--stdout-----|
 |<--事件流----|                 |                    |              |
 |             |                 |                    |              |
 |             |<--HTTP POST结果-|                    |              |
 |             |  (completed)    |                    |  进程退出    |
 |<--任务完成--|                 |                    |              |
 |             |                 |--删除本地工作区     |              |
```

---

### 7. API 定义

#### 7.1 提交任务
```
POST /api/v1/task
Body: {
  "instruction": "string",
  "skills": ["skill_id"],
  "mcps": ["mcp_name"],
  "model": "anthropic/claude-sonnet-4",
  "timeout_sec": 300,
  "mcp_env_overrides": {...}  // 可选
}
Response: {
  "task_id": "uuid",
  "status": "queued"
}
```

#### 7.2 查询任务状态
```
GET /api/v1/task/{task_id}
Response: {
  "task_id": "...",
  "state": "running",
  "result": null
}
```

#### 7.3 WebSocket 输出流
```
WS /ws/task/{task_id}
消息格式 (JSON):
{
  "type": "output",      // output | status | error | complete
  "data": "文本或结构化信息",
  "timestamp": "ISO8601"
}
```
连接建立后，自动推送历史已产生输出（若任务已运行）并实时跟随。

---

### 8. 异常处理与资源回收

**Worker 侧**：
- 任务超时：Worker 定时检查，超时则 `proc.terminate()` 终止子进程，状态 `TIMEOUT`，回传编排器。
- 构建失败：环境工厂异常，状态 `FAILED`，清理本地工作区，回传编排器。
- 进程崩溃：ACP stdout 流断开或子进程退出码非零，状态 `FAILED`，回传编排器。
- 孤儿工作区清理：定期扫描本地 `/data/task_workspaces/` 下大于1小时的目录。
- 孤儿进程清理：定期扫描本地活跃进程列表，终止超时未响应的僵尸进程。

**编排器侧**：
- Worker 掉线：心跳超时（30s），标记节点 `offline`，其上任务标记 `FAILED`。
- 任务重分发：Worker 掉线后，其未完成任务可重新分发到其他节点。
- 崩溃恢复：编排器重启后从 Redis 恢复任务状态，重新调度未完成任务。
- 共享存储清理：定期清理 `/shared/projects/` 中无关联任务的临时上传文件。

---

### 9. 部署结构

```
Machine A (编排器)：
├── FastAPI 服务
├── Redis 服务
├── 文件系统：
│   /data/mcp_services.yaml   (MCP服务注册)
│   /data/runs/               (运行记录，状态持久化)

Machine B/C/D... (Agent Node)：
├── Worker Daemon 进程
├── OpenCode CLI (宿主机安装)
├── NFS 挂载: /shared/ → 共享存储
├── 本地文件系统：
│   /data/task_workspaces/    (临时工作区，任务后删除)

共享存储 (NFS Server / S3)：
├── /shared/projects/         (被测项目文件)
├── /shared/skills_registry/  (技能仓库，由Git同步)
├── /shared/mcp_services.yaml (MCP配置)
```

---

### 10. 关键代码骨架（TypeScript）

代码分为**编排器侧**和 **Worker 侧**两套独立进程，monorepo 共享类型包。

#### 10.1 编排器侧

```typescript
// packages/orchestrator/src/dispatcher.ts — 任务调度器
import { Redis } from "ioredis";
import { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import { TaskPayloadSchema, type Task, type TaskRequest, type AgentNode } from "@codeswarm/types";

class Dispatcher {
  private nodes = new Map<string, AgentNode>();

  constructor(private redis: Redis, private app: FastifyInstance) {}

  async submitTask(request: TaskRequest): Promise<string> {
    const taskId = uuid();
    const task: Task = {
      taskId, state: "queued", request,
      assignedNode: null, workspacePath: null,
      result: null, error: null, createdAt: new Date(),
    };
    await this.redis.lpush("task:queue", JSON.stringify(task));
    return taskId;
  }

  async dispatchLoop() {
    while (true) {
      const [, raw] = await this.redis.brpop("task:queue", 5);
      if (!raw) continue;
      const task: Task = JSON.parse(raw);
      const node = this.selectNode(task);
      if (!node) {
        await this.redis.lpush("task:queue", raw); // 放回队列
        continue;
      }
      task.assignedNode = node.nodeId;
      task.state = "dispatched";
      await this.sendToWorker(node, task);
      await this.saveTask(task);
    }
  }

  private selectNode(task: Task): AgentNode | null {
    const available = [...this.nodes.values()]
      .filter(n => n.status === "online" && n.currentTasks < n.maxConcurrent);
    if (!available.length) return null;
    return available.reduce((a, b) => a.currentTasks <= b.currentTasks ? a : b);
  }

  private async sendToWorker(node: AgentNode, task: Task) {
    const payload = this.buildPayload(task);
    await fetch(`http://${node.address}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  private buildPayload(task: Task): z.infer<typeof TaskPayloadSchema> {
    // 解析 Skills 依赖、MCP 配置，打包为 Worker payload
    const mergedMcps = [...task.request.mcps];
    for (const skillId of task.request.skills) {
      const skillDef = getSkill(skillId, task.request.skillVersion);
      mergedMcps.push(...(skillDef?.requiresMcp ?? []));
    }
    const mcps: Record<string, MCPService> = {};
    for (const name of new Set(mergedMcps)) {
      mcps[name] = resolveMcp(name, task.request.mcpEnvOverrides);
    }
    return {
      taskId: task.taskId,
      instruction: task.request.instruction,
      projectPath: `/shared/projects/${task.request.projectId}`,
      skills: task.request.skills.map(id => ({ id, version: task.request.skillVersion })),
      mcps,
      model: task.request.model,
      timeoutSec: task.request.timeoutSec,
      apiKey: task.request.apiKey ?? process.env.DEFAULT_API_KEY!,
    };
  }
}

// packages/orchestrator/src/server.ts — HTTP 服务 + 事件聚合
import Fastify from "fastify";
import websocket from "@fastify/websocket";

const app = Fastify();
app.register(websocket);
const redis = new Redis(process.env.REDIS_URL!);
const dispatcher = new Dispatcher(redis, app);

// 用户提交任务
app.post("/api/v1/task", async (req) => {
  const request = TaskRequestSchema.parse(req.body);
  const taskId = await dispatcher.submitTask(request);
  return { taskId, status: "queued" };
});

// Worker 回传事件
app.post("/api/v1/worker/event", async (req) => {
  const event = WorkerEventSchema.parse(req.body);
  await redis.rpush(`task:history:${event.taskId}`, JSON.stringify(event));
  await redis.publish(`task:events:${event.taskId}`, JSON.stringify(event));
});

// Worker 回传结果
app.post("/api/v1/worker/result", async (req) => {
  const result = TaskResultSchema.parse(req.body);
  await redis.set(`task:result:${result.taskId}`, JSON.stringify(result));
  await redis.publish(`task:events:${result.taskId}`, JSON.stringify({
    taskId: result.taskId, nodeId: result.nodeId,
    events: [{ type: "task_complete", status: result.status }],
  }));
});

// WebSocket 输出流
app.register(async function (fastify) {
  fastify.get("/ws/task/:taskId", { websocket: true }, (socket, req) => {
    const { taskId } = req.params as { taskId: string };

    // 1. 发送历史事件
    (async () => {
      const history = await redis.lrange(`task:history:${taskId}`, 0, -1);
      for (const item of history) socket.send(item);
    })();

    // 2. 订阅实时事件
    const sub = new Redis(process.env.REDIS_URL!);
    sub.subscribe(`task:events:${taskId}`);
    sub.on("message", (_, data) => socket.send(data));
    socket.on("close", () => sub.disconnect());
  });
});

// Worker 注册 + 心跳
app.post("/api/v1/worker/register", async (req) => { /* 注册节点 */ });
app.post("/api/v1/worker/heartbeat", async (req) => { /* 更新心跳 */ });

// 启动调度循环
dispatcher.dispatchLoop();
app.listen({ port: 3000, host: "0.0.0.0" });
```

#### 10.2 Worker 侧

```typescript
// packages/worker/src/daemon.ts — Worker Daemon 主进程
import Fastify from "fastify";
import { v4 as uuid } from "uuid";
import { EnvironmentFactory } from "./environment.js";
import { ProcessManager } from "./process-manager.js";
import type { TaskPayload, WorkerEvent, TaskResult } from "@codeswarm/types";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL!;
const NODE_ID = process.env.NODE_ID ?? `node-${uuid().slice(0, 8)}`;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT ?? "5");

class WorkerDaemon {
  private semaphore = new Semaphore(MAX_CONCURRENT);
  private envFactory = new EnvironmentFactory();
  private processMgr = new ProcessManager();

  async start() {
    await this.register();
    setInterval(() => this.heartbeat(), 10_000);

    const app = Fastify();
    app.post("/task", async (req, reply) => {
      const payload = TaskPayloadSchema.parse(req.body);
      if (!this.semaphore.tryAcquire()) {
        reply.code(503).send({ error: "at capacity" });
        return;
      }
      // 异步执行，立即返回 202
      this.executeTask(payload).finally(() => this.semaphore.release());
      reply.code(202).send({ status: "accepted" });
    });
    await app.listen({ port: 8080, host: "0.0.0.0" });
  }

  private async executeTask(payload: TaskPayload) {
    const { taskId } = payload;
    let workspace: string | undefined;
    try {
      // 1. 环境工厂：拷贝项目 + Skills + 生成配置
      workspace = await this.envFactory.build(payload);

      // 2. 启动 OpenCode ACP 进程
      const proc = await this.processMgr.start(taskId, workspace, payload.apiKey);

      // 3. 通过 ACP 发送指令
      await this.processMgr.sendInstruction(taskId, payload.instruction);

      // 4. 读取事件流，回传编排器
      for await (const event of this.processMgr.streamEvents(taskId)) {
        await this.postEvent(taskId, [event]);
      }

      // 5. 等待进程结束
      const exitCode = await proc.exitCode;
      await this.postResult({
        taskId, nodeId: NODE_ID,
        status: exitCode === 0 ? "completed" : "failed",
        error: exitCode !== 0 ? `exit code ${exitCode}` : undefined,
      });
    } catch (error: any) {
      await this.postResult({
        taskId, nodeId: NODE_ID, status: "failed", error: error.message,
      });
    } finally {
      if (workspace) await this.envFactory.cleanup(workspace);
      await this.processMgr.terminate(taskId);
    }
  }

  private async postEvent(taskId: string, events: WorkerEvent["events"]) {
    await fetch(`${ORCHESTRATOR_URL}/api/v1/worker/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, nodeId: NODE_ID, events }),
    });
  }

  private async postResult(result: TaskResult) {
    await fetch(`${ORCHESTRATOR_URL}/api/v1/worker/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
  }
}

// 简易信号量
class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private count: number) {}
  tryAcquire(): boolean {
    if (this.count > 0) { this.count--; return true; }
    return false;
  }
  release() { this.count++; this.queue.shift()?.(); }
}

// packages/worker/src/environment.ts — 环境工厂
import { cpSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from "fs";
import path from "path";

export class EnvironmentFactory {
  async build(payload: TaskPayload): Promise<string> {
    const workspace = path.join("/data/task_workspaces", payload.taskId);

    // 1. 从共享存储拷贝项目到本地
    cpSync(payload.projectPath, workspace, { recursive: true });

    // 2. 拷贝 Skills
    for (const skill of payload.skills) {
      const src = `/shared/skills_registry/${skill.id}/${skill.version}/SKILL.md`;
      const dstDir = path.join(workspace, ".opencode/skills", skill.id);
      mkdirSync(dstDir, { recursive: true });
      copyFileSync(src, path.join(dstDir, "SKILL.md"));
    }

    // 3. 生成 opencode.json
    writeFileSync(path.join(workspace, "opencode.json"), JSON.stringify({
      model: payload.model,
      mcp: payload.mcps,
      permission: { allow: ["bash", "edit", "view", "grep", "ls", "glob"] },
    }, null, 2));

    return workspace;
  }

  async cleanup(workspacePath: string): Promise<void> {
    rmSync(workspacePath, { recursive: true, force: true });
  }
}

// packages/worker/src/process-manager.ts — 进程管理（参考 ACEHarness acp-engine.ts）
import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";

interface ProcessEntry {
  process: ChildProcess;
  workspace: string;
  createdAt: number;
}

export class ProcessManager {
  private processes = new Map<string, ProcessEntry>();

  async start(taskId: string, workspace: string, apiKey: string): Promise<ChildProcess> {
    const env = { ...process.env, ANTHROPIC_API_KEY: apiKey, IS_SANDBOX: "1" };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_SESSION;

    const proc = spawn("opencode", ["acp", "--cwd", workspace], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    this.processes.set(taskId, { process: proc, workspace, createdAt: Date.now() });
    return proc;
  }

  async sendInstruction(taskId: string, instruction: string): Promise<void> {
    const entry = this.processes.get(taskId);
    if (!entry) throw new Error(`No process for task ${taskId}`);
    const msg = JSON.stringify({ method: "message", params: { content: instruction } }) + "\n";
    entry.process.stdin!.write(msg);
  }

  async *streamEvents(taskId: string): AsyncGenerator<any> {
    const entry = this.processes.get(taskId);
    if (!entry) return;
    const rl = createInterface({ input: entry.process.stdout! });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line); }
      catch { yield { type: "raw", data: line }; }
    }
  }

  async terminate(taskId: string): Promise<void> {
    const entry = this.processes.get(taskId);
    if (!entry) return;
    entry.process.kill();
    this.processes.delete(taskId);
  }
}
```

#### 10.3 项目结构

```
codeswarm/
├── packages/
│   ├── types/              # @codeswarm/types — Zod schema + TypeScript 接口
│   │   └── src/
│   │       └── schemas.ts  # TaskRequest, TaskPayload, WorkerEvent, TaskResult
│   ├── acp/                # @codeswarm/acp — ACP 协议封装（参考 ACEHarness）
│   │   └── src/
│   │       └── acp-client.ts
│   ├── orchestrator/       # 编排器服务
│   │   └── src/
│   │       ├── dispatcher.ts
│   │       ├── server.ts
│   │       └── index.ts
│   └── worker/             # Worker Daemon
│       └── src/
│           ├── daemon.ts
│           ├── environment.ts
│           ├── process-manager.ts
│           └── index.ts
├── configs/
│   ├── mcp_services.yaml
│   └── agents/
├── skills/                 # Skills 仓库（同步到共享存储）
├── pnpm-workspace.yaml
├── tsconfig.json
└── package.json
```

---

### 11. 用户界面交互示例

用户通过CLI或Web提交：
```bash
curl -X POST https://swarm/api/v1/task \
  -H "Content-Type: application/json" \
  -d '{
    "instruction": "查询用户表结构，生成一份API文档",
    "skills": ["api-doc-gen"],
    "mcps": ["postgresql-readonly"]
  }'
```
然后通过WebSocket实时观察OpenCode的思考、工具调用和最终回复。

---

### 12. 扩展与维护

- **Skills更新**：通过Git推送到共享存储 `/shared/skills_registry/`，Worker 下次拷贝时自动使用新版本。
- **MCP扩展**：修改编排器侧 `mcp_services.yaml`，无需重启 Worker，随任务分发下发新配置。
- **模型切换**：在任务请求中指定 `model` 字段，Worker 写入 `opencode.json` 生效。
- **水平扩容**：新增 Agent Node → 安装 OpenCode + Worker Daemon → 注册到编排器，无需改代码。
- **节点缩容**：编排器标记节点 `draining` → 不再分发新任务 → 等待运行中任务完成 → 节点下线。
- **跨地域部署**：共享存储从 NFS 切换为 S3/MinIO，Worker 下载项目文件到本地。

---

此方案完整描述了基于方案A的智能体集群动态挂载系统，从架构到代码细节均已到可执行粒度，可直接交付AI编程工具（如Cursor、Copilot）分模块实现。