# 数据回流模块代码审查报告

> 审查日期：2026-06-03
> 审查范围：CodeSwarm 数据回流模块（Worker 回调 + 任务分发 + 漏洞解析）
> 审查状态：待评审

## 审查文件清单

### API 端点
| 文件 | 说明 |
|------|------|
| `src/app/api/codeswarm/worker/event/route.ts` | Worker 事件上报 (POST) |
| `src/app/api/codeswarm/worker/heartbeat/route.ts` | Worker 心跳注册 (POST) |
| `src/app/api/codeswarm/worker/result/route.ts` | Worker 结果回调 + 漏洞解析 (POST) |
| `src/app/api/codeswarm/tasks/route.ts` | 任务列表/创建/批量删除 |
| `src/app/api/codeswarm/tasks/[taskId]/route.ts` | 任务详情/删除 |
| `src/app/api/codeswarm/tasks/[taskId]/dispatch/route.ts` | 任务分发 |

### 前端页面
| 文件 | 说明 |
|------|------|
| `src/app/dashboard/codeswarm/page.tsx` | CodeSwarm 管理面板 |

---

## 一、权限控制

### 【高】event 和 result 接口完全没有认证

**文件**: `src/app/api/codeswarm/worker/event/route.ts`、`src/app/api/codeswarm/worker/result/route.ts`

**问题**: 事件上报和结果回调接口没有任何认证机制。任何人都可以伪造 Worker 身份向 Server 发送虚假事件或伪造任务结果。虽然这些是机器间 API，但缺少基本身份验证意味着攻击者可以：
1. 伪造任务完成，注入虚假漏洞数据
2. 注入任意事件数据到日志系统
3. 伪造 session_created 事件覆盖其他任务的 sessionId

**当前代码**:
```ts
// event/route.ts — 无认证
export async function POST(request: Request) {
  const body = await request.json();
  // 直接处理，无身份验证
}

// result/route.ts — 无认证
export async function POST(request: Request) {
  const body = await request.json();
  // 直接更新任务状态
}
```

**建议修复**: 使用 Worker Token 验证（heartbeat 已有 `verifyWorkerToken` 基础设施），在 event 和 result 接口中添加相同的 Token 校验。

---

### 【高】dispatch 和 tasks 接口没有认证

**文件**: `src/app/api/codeswarm/tasks/[taskId]/dispatch/route.ts`、`src/app/api/codeswarm/tasks/route.ts`

**问题**: dispatch 端点无认证，任何人可以触发任务分发。tasks 的 GET/DELETE/POST 也没有认证，意味着：
1. 未认证用户可以列出所有任务（含 apiKey 字段）
2. 未认证用户可以删除任务
3. 未认证用户可以创建任意任务

**建议**: 至少对 tasks 管理接口添加管理员 JWT 认证。dispatch 可以保留为内部调用（如果仅由 Dispatcher 触发），但需要网络层限制。

---

### 【中】heartbeat 的 Token 验证是可选的

**文件**: `src/app/api/codeswarm/worker/heartbeat/route.ts:17-24`

**问题**: Token 验证存在但不强制。未携带 Token 的 Worker 仍然可以注册心跳并获得新 Token。这意味着攻击者可以注册伪造 Worker 节点。

**建议**: 在 Token 基础设施成熟后，强制要求所有 Worker 首次注册时使用预共享密钥。

---

## 二、API 异常处理

### 【中】runOpencodeParse 记录了完整的指令内容

**文件**: `src/app/api/codeswarm/worker/result/route.ts:178`

**问题**: 日志中包含完整的 opencode 执行指令，可能包含敏感信息（如 Skill 内容、项目路径等）。

```ts
logger.info(LOG_MODULES.CODESWARM, `[VulnParse:${taskId}] 执行: cmd=${cmd}, args=${isWindows ? finalArgs.join(' ') : finalArgs[1]?.substring(0, 80)}`);
```

**建议**: 截断或脱敏指令内容。

---

### 【中】result 接口的漏洞入库使用 localhost 调用，无错误恢复

**文件**: `src/app/api/codeswarm/worker/result/route.ts:419-448`

**问题**: 漏洞入库通过 `fetch('http://localhost:3000/api/v1/vulnerabilities')` 调用自身 API。如果此调用失败（如服务暂时不可用），整个解析结果丢失，没有重试机制。

**建议**: 添加重试逻辑，或将解析结果暂存后异步重试入库。

---

### 【低】批量删除任务不释放 Worker 负载

**文件**: `src/app/api/codeswarm/tasks/route.ts:41-67`

**问题**: 单个任务删除（`[taskId]/route.ts`）会递减 `Worker.currentTasks` 并通知 Dispatcher，但批量删除直接删除任务，不释放关联 Worker 的负载。这会导致 Worker 显示的负载计数虚高。

