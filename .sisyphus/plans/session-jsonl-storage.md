# SessionMessage JSONL 存储改造计划

## TL;DR

> **改造目标**: 将 SessionMessage 从数据库存储改为 JSONL 文件存储
> 
> **核心原因**: 
> - 外键约束失败（workflowNodeId 不存在于 WorkflowNode 表）
> - 数据库空间膨胀（单个会话可达 5000+ 条消息）
> - 流式写入和崩溃恢复需求
>
> **关键策略**: 复用现有 `session-manager.ts` 的成熟 JSONL 实现，扩展为 `EvaluationMessageStore` 服务

**Deliverables**:
- `src/services/evaluation-message-store.ts` - JSONL 存储服务（使用 async-lock + stream-json）
- `data/sessions/{projectId}/{sessionId}/` - 会话消息文件目录（按项目分组，永久保留）
- API routes 改造支持 JSONL 读取
- 数据库 Prisma 模型保留用于过渡期

**Estimated Effort**: Large
**Parallel Execution**: YES - 5 waves
**Critical Path**: Phase1 → Phase2 → Phase3 → Phase4 → Phase5

---

## Context

### Original Request
用户要将 SessionMessage 从数据库存储改为 JSONL 文件存储，解决外键约束问题和空间膨胀问题。

### Interview Summary
**关键讨论**:
- 外键约束问题：workflowNodeId 外键到 WorkflowNode，但 FSM 模式的节点 ID 不在该表中
- 数据量级：单会话 500-10000 条消息，数据库快速膨胀
- 存储模式：Claude Code SDK 和 OpenCode 都使用 JSONL 文件存储

**Research Findings**:
- 项目已有成熟 JSONL 实现：`session-manager.ts` (1291行)
- Metis 建议：复用现有实现，而非重新设计
- 推荐策略：双写过渡模式，先验证后切换

### Metis Review
**高风险项**:
1. 并发写入冲突 - FSM 多节点并行需文件锁
2. 所有权验证丢失 - index.json 需存储 projectId
3. 崩溃恢复 - 最后消息可能部分写入

**强制要求 (MUST)**:
- 参考 session-manager.ts 第 211-240行的 addMessage() 实现模式
- 参考 session-manager.ts 第 424-445行的流式读取模式
- index.json 维护 projectId 和 messageCount
- 实现文件锁机制

**禁止事项 (MUST NOT)**:
- 直接删除 Prisma SessionMessage 模型（需保留过渡期）
- 使用同步文件操作（阻塞事件循环）

---

## Work Objectives

### Core Objective
实现 SessionMessage 的 JSONL 文件存储，解决外键约束问题，优化存储效率，支持流式写入和崩溃恢复。

### Concrete Deliverables
- `src/services/evaluation-message-store.ts` - 新服务（扩展 SessionManager）
- `outputs/sessions/{sessionId}/messages.jsonl` - 消息文件
- `outputs/sessions/{sessionId}/index.json` - 索引文件
- API routes 改造支持 JSONL 读写
- 双写过渡机制

### Definition of Done
- [ ] 所有写入点正确写入 JSONL 文件
- [ ] 所有读取点正确从 JSONL 文件读取
- [ ] 外键约束问题完全解决（无写入失败）
- [ ] 并发写入测试通过（无消息丢失或交错）
- [ ] 所有权验证正常工作
- [ ] 性能测试通过（消息读取 < 500ms）

### Must Have
- FSM/DAG 模式统一处理（无外键依赖）
- agentCallMsgId 子 Agent 消息归属标记
- nodeId 过滤效率（索引支持）
- 流式写入（append-only）
- 崩溃恢复（最后一行校验）

### Must NOT Have (Guardrails)
- 不阻塞主循环的同步文件操作
- 不删除 Prisma SessionMessage 模型（过渡期保留）
- 不破坏现有 API 返回格式兼容性
- 不丢失所有权验证逻辑

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (项目有 vitest 配置)
- **Automated tests**: YES (TDD + tests-after)
- **Framework**: vitest
- **Agent-Executed QA**: ALWAYS

