# Session Manager 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在分布式 Worker 体系内，把每次任务产生的 Agent 会话(transcript)归档、可回放、可续接——对标 cc-switch 的会话管理能力，但服务端化。

**Architecture:** Worker 端在任务收尾时，把 Agent 产生的 transcript 解析成统一 `SessionMeta` + `SessionMessage[]`，归档到 `workspacePath/.codeswarm/sessions/`，并把元信息 + 消息流经既有 `/worker/event` 通道回传 Scheduler 落库。Debug UI 新增"会话回放"页渲染时间线。Task submit 新增 `resumeFromTaskId`，Worker 用 `claude --resume <id>` 续接。

**Tech Stack:** TypeScript 5.8 ESM、Prisma 6、Fastify 5、Zod、Vitest、React 19 + Tailwind(debug-ui)。

---

## 设计基线与已验证事实

- cc-switch 的会话 = CLI 落盘的历史对话(`~/.claude/projects/**/*.jsonl`、codex rollout、opencode sqlite)。`src-tauri/src/session_manager/providers/claude.rs` 是 jsonl 解析的黄金参考。
- 当前 Worker `ProcessEntry` 已带 `sessionId`(`packages/worker/src/process-manager.ts:14`),已发 `session_created` 事件(`:410`),但这是 **ACP session id**(`ses_xxx`),不一定等于 Claude Code transcript 文件名里的 sessionId——P0 Spike 必须先核实二者关系。
- `CodeswarmTask` 已有 `sessionId` 列(`prisma/schema.prisma:51`,**当前未填充**)。
- `CodeswarmEvent` 存所有 agent 事件为 JSON(`routes/worker.ts:127`),`session_created` 已流经此通道——可复用,无需 schema 迁移即可承载会话元信息。
- ACP 封装 `createSession(agent?)` **只创建新会话**,无 `loadSession/resume`(`packages/acp/src/index.ts:206`)→ P2 续接 claudecode 必须走 CLI `claude --resume`,不能走 ACP。opencode 是否支持 resume 是 Spike 项。
- 改 schema 后遵循 [[types-package-dist-gotcha]]:先 `pnpm --filter @codeswarm/types build` 再 typecheck。

## 未决 Spike（实现前必须先验证，结果可能改动 P0/P2 细节）

- **Spike-A（P0 前置）**:claudecode 任务跑完后,worker 容器内 transcript 落在哪个绝对路径?是否 `$HOME/.claude/projects/<encoded-cwd>/<uuid>.jsonl`?该 uuid 与 ACP 返回的 `ses_xxx` 是否一致?需在真实任务里 `find / -name '*.jsonl'` 核实。
- **Spike-B（P2 前置）**:`claude --resume <id>` 在 worker 容器内(headless、非交互)能否直接产出最终结果?opencode 是否有 `opencode resume <sid>` 等价命令?

---

## Chunk 1: P0 — 会话归档

### Task 1: 定义统一会话类型（@codeswarm/types）

**Files:**
- Modify: `packages/types/src/index.ts`(末尾追加)
- Test: `packages/types/src/session.test.ts`(新建)

把 cc-switch 的 `SessionMeta`/`SessionMessage` 移植成 TS Zod schema,作为 worker↔scheduler↔ui 的契约。

- [ ] **Step 1: 写失败测试**

```ts
// packages/types/src/session.test.ts
import { describe, it, expect } from 'vitest';
import { SessionMetaSchema, SessionMessageSchema } from './index.js';

describe('SessionMetaSchema', () => {
  it('accepts a minimal claude session', () => {
    const meta = SessionMetaSchema.parse({
      providerId: 'claude', sessionId: 'ses-abc',
      sourcePath: '/data/.codeswarm/sessions/claude-ses-abc.jsonl',
      cwd: '/workspace/task-1', engine: 'claudecode',
    });
    expect(meta.engine).toBe('claudecode');
    expect(meta.messages).toBeUndefined();       // meta 默认不带消息
    expect(meta.title).toBeUndefined();
  });
  it('rejects empty sessionId', () => {
    expect(() => SessionMetaSchema.parse({ providerId: 'claude', sessionId: '' }))
      .toThrow();
  });
});

describe('SessionMessageSchema', () => {
  it('classifies tool_result wrapped in user role', () => {
    // 回放时 user 角色里全是 tool_result → 重分类为 tool(对齐 cc-switch claude.rs 语义)
    const m = SessionMessageSchema.parse({
      role: 'tool', content: 'File written', ts: 1,
    });
    expect(m.role).toBe('tool');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @codeswarm/types test`  Expected: FAIL "SessionMetaSchema is not exported"

