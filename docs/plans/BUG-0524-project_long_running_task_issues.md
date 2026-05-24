---
name: 长时任务支撑问题清单
description: Server 端和 Worker 端对一周级别长时任务的已知问题，待后续修复
type: project
originSessionId: 9032eb49-cffa-487f-afc7-0fe84c0b362f
---
分析日期：2026-05-24。当前系统对一周级别长时任务存在以下已知问题，暂未修复。

**Why:** 任务运行周期可达一周，现有超时、内存、持久化设计均按短任务设计，需专项改造。
**How to apply:** 涉及长时任务相关需求时，优先评估以下问题的影响范围再动手。

---

## Worker 端（codeswarm/）

### 高优先级

1. **任务超时硬限 60 分钟**
   - `AgentRunner`（`agent-runner.ts:144`）和 `runOpencodeCommand`（`process-manager.ts:549`）均硬编码 60min 超时
   - `TaskPayload.timeoutSec` 字段存在（`types/src/index.ts:109`）但 `daemon.ts:executeTask` 完全未读取
   - 修复方向：`executeTask` 读取 `timeoutSec`，移除硬编码上限

2. **stdout/stderr 无界内存缓冲**
   - 子进程输出全量拼接到字符串（`agent-runner.ts:51`、`process-manager.ts:499`）
   - 一周任务 LLM 输出可达数百 MB，必然 OOM
   - 修复方向：流式写入临时文件，内存只保留最后 N 行

3. **无 checkpoint/resume 机制**
   - `activeTasks` 是纯内存 Map（`daemon.ts:40`），OOM Kill 后任务状态全丢，只能从头重跑
   - 修复方向：Worker 本地用 SQLite 持久化任务状态

4. **心跳失败无自愈**
   - 心跳失败 5 次后只打 warn（`daemon.ts:264`），Worker 被 Server 判定离线但进程仍执行，结果无法回传
   - 修复方向：连续失败超阈值后主动退出，由容器编排重启

5. **postResult 无本地兜底**
   - 结果回传失败 3 次后永久丢失（`daemon.ts:661`），无本地落盘
   - 修复方向：失败时写入本地文件，重启后重试

### 中优先级

6. **子进程孤儿**
   - 超时后发 SIGTERM 不等待退出（`agent-runner.ts:166`）
   - codedmap Python 进程句柄未存储，无法被取消（`codedmap-manager.ts:199`）

7. **Docker 日志无轮转**
   - `docker-compose.yml` 无 `max-size` 配置，一周日志撑满磁盘
   - 修复方向：加 `logging.options.max-size: "100m"` 和 `max-file: "10"`

---

## Server 端（src/）

### 高优先级

1. **pollViaRedis 进程重启后丢失**
   - 任务轮询是 fire-and-forget（`execute/route.ts:255`），Server 重启后任务状态永远卡在 `running`
   - 修复方向：Server 启动时扫描 DB 中 `status=running` 的任务，重新挂载轮询

2. **前端 Token 无自动刷新**
   - Access Token 7 天过期（`auth.ts:67`），前端无刷新逻辑（`useAuth.ts:65`）
   - 7 天后监控页面全部 401，但后台任务本身不受影响
   - 修复方向：`useApiFetch` 拦截 401 后自动调用 `/api/auth/refresh`

3. **WebSocket 无心跳**
   - 终端连接无 ping/pong（`websocket-server.ts:59`），NAT/防火墙静默断开，客户端无感知
   - `TerminalComponent.tsx:172` 的 `onclose` 无自动重连
   - 修复方向：`ws` 服务端配置 `pingInterval`，客户端实现指数退避重连

### 中优先级

4. **Redis Sorted Set 无清理**
   - DELETE 路由（`tasks/[taskId]/route.ts:70`）未调用 `zrem`，超时记录长期积累

5. **SSE 流无 maxDuration**
   - `stream/route.ts:4` 无 `maxDuration`，Nginx `proxy_read_timeout` 会断开长时间 SSE 连接

6. **Prisma keepAlive 无 HMR 保护**
   - `prisma.ts:81` 的 `setInterval` 在开发模式热重载时会创建多个实例