### QA Policy
每个任务包含 Agent-Executed QA Scenarios：
- **写入验证**: 检查文件行数和内容完整性
- **读取验证**: API 返回正确格式和过滤结果
- **并发测试**: 多节点并行写入无冲突
- **崩溃恢复**: 模拟崩溃后数据完整性

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - 串行执行，建立基础设施):
├── Task 1: 创建 EvaluationMessageStore 服务骨架 [deep]
├── Task 2: 创建 outputs/sessions 目录结构 [quick]
├── Task 3: 定义 JSONL 消息类型和接口 [quick]
└── Task 4: 实现 appendMessage() 写入方法 [deep]

Wave 2 (核心功能 - 并行开发):
├── Task 5: 实现 getMessages() 流式读取 [deep]
├── Task 6: 实现 getMessageById() 单条查找 [quick]
├── Task 7: 实现文件锁机制 [deep]
├── Task 8: 实现 index.json 维护 [unspecified-high]
└── Task 9: 实现消息计数和汇总 [quick]

Wave 3 (集成改造 - 并行改造写入点):
├── Task 10: 改造 unified-execution-engine.ts 写入 [unspecified-high]
├── Task 11: 改造 history.ts 写入 [quick]
├── Task 12: 改造 ralph-loop-agent-wrapper.ts 写入 [quick]
├── Task 13: 实现双写过渡机制 [deep]
└── Task 14: 添加数据一致性验证 [unspecified-high]

Wave 4 (API 切换 - 并行改造读取点):
├── Task 15: 改造 evaluations/[id]/messages API [unspecified-high]
├── Task 16: 改造 evaluations/[id]/children API [unspecified-high]
├── Task 17: 改造 messages/[id] API [quick]
├── Task 18: 改造 evaluations/[id] 删除 API [quick]
└── Task 19: 添加 fallback 兜底机制 [unspecified-high]