- [ ] **Step 3: 实现 schema**

```ts
// packages/types/src/index.ts 末尾
export const SessionEngineEnum = z.enum(['claudecode', 'opencode', 'codex', 'script']);

export const SessionMessageSchema = z.object({
  role: z.string(),                 // user | assistant | tool | system
  content: z.string(),
  ts: z.number().nullable().optional(),
});

export const SessionMetaSchema = z.object({
  providerId: z.string(),           // claude | opencode | codex | script
  engine: SessionEngineEnum,
  taskId: z.string(),
  sessionId: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  cwd: z.string().nullable().optional(),
  createdAt: z.number().nullable().optional(),
  lastActiveAt: z.number().nullable().optional(),
  sourcePath: z.string().optional(),          // 归档后绝对路径
  transcriptRelPath: z.string().optional(),   // 相对 workspacePath
  resumeCommand: z.string().optional(),
});

export type SessionMessage = z.infer<typeof SessionMessageSchema>;
export type SessionMeta = z.infer<typeof SessionMetaSchema>;
```

- [ ] **Step 4: 跑测试确认通过**  Run: `pnpm --filter @codeswarm/types test`  Expected: PASS

- [ ] **Step 5: 构建 + 提交**

```bash
pnpm --filter @codeswarm/types build
git add packages/types/src/index.ts packages/types/src/session.test.ts packages/types/dist
git commit -m "feat(types): add SessionMeta/SessionMessage schemas for session archiving"
```

---

### Task 2: jsonl → messages 解析器（worker）

**Files:**
- Create: `packages/worker/src/session/parser.ts`
- Test: `packages/worker/src/session/parser.test.ts`

把 cc-switch `claude.rs` 的 `load_messages` + `parse_session` 逻辑移植成纯 TS(无 IO,吃字符串)。这是 P0/P1 共用的核心。

- [ ] **Step 1: 写失败测试**（用 cc-switch claude.rs 测试用例的同款数据）

```ts
// packages/worker/src/session/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseClaudeTranscript } from './parser.js';

describe('parseClaudeTranscript', () => {
  it('turns tool_result-only user message into tool role', () => {
    const jsonl = [
      '{"message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"a.txt"}}]},"timestamp":"2026-03-06T10:00:00Z"}',
      '{"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"File written"}]},"timestamp":"2026-03-06T10:00:01Z"}',
    ].join('\n');
    const { messages } = parseClaudeTranscript(jsonl);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('assistant');
    expect(messages[1].role).toBe('tool');
    expect(messages[1].content).toBe('File written');
  });

  it('extracts sessionId, cwd, first-user-message title', () => {
    const jsonl = [
      '{"sessionId":"ses-1","cwd":"/tmp/p","timestamp":"2026-03-06T10:00:00Z"}',
      '{"type":"user","message":{"role":"user","content":"如何部署"},"timestamp":"2026-03-06T10:01:00Z"}',
    ].join('\n');
    const { meta } = parseClaudeTranscript(jsonl);
    expect(meta.sessionId).toBe('ses-1');
    expect(meta.cwd).toBe('/tmp/p');
    expect(meta.title).toBe('如何部署');
  });

  it('skips isMeta lines and command caveats', () => {
    const jsonl = [
      '{"isMeta":true}',
      '{"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>"}}',
      '{"type":"assistant","message":{"role":"assistant","content":"hi"}}',
    ].join('\n');
    const { messages } = parseClaudeTranscript(jsonl);
    expect(messages.map(m => m.content)).toEqual(['hi']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**  Run: `pnpm --filter @codeswarm/worker test session/parser`  Expected: FAIL

- [ ] **Step 3: 实现解析器**（逐行 split、跳过 `isMeta`、`extractText` 递归 content 数组、纯 tool_result 数组重分类为 tool、title 优先级 custom-title > 首条用户消息 > 目录 basename > sessionId 前 8 位）

```ts
// packages/worker/src/session/parser.ts
import type { SessionMessage, SessionMeta } from '@codeswarm/types';

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => {
      if (typeof c === 'string') return c;
      if (c?.type === 'text' && typeof c.text === 'string') return c.text;
      if (c?.type === 'tool_use') return `[Tool: ${c.name}]`;
      if (c?.type === 'tool_result') return typeof c.content === 'string' ? c.content : '';
      return '';
    }).join('');
  }
  return '';
}