**建议**: 批量删除前收集受影响的 Worker，删除后递减对应负载。

---

## 三、业务逻辑正确性

### 【高】`vulnParseInProgress` 是进程内 Set，多实例部署时失效

**文件**: `src/app/api/codeswarm/worker/result/route.ts:15`

**问题**: `const vulnParseInProgress = new Set<string>()` 是模块级内存变量。在多实例部署（负载均衡）场景下，每个实例有独立的 Set，导致：
1. 同一 taskId 的 result 回调被路由到不同实例时，重复触发漏洞解析
2. 服务器重启后 Set 清空，正在进行的解析状态丢失

**建议**: 使用 Redis SET 或数据库字段替代内存 Set 做去重。

---

### 【高】漏洞解析是 fire-and-forget，无法取消

**文件**: `src/app/api/codeswarm/worker/result/route.ts:295-457`

**问题**: `executeVulnerabilityParseAsync` 完全是异步的 fire-and-forget 调用。它会：
1. 拷贝 Skill 文件到工作区
2. 上传报告到 MinIO
3. 启动 `opencode` 子进程（最长 1 小时）
4. 解析 JSON 结果
5. 调用漏洞入库 API

如果任务在解析过程中被删除，或者服务器关闭，子进程成为孤儿进程。没有取消机制。

**建议**: 添加 AbortController 支持，在任务删除时取消正在进行的解析。

---

### 【中】event 接口对事件数组大小无限制

**文件**: `src/app/api/codeswarm/worker/event/route.ts:37-41`

**问题**: `events` 数组没有大小限制。恶意 Worker 可以在一次请求中发送数千个事件，导致 `createMany` 超时或数据库压力过大。

**建议修复**:
```ts
if (events?.length) {
  if (events.length > 100) {
    return NextResponse.json({ error: 'Too many events (max 100)' }, { status: 400 });
  }
  eventList.push(...events);
}
```

---

### 【中】dispatch 发送 apiKey 到 Worker 使用明文 HTTP

**文件**: `src/app/api/codeswarm/tasks/[taskId]/dispatch/route.ts:93-110`

**问题**: 任务 payload 包含 `apiKey` 字段，通过 HTTP（非 HTTPS）发送到 Worker 地址。即使 Worker 在内网，API Key 在网络中明文传输仍有风险。

**建议**: 短期：确保 Worker 通信走内网隔离环境。长期：使用短期 Token 替代长期 API Key。

---

### 【中】心跳中的同地址冲突检测使用 LIKE 匹配，可能误杀

**文件**: `src/app/api/codeswarm/worker/heartbeat/route.ts:76-82`

**问题**: 使用 `address LIKE '%${primaryAddr}%'` 做冲突检测。如果主地址是 `10.0.1.1`，它也会匹配 `10.0.1.10`、`10.0.1.100` 等，导致不同 Worker 被误杀。

**建议**: 使用精确匹配或正则表达式（如 `LIKE '%,${primaryAddr},%'` 或分割后比对）。

---

### 【低】ID 生成使用 `Math.random()`，不保证唯一性

**文件**: 多处使用 `${Date.now()}-${Math.random().toString(36).slice(2, 9)}` 生成 ID

**问题**: `Math.random()` 不是密码学安全的，且在高并发下 `Date.now()` 可能重复。虽然 ID 冲突概率极低，但不为零。

---

## 四、React 最佳实践

### 【低】CodeSwarm 管理面板使用动态导入，架构合理

**文件**: `src/app/dashboard/codeswarm/page.tsx`

**优点**: 所有重型组件（WorkerNodesTable、TaskDebugPanel、CodedmapDebugPanel 等）使用 `dynamic(() => import(...), { ssr: false })`，避免 SSR 问题并优化首屏加载。

---

## 五、表单校验

### 【中】result 接口不校验 `status` 值域

**文件**: `src/app/api/codeswarm/worker/result/route.ts:470`

**问题**: `status` 只做二元判断：`completed` 或 `failed`。任何非 `completed` 的值都变成 `failed`。如果 Worker 发送了 `status: 'timeout'` 或其他值，语义信息丢失。

**建议**: 定义合法的 status 枚举值并校验。

---

### 【低】dispatch 接口 `updateMany` 返回 count=0 时已正确处理

**文件**: `src/app/api/codeswarm/tasks/[taskId]/dispatch/route.ts:74-76`

**优点**: 使用原子 `updateMany` + count 检查防止并发分发竞争，这是正确的做法。

---

## 六、性能问题

### 【高】event 接口多次串行数据库操作

