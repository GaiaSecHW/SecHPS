# Draft: SessionMessage JSONL 存储改造方案

## 一、改造目标

将 SessionMessage 从数据库存储改为 JSONL 文件存储，解决：
- 外键约束问题（workflowNodeId 不存在于 WorkflowNode 表）
- 数据库空间膨胀问题
- 流式写入和崩溃恢复需求

## 二、当前架构分析

### SessionMessage 模型
```prisma
model SessionMessage {
  id                  String            @id
  evaluationSessionId String
  workflowNodeId      String?           // 外键约束！
  role                String
  content             String
  metadata            String?
  createdAt           DateTime
}
```

**问题**：workflowNodeId 有外键约束，如果节点 ID 不存在于 WorkflowNode 表，写入会失败。

### 当前写入点
- `src/lib/workflow/unified-execution-engine.ts:968` - saveNodeMessage 方法
- 回调：onChunk, onThinking, onToolCall, onToolResult

### 当前读取点
- `src/app/api/evaluations/[id]/messages/route.ts` - 消息列表 API
- `src/app/api/evaluations/[id]/children/route.ts` - 子 Agent API

### 当前前端使用
- `src/app/dashboard/sessions/[id]/page.tsx` - 评估详情页
- 按节点过滤消息、子 Agent 展开显示

## 三、新架构设计

### 文件存储结构
```
outputs/sessions/{sessionId}/
├── messages.jsonl              # 主消息流（append-only）
├── index.json                  # 快速索引
└── summary.json                # 会话汇总
```

### JSONL 消息格式
```jsonl
{"id":"msg-001","role":"user","nodeId":"node-1","nodeIndex":0,"content":"...","timestamp":1704067200000}
{"id":"msg-002","role":"assistant_chunk","nodeId":"node-1","nodeIndex":0,"content":"...","timestamp":1704067201000}
{"id":"msg-003","role":"tool_call","nodeId":"node-1","nodeIndex":0,"content":{"toolUseId":"tu-001","name":"Read"},"agentCallMsgId":null,"timestamp":1704067202000}
{"id":"msg-004","role":"thinking","nodeId":"node-1","nodeIndex":0,"content":"...","agentCallMsgId":"msg-003","timestamp":1704067202500}
```

### 索引结构 (index.json)
```json
{
  "sessionId": "eval-abc",
  "nodes": {
    "node-1": { "startLine": 0, "endLine": 100, "count": 100 },
    "node-2": { "startLine": 101, "endLine": 200, "count": 100 }
  },
  "agentCalls": {
    "msg-003": { "startLine": 3, "endLine": 50 }
  },
  "lastLine": 200,
  "lastUpdated": 1704067205000
}
```

## 四、实现组件

### SessionWriter 类
- 功能：流式写入 JSONL，维护索引
- 写入策略：append-only，定期 flush 索引
- 错误处理：写入失败不阻塞执行

### SessionReader 类
- 功能：按行范围读取 JSONL
- 过滤：按 nodeId、agentCallMsgId 过滤
- 分页：支持 offset/limit

### 数据库修改
- EvaluationSession 添加 jsonlPath 字段
- NodeExecution 添加 messageStartLine/messageEndLine 字段
- SessionMessage 表保留但不写入（兼容旧数据）

## 五、Metis 评审结论

### 关键发现
**项目已有成熟 JSONL 实现！** `src/services/session-manager.ts` (1291行)：
- 第 211-240行：`addMessage()` - append-only 写入
- 第 424-445行：流式读取（readline + for await）
- 完整的缓存和索引机制

**建议**：直接扩展 SessionManager，而非重新实现。

### 高风险项
1. **并发写入冲突** - FSM 多节点并行需文件锁
2. **所有权验证丢失** - index.json 需存储 projectId
3. **崩溃恢复** - 最后一行可能不完整

### 中风险项
1. FSM nodeId 过滤效率 - 需索引 nodeIdRanges
2. 文件清理策略缺失 - 需 TTL 配置
3. 消息计数查询变慢 - index.json 维护 messageCount

### 强制要求 (MUST)
- 参考 session-manager.ts 第 211-240行的 addMessage() 实现
- 参考 session-manager.ts 第 424-445行的流式读取模式
- index.json 维护 projectId 用于所有权验证
- index.json 维护 messageCount 替代 _count.SessionMessage
- 实现文件锁机制防止并发写入
- 保持 FSM 模式的 metadata.nodeId 存储

### 禁止事项 (MUST NOT)
- 直接删除 Prisma SessionMessage 模型（需保留过渡期）
- 使用同步文件操作（阻塞事件循环）

## 六、代码修改点汇总

### 写入点（5处）
| 文件 | 行号 | 改造方向 |
|------|------|----------|
| unified-execution-engine.ts | 1002 | 调用 JSONL 服务 |
| unified-execution-engine.ts | 1034, 1056 | 调用 JSONL 服务 |
| history.ts | 38, 62 | 调用 JSONL 服务 |
| ralph-loop-agent-wrapper.ts | 499 | 调用 JSONL 服务 |

### 读取点（6处）
| 文件 | 行号 | 改造方向 |
|------|------|----------|
| evaluations/[id]/messages/route.ts | 262 | JSONL 流式读取 |
| evaluations/[id]/children/route.ts | 36 | JSONL 流式读取 |
| messages/[id]/route.ts | 36 | JSONL 查找 |
| history.ts | 21, 87 | JSONL 服务 |
| unified-execution-engine.ts | 1024, 1046 | JSONL 查找 |

### 删除点（1处）
| 文件 | 行号 | 改造方向 |
|------|------|----------|
| evaluations/[id]/route.ts | 212 | 改为删除 JSONL 目录 |

## 七、实施顺序

Phase 1: 创建 EvaluationMessageStore 服务
Phase 2: 双写模式（过渡期）
Phase 3: API 层切换到 JSONL
Phase 4: 停止数据库写入
Phase 5: 数据迁移（可选）

## 八、使用成熟开源库（推荐）

**核心原则**: 优先使用成熟开源库，减少自研代码量，提高可靠性。

### 候选库（待 librarian 确认）

| 功能 | 候选库 | 说明 |
|------|--------|------|
| JSONL 读写 | `ndjson` | 流式读写 JSONL 格式 |
| 文件锁 | `proper-lockfile` | 防止并发写入冲突（最流行） |
| 流式解析 | `stream-json` | 更通用的 JSON 流解析 |

### proper-lockfile 基本用法
```typescript
import lockfile from 'proper-lockfile';

// 获取文件锁
const release = await lockfile.lock(file);

// 执行写入
await fs.appendFile(file, line + '\n');

// 释放锁
await release();
```

### ndjson 基本用法
```typescript
import ndjson from 'ndjson';

// 流式写入
const stream = fs.createWriteStream(file, { flags: 'a' });
stream.write(JSON.stringify(msg) + '\n');

// 流式读取
fs.createReadStream(file)
  .pipe(ndjson.parse())
  .on('data', obj => { /* 处理每条消息 */ });
```

### 优势
1. **减少代码量**: 不需要自研文件锁和流解析逻辑
2. **可靠性高**: 经过大量项目验证
3. **维护成本低**: 库的 bug 由社区修复
4. **文档齐全**: 有完整的使用文档和示例