function isAllToolResults(content: unknown): boolean {
  return Array.isArray(content) && content.length > 0
    && content.every((c: any) => c?.type === 'tool_result');
}

export interface ParsedSession { meta: SessionMeta; messages: SessionMessage[]; }

export function parseClaudeTranscript(jsonl: string, fallback: {
  taskId: string; cwd?: string | null; sourcePath?: string;
}): ParsedSession {
  const lines = jsonl.split('\n');
  let sessionId = ''; let cwd: string | null = fallback.cwd ?? null;
  let createdAt: number | null = null; let lastActiveAt: number | null = null;
  let title: string | undefined; let firstUser: string | undefined;
  const messages: SessionMessage[] = [];

  for (const line of lines) {
    const raw = line.trim(); if (!raw) continue;
    let v: any; try { v = JSON.parse(raw); } catch { continue; }
    if (v.isMeta === true) continue;
    const ts = v.timestamp ? Date.parse(v.timestamp) : null;
    if (!sessionId && v.sessionId) sessionId = v.sessionId;
    if (cwd === null && v.cwd) cwd = v.cwd;
    if (createdAt === null && ts) createdAt = ts;
    if (ts) lastActiveAt = ts;
    if (v.type === 'custom-title' && v.customTitle) { title = v.customTitle; continue; }

    const msg = v.message; if (!msg) continue;
    let role = msg.role ?? 'unknown';
    if (role === 'user' && isAllToolResults(msg.content)) role = 'tool';
    const content = extractText(msg.content);
    if (!content.trim()) continue;
    if (title === undefined && role === 'user'
        && !content.includes('<local-command-caveat>')
        && !content.startsWith('<command-name>')) {
      firstUser = content.trim();
    }
    messages.push({ role, content, ts: Number.isFinite(ts as number) ? ts : null });
  }

  sessionId = sessionId || fallback.taskId;
  return {
    meta: {
      providerId: 'claude', engine: 'claudecode', taskId: fallback.taskId,
      sessionId, cwd,
      createdAt, lastActiveAt,
      title: title ?? firstUser?.slice(0, 80) ?? sessionId.slice(0, 8),
      sourcePath: fallback.sourcePath,
    },
    messages,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**  Run: `pnpm --filter @codeswarm/worker test session/parser`  Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/worker/src/session/parse.ts packages/worker/src/session/parser.test.ts
git commit -m "feat(worker): port cc-switch claude jsonl parser to TS"
```

---

### Task 3: Spike-A — 核实 transcript 真实落盘路径

**Files:** 无产出代码,产出结论写入本文件下方"Spike 结论"小节。

- [ ] **Step 1: 起一个 claudecode 任务,完成后在 worker 容器内查找 transcript**

```bash
# 在 worker pod 内
find "$HOME" /root /home -name '*.jsonl' -path '*projects*' 2>/dev/null
ls -la "$HOME/.claude/projects/"
```

- [ ] **Step 2: 记录结论**:transcript 绝对路径模式 = ?;文件名 uuid 是否 == ACP `sessionId`?(若不等,Task 4 的发现逻辑要按 mtime 在 projects 目录里挑最新文件,而非依赖 ACP sid)

- [ ] **Step 3: 把结论补进本文件 "Spike 结论" 段**,再继续 Task 4。

---

### Task 4: 归档器——发现/拷贝 transcript + 产出 SessionMeta（worker）

**Files:**
- Create: `packages/worker/src/session/archiver.ts`
- Test: `packages/worker/src/session/archiver.test.ts`(用 tmpdir 造 `.claude/projects` 结构)

- [ ] **Step 1: 写失败测试**(给一个伪造的 `$HOME/.claude/projects/<cwd>/<sid>.jsonl`,断言归档后 `workspacePath/.codeswarm/sessions/<sid>.jsonl` 存在且 meta 字段正确)

```ts
// packages/worker/src/session/archiver.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { archiveSession } from './archiver.js';

describe('archiveSession', () => {
  let home: string; let ws: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  });

  it('copies transcript into workspace and returns meta', () => {
    const projDir = path.join(home, '.claude', 'projects', 'tmp-p');
    fs.mkdirSync(projDir, { recursive: true });
    const src = path.join(projDir, 'ses-1.jsonl');
    fs.writeFileSync(src, [
      '{"sessionId":"ses-1","cwd":"/tmp/p","timestamp":"2026-03-06T10:00:00Z"}',
      '{"message":{"role":"user","content":"hi"},"timestamp":"2026-03-06T10:01:00Z"}',
    ].join('\n'));
    process.env.HOME = home;

    const result = archiveSession({
      taskId: 'task-1', engine: 'claudecode', workspacePath: ws, cwd: '/tmp/p',
      acpSessionId: 'ses-1',
    });
    const archived = path.join(ws, '.codeswarm', 'sessions', 'claude-ses-1.jsonl');
    expect(fs.existsSync(archived)).toBe(true);
    expect(result.meta.sessionId).toBe('ses-1');
    expect(result.meta.transcriptRelPath).toBe('.codeswarm/sessions/claude-ses-1.jsonl');
    expect(result.messages.length).toBe(1);
  });

  it('returns null when no transcript found (non-fatal)', () => {
    process.env.HOME = home;
    const result = archiveSession({
      taskId: 'task-2', engine: 'claudecode', workspacePath: ws, cwd: '/nope',
      acpSessionId: 'ses-x',
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**  Run: `pnpm --filter @codeswarm/worker test session/archiver`  Expected: FAIL

- [ ] **Step 3: 实现归档器**(按 Spike-A 结论选发现策略:`acpSessionId` 优先 → 否则 mtime 最新 jsonl)

```ts
// packages/worker/src/session/archiver.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseClaudeTranscript } from './parser.js';
import type { SessionMeta, SessionMessage } from '@codeswarm/types';

export interface ArchiveInput {
  taskId: string;
  engine: 'claudecode' | 'opencode' | 'script';
  workspacePath: string;
  cwd?: string | null;
  acpSessionId?: string;
}

export interface ArchiveResult { meta: SessionMeta; messages: SessionMessage[]; }

function findClaudeTranscript(cwd: string | null, sid?: string): string | null {
  const home = process.env.HOME || os.homedir();
  const projectsDir = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return null;
  // 与 cc-switch claude.rs 一致：递归收集整个 projects 目录所有 *.jsonl
  // （排除 agent- 前缀的子代理会话），不假设 cwd→编码路径的精确映射。
  const all: { abs: string; f: string; mtime: number }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent-')) {
        all.push({ abs, f: entry.name, mtime: fs.statSync(abs).mtimeMs });
      }
    }
  };
  walk(projectsDir);
  if (sid) {
    const hit = all.find(x => x.f.includes(sid));
    if (hit) return hit.abs;
  }
  // 无 sid 或未命中 → 取 mtime 最新（归档时机最近的通常就是本任务）
  all.sort((a, b) => b.mtime - a.mtime);
  return all[0]?.abs ?? null;
}

export function archiveSession(input: ArchiveInput): ArchiveResult | null {
  if (input.engine === 'claudecode') {
    const src = findClaudeTranscript(input.cwd ?? null, input.acpSessionId);
    if (!src) return null;
    const jsonl = fs.readFileSync(src, 'utf-8');
    const rel = path.join('.codeswarm', 'sessions', `claude-${path.basename(src)}`);
    const dest = path.join(input.workspacePath, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    const { meta, messages } = parseClaudeTranscript(jsonl, {
      taskId: input.taskId, cwd: input.cwd, sourcePath: dest,
    });
    return { meta: { ...meta, transcriptRelPath: rel }, messages };
  }
  // opencode:走 `opencode export <sid>` —— Task 8 处理,P0 先返回 null
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过**  Run: `pnpm --filter @codeswarm/worker test session/archiver`  Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/worker/src/session/archiver.ts packages/worker/src/session/archiver.test.ts
git commit -m "feat(worker): add session archiver (discover+copy transcript, emit SessionMeta)"
```

---

### Task 5: 任务收尾时调用归档器（worker daemon）

**Files:**
- Modify: `packages/worker/src/daemon.ts`(在 `executeTask` 的成功/失败收尾处,`terminate` 前调用 archive;把 meta+messages 作为 `session_archived` 事件回传)

- [ ] **Step 1: 阅读现状**——`executeTask` 成功路径(line 561+)与 `postEvent`(:842)。确认 `runAgent` 返回 `RunAgentResult` 后、`postResult` 之前是归档窗口。

- [ ] **Step 2: 在 process-manager 暴露 ACP sessionId 给 daemon**

```ts
// packages/worker/src/process-manager.ts —— ProcessEntry 已有 sessionId,补 getter
getSessionId(taskId: string): string | undefined {
  return this.processes.get(taskId)?.sessionId;
}
```

- [ ] **Step 3: daemon 收尾归档**

> **事件类型说明**:`session_archived` 由 **daemon 直接构造**(`postEvent` 接受 `unknown[]`,不经 `AgentEventType` 联合类型,故无需改 `process-manager.ts:45` 的 enum)。它区别于 agent 侧的 `session_created`(ACP session 建立时发,只有裸 sid,无 transcript)。scheduler `/worker/event` 路由的 events 是 `Array<{type:string;...}>` 开放类型,`session_archived` 可透传。
>
> **失败路径**:任务 failed 时 ACP 可能未产出 transcript → `archiveSession` 返回 null → `if (archived)` 不发事件、不更新 `sessionId`。这是正确行为:不写兼容、不强制归档失败任务。
>
> **script/opencode 路径**:`runScript`/`runOpencodeRun` 不走 ACP,`getSessionId` 返回 undefined → `acpSessionId` 为 undefined → claudecode 归档器靠 mtime fallback;opencode/script 在 Task 4 返回 null,此处 `if (archived)` 自然跳过。

```ts
// packages/worker/src/daemon.ts executeTask 末尾、postResult 之前
import { archiveSession } from './session/archiver.js';
// ...
const acpSid = this.processMgr.getSessionId(taskId) ?? undefined;
let archived: ArchiveResult | null = null;
try {
  archived = archiveSession({
    taskId, engine,
    workspacePath: payload.workspacePath || resolvedWorkspace,
    cwd: payload.workspacePath || env?.INPUT_DIR || null,
    acpSessionId: acpSid,
  });
  if (archived) {
    await this.postEvent(payload, [{
      type: 'session_archived',
      timestamp: new Date().toISOString(),
      data: {
        meta: archived.meta,
        // CodeswarmEvent.data 是 @db.Text（无长度上限），全文回传。
        // 这样 P1 回放完全从 scheduler DB 重建，不依赖 scheduler pod 能否访问
        // /mnt/workspace PVC（worker/scheduler 跨 pod 卷共享未确认）。
        // workspacePath 下的 jsonl 文件仅作冗余权威源 + 人工 debug。
        messages: archived.messages,
        messageCount: archived.messages.length,
      },
    }]).catch(err => this.server.log.warn({ taskId, err }, 'session_archived post failed'));
  }
} catch (err) {
  this.server.log.warn({ taskId, err }, 'session archive failed (non-fatal)');
}
```

- [ ] **Step 4: 手测**——起一个 claudecode 任务,完成后查 scheduler DB: `select type,data from "CodeswarmEvent" where "taskId"=... and type='session_archived'`;查 worker workspace: `ls .codeswarm/sessions/`。

- [ ] **Step 5: 提交**

```bash
git add packages/worker/src/daemon.ts packages/worker/src/process-manager.ts
git commit -m "feat(worker): archive agent session on task completion + post session_archived event"
```

---

### Task 6: scheduler 侧把 sessionId 落库 + 暴露会话查询路由

**Files:**
- Modify: `packages/scheduler/src/routes/worker.ts`(在 `/worker/event` 里识别 `session_archived` 类型 → 更新 `CodeswarmTask.sessionId`)
- Create: `packages/scheduler/src/routes/session.ts`(`GET /api/codeswarm/task/:taskId/session` 返回 meta + messages)
- Modify: `packages/scheduler/src/server.ts`(注册 session 路由)

- [ ] **Step 1: worker/event 路由补 session_archived 处理**

```ts
// routes/worker.ts 在写 createMany 之后
for (const event of body.events) {
  if (event.type === 'session_archived' && event.data?.meta?.sessionId) {
    await prisma.codeswarmTask.update({
      where: { taskId: body.taskId },
      data: { sessionId: event.data.meta.sessionId },
    }).catch(() => {});
  }
}
```

- [ ] **Step 2: 新建 session 查询路由**(从 events 重建 meta+messages)

```ts
// packages/scheduler/src/routes/session.ts
import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';

export function registerSessionRoutes(server: FastifyInstance): void {
  server.get<{ Params: { taskId: string } }>(
    '/api/codeswarm/task/:taskId/session',
    async (request, reply) => {
      const { taskId } = request.params;
      const task = await prisma.codeswarmTask.findUnique({
        where: { taskId }, select: { taskId: true, sessionId: true, engine: true, workspacePath: true },
      });
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      const events = await prisma.codeswarmEvent.findMany({
        where: { taskId, type: 'session_archived' },
        orderBy: { createdAt: 'desc' }, take: 1,
      });
      if (!events.length) return reply.send({ available: false, task });
      let payload: any = {}; try { payload = JSON.parse(events[0].data); } catch {}
      return reply.send({ available: true, task, ...payload });
    },
  );
}
```

- [ ] **Step 3: 注册路由**——在 `server.ts` 调 `registerSessionRoutes(server)`。

- [ ] **Step 4: 手测**——`curl /api/codeswarm/task/<id>/session` 应返回 `{available:true, task, meta, messages, messageCount}`。

- [ ] **Step 5: 提交**

```bash
git add packages/scheduler/src/routes/worker.ts packages/scheduler/src/routes/session.ts packages/scheduler/src/server.ts
git commit -m "feat(scheduler): persist sessionId on archive + add GET /task/:id/session"
```

---

### Chunk 1 收尾验证（P0 完成判据）

- [ ] 跑全量 worker + types 测试:`pnpm --filter @codeswarm/types --filter @codeswarm/worker test`
- [ ] typecheck:`pnpm run typecheck`
- [ ] 端到端:claudecode 任务完成后,① workspacePath 下有 `.codeswarm/sessions/*.jsonl`;② `CodeswarmTask.sessionId` 已填;③ 存在一条 `session_archived` event;④ `/task/:id/session` 返回 meta + messages。

---

## Chunk 2: P1 — 会话回放 UI

### Task 7: debug-ui 会话数据层

**Files:**
- Modify: `packages/debug-ui/src/lib/api.ts`(加 `fetchSession(taskId)`)
- Create: `packages/debug-ui/src/components/SessionReplay.tsx`(列表/详情时间线)

- [ ] **Step 1: api 层**

```ts
// packages/debug-ui/src/lib/api.ts
export async function fetchSession(taskId: string) {
  const r = await fetch(`${API_BASE}/api/codeswarm/task/${taskId}/session`);
  if (!r.ok) throw new Error('session fetch failed');
  return r.json();
}
```

- [ ] **Step 2: SessionReplay 组件**——左侧任务列表(复用现有 task list 接口,筛 `sessionId != null`),右侧时间线渲染 messages(role badge + content),复用 `event-display.ts` 里的 `cleanEventText`。

- [ ] **Step 3: 在 `App.tsx` 路由注册**——加 "Session Replay" tab。

- [ ] **Step 4: 手测**——`pnpm run dev:debug-ui`,打开一个有归档的任务,确认时间线渲染 user/assistant/tool 三种角色。

- [ ] **Step 5: 提交**

```bash
git add packages/debug-ui/src/
git commit -m "feat(debug-ui): add session replay timeline view"
```

---

## Chunk 3: P2 — resume 续接任务

> **前置:** Task 3 的 Spike-B 必须先确认 `claude --resume <id>` 在 worker 容器内能 headless 产出结果。

### Task 8: submit 路由支持 resumeFromTaskId

**Files:**
- Modify: `packages/types/src/index.ts`(`TaskPayloadSchema` 加 `resumeFromTaskId?: string`)
- Modify: `packages/scheduler/src/routes/task.ts`(submit 时若带 `resumeFromTaskId`,查旧 task 的 sessionId+cwd+workspace,写入新 payload)
- Modify: `packages/worker/src/process-manager.ts`(runAgent 检测 `resumeSessionId`,claudecode 走 `claude --resume` 子进程而非 ACP)

- [ ] **Step 1: types 加字段**(记得 build types 包)

```ts
// packages/types/src/index.ts TaskPayloadSchema
resumeFromTaskId: z.string().optional(),
resumeSessionId: z.string().optional(),   // scheduler 解析后下发给 worker
```

- [ ] **Step 2: scheduler submit 解析 resume**

```ts
// routes/task.ts submit 内
let resumeSessionId: string | undefined;
if (body.resumeFromTaskId) {
  const src = await prisma.codeswarmTask.findUnique({
    where: { taskId: body.resumeFromTaskId },
    select: { sessionId: true },
  });
  resumeSessionId = src?.sessionId ?? undefined;
  if (!resumeSessionId) return reply.status(400).send({ error: 'source task has no archived session' });
}
// prisma.create data 里加 resumeSessionId(若给该字段加 DB 列;否则塞进 env/rawSubmitPayload)
```

- [ ] **Step 3: worker runAgent 分流**(claudecode 且带 resumeSessionId → spawn `claude --resume <id>` + 捕获 stdout,复用 runOpencodeRun 的 spawn 骨架)

- [ ] **Step 4: 手测**——P0 归档过的 task,用 `resumeFromTaskId` 续接,确认新任务能复用上下文。

- [ ] **Step 5: 提交**

```bash
pnpm --filter @codeswarm/types build
git add packages/types packages/scheduler packages/worker
git commit -m "feat: support resume-from-task (claude --resume) session continuation"
```

---

## Spike 结论（实现时回填）

### Spike-A
- transcript 绝对路径模式:`_待填_`
- 文件名 uuid 是否 == ACP sessionId:`_待填_`

### Spike-B
- `claude --resume` headless 可行性:`_待填_`
- opencode resume 命令:`_待填_`

---

## 风险与备注

- **transcript 体量**:大对话 jsonl 可能数 MB。`CodeswarmEvent.data` 是 `@db.Text`(无上限),全文随 `session_archived` 事件回传到 scheduler DB,故 P1 回放**不依赖** scheduler pod 是否能访问 `/mnt/workspace` PVC。workspacePath 下的 jsonl 仅作冗余权威源 + 人工 debug。
- **跨 pod workspace**:worker pod 与 scheduler 可能不共享卷(未确认)。**刻意**让回放数据走 event → DB,而非 scheduler 读 workspace 文件。
- **DB 无需迁移**:`transcriptRelPath` 存在 `session_archived` 事件的 `data.meta.transcriptRelPath` 里(进 `CodeswarmEvent.data` 的 JSON),不新增 CodeswarmTask 列。`CodeswarmTask.sessionId` 是**已存在**的列(line 51),Task 6 只是首次真正写入它。
- **opencode 归档**:Task 4 P0 阶段 opencode 返回 null(只 claudecode 跑通)。Task 5 的 daemon 无差别调用 `archiveSession`,opencode 任务静默无归档——Task 7 的 UI 必须区分"会话未归档(engine=opencode/script,P0 不支持)"与"会话为空(异常)",前者用 disabled hint 而非报错。opencode 走 `opencode export <sid>` 的归档在 Task 4 之后单独补一个小 task。
- **敏感信息遮罩**(对齐 cc-switch PRD §7):transcript 可能含 API key / token / 密码。Task 4 归档前对 `messages[].content` 做正则遮罩(`sk-ant-[\w-]+`、`Bearer\s+[\w.]+`、常见 `password/token/secret` key=value)。遮罩在**归档时一次性落定**,DB 与 UI 拿到的都是已遮罩版,降低泄露面。注意:遮罩是单向不可逆,会影响 resume 续接(P2)能否真实复现上下文——若 P2 需要原样上下文,则在 worker 侧归档时保留原文、仅回传 scheduler 时遮罩(两个版本)。
- **不写兼容代码**(遵循 CLAUDE.md):`session_created` 老事件若无 meta.data,UI 直接显示"无归档",不做降级兼容。
