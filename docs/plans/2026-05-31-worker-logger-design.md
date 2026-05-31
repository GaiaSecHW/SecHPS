# CodeSwarm Worker 统一日志方案

## 目标

对齐 Server 侧 `src/lib/logger.ts` 方案，替换 Worker 中全部 console.* 调用，实现按天写文件 + 控制台双输出 + 日志归档。

## 新增文件

`codeswarm/packages/worker/src/logger.ts`（~100 行）

### API

```typescript
type LogLevel = 'info' | 'warn' | 'error' | 'debug';
type LogModule = 'DAEMON' | 'AGENT' | 'ENV' | 'MINIO' | 'PROCESS' | 'HEARTBEAT';

export const LOG_MODULES = { DAEMON, AGENT, ENV, MINIO, PROCESS, HEARTBEAT };

export const logger = {
  info:  (module: string, message: string, details?: any) => void,
  warn:  (module: string, message: string, details?: any) => void,
  error: (module: string, message: string, details?: any) => void,
  debug: (module: string, message: string, details?: any) => void,
};
```

### 输出格式

对齐 Server：`[2026-05-31 14:30:00] [INFO] [DAEMON] 任务分发成功 {"taskId":"task-xxx"}`

### 文件路径

- 按 `LOG_DIR` 环境变量配置，默认 `./logs`
- 文件名 `worker-{YYYYMMDD}.log`

## 日志归档

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| 归档保留天数 | `LOG_ARCHIVE_DAYS` | 180 | 超过此天数删除 |

- 压缩：Node.js 内置 `zlib.createGzip()`，无需新增 npm 依赖
- 归档目录：`{LOG_DIR}/archive/worker-YYYYMMDD.log.gz`
- 归档时机：每周一凌晨 2~4 点（CST）自动压缩上周日志，每小时检查一次
- 对齐 Server 侧 `src/lib/log-archiver.ts` 按周归档策略

## 改造范围

| 文件 | console.* 数量 | 改动 |
|------|---------------|------|
| `daemon.ts` | ~48 | console.* → logger.* |
| `process-manager.ts` | ~53 | console.* → logger.* + 删除局部 log() helper |
| `environment.ts` | ~14 | console.* → logger.* |
| `minio-client.ts` | ~16 | console.* → logger.* |
| `index.ts` | 4 | console.* → logger.* |
| `docker-compose.yml` | — | 加 volume `./logs:/app/logs` |

**不改**：Fastify `this.server.log`（HTTP 请求日志，保持原样）

总计约 135 处替换，无逻辑变更。

## 部署适配

| 部署方式 | 日志可见性 |
|---------|-----------|
| systemd | `LOG_DIR` 下按天文件 + stdout |
| Docker | volume 挂载 `./logs:/app/logs`，宿主机直接查看 |
| npm dev | 终端 stdout + 本地 logs/ 目录 |