**文件**: `src/app/api/codeswarm/worker/event/route.ts:59-180`

**问题**: 单次事件上报请求会执行：
1. `codeswarmEvent.createMany` — 写入事件
2. 遍历 eventList，逐个 `executeRaw` 更新 session_created / phase_start
3. 遍历 eventList，逐个 `publishTaskEvent`
4. 遍历 eventList，构建 logs 数组
5. `taskExecutionLog.createMany` — 写入日志

步骤 2 中的 `executeRaw` 是逐个执行的（for 循环内 await），多个 session_created 事件会串行执行。在高频事件场景（Agent 每秒输出大量 log_chunk），这会造成严重延迟。

**建议**:
1. 步骤 2 的 `executeRaw` 合并为一条 SQL
2. `publishTaskEvent` 和 `createMany` 可以并行执行

---

### 【中】tasks 列表无分页，硬编码 LIMIT 100

**文件**: `src/app/api/codeswarm/tasks/route.ts:9-21`

**问题**: 硬编码 `LIMIT 100`，无分页参数。超过 100 个任务时无法查看历史数据。

**建议**: 添加 page/limit 查询参数。

---

### 【中】heartbeat 每次请求都执行离线 Worker 清理

**文件**: `src/app/api/codeswarm/worker/heartbeat/route.ts:61-66`

**问题**: 每次 Worker 心跳都执行 `deleteMany` 清理 24 小时前的离线 Worker。虽然 `catch(() => {})` 不阻塞，但高频心跳下会产生大量无效 DELETE 查询。

**建议**: 使用计数器或时间戳，每 N 次心跳或每分钟执行一次清理。

---

## 七、潜在 Bug

### 【高】result 回调中事务外创建日志可能丢失

**文件**: `src/app/api/codeswarm/worker/result/route.ts:544-565`

**问题**: 任务状态更新在事务内完成（line 473-531），但完成日志的创建（line 545-556）和 eventBus 发射（line 558-564）在事务外。如果创建日志失败，任务已标记完成但没有完成日志。更重要的是，`prisma.taskExecutionLog.upsert` 使用 `skipDuplicates` 但 `id` 是基于时间戳生成的，几乎不会重复，upsert 的 update 分支几乎不执行。

---

### 【中】`parseVulnerabilityJson` 的 markdown bold 修复过于激进

**文件**: `src/app/api/codeswarm/worker/result/route.ts:117`

**问题**: `jsonStr.replace(/\*{1,2}(.*?)\*{1,2}/g, '$1')` 移除所有 `*` 包裹的内容，包括可能是合法 JSON 值的星号（如漏洞描述中的 `**重要**`）。虽然 `.*?` 是非贪婪匹配，但 `*{1,2}` 的组合可能匹配不完整的对。

**建议**: 添加更精确的匹配条件，或仅在 JSON 解析失败时应用此修复。

---

### 【中】dispatch 端点的 Worker 地址排序优先级硬编码

**文件**: `src/app/api/codeswarm/tasks/[taskId]/dispatch/route.ts:6-21`

**问题**: `sortAddressesByPriority` 硬编码了 IP 段优先级（`172.17.`、`172.18.`、`198.18.` 等）。在非 Docker 环境或云环境中，这些假设可能不正确，导致优先使用错误的网络接口。

**建议**: 支持通过环境变量配置 Worker 通信的地址优先级策略。

---

### 【低】event 接口的 log ID 生成在高并发下可能冲突

**文件**: `src/app/api/codeswarm/worker/event/route.ts:166`

**问题**: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` 在同一毫秒内多个请求时，`Date.now()` 相同，`Math.random()` 的 6 位字符空间约 2B 种可能，冲突概率存在。

---

## 汇总

| 严重级别 | 数量 | 关键问题 |
|---------|------|---------|
| **高** | 6 | event/result 无认证、fire-and-forget 解析不可控、多实例 Set 失效、事件串行 DB、任务管理无认证、日志事务不一致 |
| **中** | 10 | dispatch 明文 API Key、LIKE 误杀、事件数组无限制、无分页、心跳清理频率等 |
| **低** | 5 | Math.random ID、动态导入合理、status 值域等 |

## 建议修复优先级

1. **P0（立即修复）**: event/result 接口添加 Worker Token 认证、漏洞解析添加取消机制、fire-and-forget 改为可追踪的异步任务
2. **P1（本迭代）**: tasks 管理接口添加 JWT 认证、批量删除释放 Worker 负载、event 接口优化串行 DB 为并行、LIKE 精确匹配修复
3. **P2（下迭代）**: 分页支持、心跳清理节流、IP 优先级可配置、API Key 传输安全加固、vulnParseInProgress 改用 Redis