Wave FINAL (验证和清理 - 并行审核):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real manual QA [unspecified-high]
└── Task F4: Scope fidelity check [deep]
```

---

## TODOs

- [x] 1. 创建 EvaluationMessageStore 服务骨架（使用成熟库）

  **What to do**:
  - 安装依赖：`npm install stream-json stream-chain proper-lockfile`
  - 创建 `src/services/evaluation-message-store.ts` 文件
  - 定义 `EvaluationMessageStore` 类，使用 stream-json 和 proper-lockfile
  - 定义基本属性：sessionDir, jsonlPath, indexPath
  - **使用 proper-lockfile 实现文件锁（Claude Code 官方方案）**

  **开源库用法**:
  ```typescript
  import lockfile from 'proper-lockfile';
  import { parser } from 'stream-json/jsonl/parser.js';
  import { stringer } from 'stream-json/jsonl/stringer.js';
  ```

  **Must NOT do**:
  - 不自研文件锁逻辑（使用 proper-lockfile）
  - 不自研 JSONL 解析器（使用 stream-json）
  - 不使用同步文件操作

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要深入理解现有 session-manager.ts 的设计，创建新的服务架构
  - **Skills**: []
    - 无需额外技能

  **Parallelization**:
  - **Can Run In Parallel**: NO (基础骨架，其他任务依赖)
  - **Parallel Group**: Wave 1 (Task 1)
  - **Blocks**: Tasks 2-14
  - **Blocked By**: None

  **References**:
  - **proper-lockfile npm** - 跨进程文件锁（Claude Code 官方使用）
  - **stream-json npm** - JSONL 专用 parser/stringer
  - `src/services/session-manager.ts:211-240` - 设计模式参考

  **安装命令**:
  ```bash
  npm install stream-json stream-chain async-lock
  ```

  **Acceptance Criteria**:
  - [ ] 文件已创建：src/services/evaluation-message-store.ts
  - [ ] 类定义完成：class EvaluationMessageStore
  - [ ] TypeScript 编译通过：npx tsc --noEmit

  **QA Scenarios**:
  ```
  Scenario: 服务骨架验证
    Tool: Bash
    Steps:
      1. npx tsc --noEmit src/services/evaluation-message-store.ts
      2. 检查编译输出无错误
    Expected Result: 编译成功，无 TypeScript 错误
    Evidence: .sisyphus/evidence/task-01-typescript-compile.txt
  ```

  **Commit**: NO (Wave 1 完成后统一提交)

- [x] 2. 创建 data/sessions 目录结构

  **What to do**:
  - 创建 `data/sessions/` 目录（如不存在）
  - 定义目录命名规范：`data/sessions/{projectId}/{sessionId}/`
  - projectId 格式：`proj-{timestamp}-{random}`（保持数据库原样）
  - sessionId 格式：`eval-{timestamp}-{random}`（保持数据库原样）
  - 添加 .gitignore 规则忽略会话文件

  **Must NOT do**:
  - 不创建测试会话目录（后续任务处理）
  - 不修改现有 data/skills 目录

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的目录创建和配置任务
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (与 Task 3 并行)
  - **Parallel Group**: Wave 1 (with Task 3)
  - **Blocks**: Task 4
  - **Blocked By**: Task 1

  **References**:
  - `data/skills/` - 现有目录结构参考
  - `.gitignore` - 添加忽略规则

  **Acceptance Criteria**:
  - [ ] data/sessions/ 目录存在
  - [ ] .gitignore 包含 `data/sessions/` 规则

  **QA Scenarios**:
  ```
  Scenario: 目录结构验证
    Tool: Bash
    Steps:
      1. Test-Path data/sessions
      2. Get-Content .gitignore | Select-String "data/sessions"
    Expected Result: 目录存在，gitignore 包含规则
    Evidence: .sisyphus/evidence/task-02-directory-structure.txt
  ```

  **Commit**: NO

- [x] 3. 定义 JSONL 消息类型和接口

  **What to do**:
  - 定义 `EvaluationMessage` 接口（区别于 Prisma SessionMessage）
  - 定义 `MessageIndex` 接口（index.json 结构）
  - 定义 `MessageSummary` 接口（summary.json 结构）
  - 包含：id, role, nodeId, nodeIndex, content, agentCallMsgId, timestamp

  **Must NOT do**:
  - 不使用 Prisma 生成的类型（完全独立）
  - 不包含外键字段（workflowNodeId 改为 nodeId 字符串）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 类型定义任务，简单明了
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (与 Task 2 并行)
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 4, 5
  - **Blocked By**: Task 1

  **References**:
  - `src/services/session-manager.ts:21-38` - SessionMessage 接口参考
  - `prisma/schema.prisma:858-871` - Prisma SessionMessage 字段对比

  **Acceptance Criteria**:
  - [ ] 类型定义完成：interface EvaluationMessage
  - [ ] 类型定义完成：interface MessageIndex
  - [ ] 无 workflowNodeId 外键字段

  **QA Scenarios**:
  ```
  Scenario: 类型验证
    Tool: Bash
    Steps:
      1. Select-String -Path src/services/evaluation-message-store.ts -Pattern "interface EvaluationMessage"
      2. Select-String -Path src/services/evaluation-message-store.ts -Pattern "interface MessageIndex"
    Expected Result: 两个接口都存在定义
    Evidence: .sisyphus/evidence/task-03-type-definitions.txt
  ```

  **Commit**: NO

- [x] 4. 实现 appendMessage() 写入方法（使用 async-lock）

  **What to do**:
  - 安装依赖：`npm install async-lock stream-json stream-chain`
  - 使用 `async-lock` 按 sessionId 锁定，防止并发写入冲突
  - 使用 `fs.appendFile()` 异步追加
  - 生成消息 ID（格式：`msg-{timestamp}-{random}`）
  - **不自研锁机制，直接使用 async-lock**

  **async-lock 用法**（比 proper-lockfile 更简单）:
  ```typescript
  import AsyncLock from 'async-lock';
  
  const lock = new AsyncLock({ timeout: 5000 });
  
  // 按 sessionId 锁定（同一会话串行写入）
  await lock.acquire(sessionId, async () => {
    const line = JSON.stringify(msg) + '\n';
    await fs.promises.appendFile(filePath, line);
  });
  ```

  **Must NOT do**:
  - 不使用 `fs.writeFileSync()`（阻塞）
  - 不自研文件锁逻辑

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 核心写入逻辑，需要参考现有实现并适配
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (核心写入方法，其他读取方法依赖)
  - **Parallel Group**: Wave 1 (Task 4)
  - **Blocks**: Tasks 5-14
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - `src/services/session-manager.ts:211-240` - addMessage() 设计模式参考
  - `src/lib/id-generator.ts` - ID 生成工具

  **Acceptance Criteria**:
  - [ ] appendMessage() 方法实现完成
  - [ ] 使用 async-lock 并发控制
  - [ ] 测试写入成功：JSONL 文件新增一行

  **QA Scenarios**:
  ```
  Scenario: 单条消息写入验证
    Tool: Bash (node script)
    Steps:
      1. 创建测试脚本调用 appendMessage()
      2. 检查 outputs/sessions/test-session/messages.jsonl 行数
      3. 解最后一行 JSON 验证完整性
    Expected Result: 文件新增 1 行，JSON 格式正确
    Evidence: .sisyphus/evidence/task-04-append-message.txt

  Scenario: 并发写入测试（10 条同时）
    Tool: Bash (node script)
    Steps:
      1. 创建 10 个并发 Promise 调用 appendMessage()
      2. 检查文件行数是否为 10
      3. 验证每行 JSON 独立完整
    Expected Result: 文件准确 10 行，无交错或丢失
    Evidence: .sisyphus/evidence/task-04-concurrent-write.txt
  ```

  **Commit**: YES (Wave 1 完成)
  - Message: `feat(storage): add EvaluationMessageStore service with appendMessage()`
  - Files: `src/services/evaluation-message-store.ts`, `outputs/sessions/.gitkeep`, `.gitignore`

- [x] 5. 实现 getMessages() 流式读取 [Wave 2]

  **What to do**: 参考 session-manager.ts:424-445 实现流式读取，支持 nodeId/agentCallMsgId 过滤和分页

  **References**: `src/services/session-manager.ts:424-445`, `src/app/api/evaluations/[id]/messages/route.ts:225-330`

  **QA Scenarios**: 写入 50 条消息到 3 个 nodeId，验证过滤正确性

  **Commit**: NO

- [x] 6. 实现 getMessageById() 单条查找 [Wave 2]

  **What to do**: 实现单条消息查找，优先使用缓存定位

  **QA Scenarios**: 写入消息后查找验证返回正确

  **Commit**: NO

- [x] 7. 实现并发写入控制（使用 async-lock） [Wave 2]

  **What to do**:
  - 安装 `async-lock`：`npm install async-lock`
  - 使用 async-lock 按 sessionId 锁定，防止同一会话并发写入
  - 单进程内存锁，API 极简（一行代码）
  - 支持超时配置

  **async-lock 用法**（比 proper-lockfile 更简单）:
  ```typescript
  import AsyncLock from 'async-lock';
  
  const lock = new AsyncLock({ timeout: 5000 });
  
  // 按 sessionId 锁定
  await lock.acquire(sessionId, async () => {
    await fs.promises.appendFile(filePath, JSON.stringify(msg) + '\n');
  });
  ```

  **Must NOT do**:
  - 不阻塞主循环等待锁释放（async-lock 已处理）
  - 不使用全局锁（按 sessionId 锁定）

  **QA Scenarios**: 100 并发写入测试，验证无交错

- [x] 8. 实现 index.json 维护 [Wave 2]

  **What to do**: 维护 projectId, messageCount, nodeIdRanges 索引

  **QA Scenarios**: 验证索引内容包含所有必需字段

  **Commit**: NO

- [x] 9. 实现消息计数和汇总 [Wave 2]

  **What to do**: getMessageCount() 和 getSummary() 方法

  **Commit**: YES (Wave 2)
  - Message: `feat(storage): implement getMessages, file lock, index maintenance`

- [x] 10. 改造 unified-execution-engine.ts 写入 [Wave 3]

  **What to do**: saveNodeMessage() 调用 JSONL，确保 nodeId 字符串和 agentCallMsgId 传递

  **References**: `src/lib/workflow/unified-execution-engine.ts:968-1010`, `src/lib/workflow/unified-execution-engine.ts:315-359`

  **QA Scenarios**: 启动 DAG 会话验证 JSONL 写入

  **Commit**: NO

- [x] 11. 改造 history.ts 写入 [Wave 3]

  **What to do**: addUserMessage/addAssistantMessage 调用 JSONL

  **Commit**: NO

- [x] 12. 改造 ralph-loop-agent-wrapper.ts 写入 [Wave 3]

  **What to do**: Ralph feedback (role='system') 写入 JSONL

  **Commit**: NO

- [x] 13. 实现双写过渡机制 [Wave 3]

  **What to do**: 同时写入 Prisma 和 JSONL，添加一致性验证

  **QA Scenarios**: 运行验证脚本对比数据一致性

  **Commit**: YES (Wave 3)
  - Message: `feat(storage): implement dual-write mechanism`

- [x] 14. 添加数据一致性验证 [Wave 3]

  **What to do**: 创建 scripts/verify-jsonl-consistency.ts 验证脚本

  **Commit**: NO

- [ ] 15. 改造 evaluations/[id]/messages API [Wave 4]

  **What to do**: API 改为从 JSONL 读取，保持返回格式兼容

  **References**: `src/app/api/evaluations/[id]/messages/route.ts:225-330`

  **QA Scenarios**: API 请求验证返回正确格式

  **Commit**: NO

- [ ] 16. 改造 evaluations/[id]/children API [Wave 4]

  **What to do**: 子 Agent API 从 JSONL 读取，提取 Agent/task 调用

  **Commit**: NO

- [ ] 17. 改造 messages/[id] API [Wave 4]

  **What to do**: 单条消息详情从 JSONL 查找

  **Commit**: NO

- [ ] 18. 改造 evaluations/[id] 删除 API [Wave 4]

  **What to do**: 删除会话时删除 JSONL 目录

  **Commit**: NO

- [ ] 19. 添加 fallback 兜底机制 [Wave 4]

  **What to do**: JSONL 读取失败时 fallback 到 Prisma（过渡期）

  **Commit**: YES (Wave 4)
  - Message: `feat(storage): switch API to JSONL storage with fallback`

---

## Final Verification Wave

> **复核机制**：每个 Wave 完成后必须进行验证，全部通过才能进入下一 Wave。

### Wave 1 完成复核
- [x] W1-1. TypeScript 编译验证
  ```bash
  npx tsc --noEmit src/services/evaluation-message-store.ts
  ```
- [x] W1-2. 目录结构验证
  ```bash
  Test-Path data/sessions && Get-Content .gitignore | Select-String "data/sessions"
  ```
- [x] W1-3. 单条消息写入测试
  ```bash
  node scripts/test-append-message.js
  ```
- [x] W1-4. 并发写入测试（10条）
  ```bash
  node scripts/test-concurrent-write.js
  ```

### Wave 2 完成复核
- [x] W2-1. nodeId 过滤验证
- [x] W2-2. 单条消息查找验证
- [x] W2-3. 100 并发写入测试
- [x] W2-4. 索引内容验证

### Wave 3 完成复核
- [x] W3-1. 双写一致性验证
  ```bash
  npm run verify-jsonl-consistency
  ```
  结果：验证脚本运行成功，现有会话无 JSONL 文件（预期行为，双写仅对新会话生效）
- [ ] W3-2. DAG 会话实际写入验证
- [ ] W3-3. FSM 会话实际写入验证

### Wave 4 完成复核
- [ ] W4-1. API 返回格式验证（与现有格式兼容）
- [ ] W4-2. nodeId 过滤 API 验证
- [ ] W4-3. 子 Agent API 验证
- [ ] W4-4. 删除会话验证（JSONL 目录正确删除）

### Final 综合复核
- [ ] F1. Plan compliance audit [oracle]
  **What to do**: 验证所有 MUST/MUST NOT 要求已满足
  
- [ ] F2. Code quality review [unspecified-high]
  **What to do**: TypeScript 编译 + ESLint + 测试运行
  
- [ ] F3. Real manual QA [unspecified-high]
  **What to do**: 启动完整 DAG/FSM 会话验证消息流程
  
- [ ] F4. Scope fidelity check [deep]
  **What to do**: 验证无 scope creep，所有改动符合计划

---

## Commit Strategy

**Wave 1**: `feat(storage): add EvaluationMessageStore service with appendMessage()`
**Wave 2**: `feat(storage): implement getMessages, async-lock, index maintenance`
**Wave 3**: `feat(storage): implement dual-write mechanism`
**Wave 4**: `feat(storage): switch API to JSONL storage with fallback`
**Final**: `feat(storage): complete SessionMessage JSONL migration`

---

## Success Criteria

### Verification Commands
```bash
# TypeScript 编译
npx tsc --noEmit

# 一致性验证
npm run verify-jsonl-consistency

# 并发写入测试
node scripts/test-concurrent-write.js

# API 验证
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/evaluations/$ID/messages?nodeId=node-1"
```

### Final Checklist
- [ ] 外键约束问题完全解决（无写入失败）
- [ ] 所有写入点正确写入 JSONL
- [ ] 所有读取点正确读取 JSONL
- [ ] 并发写入测试通过（100条无交错）
- [ ] 所有权验证正常（projectId 验证）
- [ ] API 返回格式兼容（前端无感知）
- [ ] 双写一致性验证通过
- [ ] TypeScript 编译无错误