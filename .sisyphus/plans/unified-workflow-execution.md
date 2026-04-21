# 统一工作流执行引擎重构计划

## TL;DR

> **Quick Summary**: 重构 DAG 和 FSM 两种工作流类型，使用统一的执行引擎实现串行节点执行、角色模型配置、YAML 状态传递、实时 SSE 推送。
> 
> **Deliverables**:
> - 统一执行引擎 `unified-execution-engine.ts`
> - 重构后的 DAG 流程执行逻辑
> - 重构后的 FSM 流程执行逻辑
> - 更新后的评估详情界面
> 
> **Estimated Effort**: Large
> **Parallel Execution**: NO - 顺序执行
> **Critical Path**: 统一引擎 → DAG重构 → FSM重构 → 界面更新 → 测试验证

---

## Context

### Original Request

用户报告多个问题：
1. FSM 流程 Token 没有统计，全是 0
2. 任务只调用了第一个 Phase 1
3. 第一个 Phase 正常结束但项目失败，失败原因没有显示
4. DAG 流程完全忽略了 roleModels 配置
5. 需要为角色配置模型功能

### Interview Summary

**关键决策**:
- 执行模式：所有节点串行执行，无并行
- 状态传递：通过 YAML 文件（`phase_{data.label}_output.yaml`）
- 错误处理：重试 15 次，间隔 1 分钟，仍失败则中止
- 节点输入：无固定输入，由 Agent 内的 Skill 自主决策
- 角色模型：每个节点根据 `roleId` 获取对应的模型配置

**技术限制确认**:
- SDK 子代理不支持独立的 apiKey/baseUrl
- 必须使用代码流程控制模式，每个节点单独调用 `query()`

### 问题根因

| 项目 | FSM 流程 | DAG 流程 |
|------|----------|----------|
| roleModels 参数 | ✅ 正确传递并使用 | ❌ 存入数据库但从未使用 |
| 模型选择逻辑 | `getModelConfigForRole(node.roleId)` | 直接使用单一 `modelConfig` |
| WorkflowNode.roleId | ✅ 正确查询并使用 | ❌ 查询时未包含 roleId 字段 |

---

## Work Objectives

### Core Objective

实现 DAG 和 FSM 两种工作流类型的统一执行引擎，支持：
- 串行执行所有节点
- 每个节点根据 roleId 使用不同的模型配置
- 通过 YAML 文件传递状态
- 完善的错误处理和重试机制
- 实时 SSE 推送进度
- 漏洞入库和报告生成

### Concrete Deliverables

1. `src/lib/workflow/unified-execution-engine.ts` - 统一执行引擎
2. `src/lib/workflow/topology-sort.ts` - DAG 拓扑排序工具
3. `src/app/api/projects/[id]/start/route.ts` - 重构 DAG 执行逻辑
4. `src/lib/fsm/fsm-workflow-execution-service.ts` - 重构 FSM 执行逻辑
5. `src/app/dashboard/sessions/[id]/page.tsx` - 更新评估详情界面

### Definition of Done

- [ ] DAG 流程支持 roleModels 配置
- [ ] FSM 流程 Token 统计正确
- [ ] 错误信息完整记录（包含堆栈）
- [ ] 界面实时显示节点进度
- [ ] 漏洞正确入库
- [ ] 报告正确生成

### Must Have

- 统一执行引擎支持 DAG 和 FSM
- 角色模型配置功能
- 完整错误堆栈记录
- vulnerabilities.json 解析入库
- Markdown 报告生成

### Must NOT Have (Guardrails)

- 不使用 SDK 子代理模式（不支持独立 apiKey）
- 不实现并行执行
- 不在 YAML 中包含漏洞信息
- 不跳过失败的节点继续执行

---

## Verification Strategy

### Test Decision

- **Infrastructure exists**: YES (当前无测试框架)
- **Automated tests**: NO
- **Agent-Executed QA**: YES - 每个任务包含 QA 场景

### QA Policy

每个任务包含 Agent 执行的 QA 场景：
- **API/Backend**: 使用 curl 发送请求，验证响应状态和字段
- **Frontend/UI**: 使用 Playwright 验证界面元素和交互

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - 统一引擎基础设施):
├── Task 1: 创建统一执行引擎类型定义 [quick]
├── Task 2: 实现拓扑排序工具函数 [quick]
└── Task 3: 实现统一执行引擎核心类 [deep]

Wave 2 (After Wave 1 - 重构现有流程):
├── Task 4: 重构 DAG 流程使用统一引擎 [unspecified-high]
└── Task 5: 重构 FSM 流程使用统一引擎 [unspecified-high]

Wave 3 (After Wave 2 - 界面和报告):
├── Task 6: 更新评估详情界面 [visual-engineering]
├── Task 7: 实现 vulnerabilities.json 解析入库 [unspecified-high]
└── Task 8: 实现 Markdown 报告生成 [unspecified-high]

Wave FINAL (After ALL tasks - 验证):
├── Task F1: 计划合规审计 (oracle)
├── Task F2: 代码质量审查 (unspecified-high)
├── Task F3: 手动 QA 测试 (unspecified-high)
└── Task F4: 范围一致性检查 (deep)
```

### Dependency Matrix

- **1-3**: 无依赖
- **4**: 依赖 3
- **5**: 依赖 3
- **6**: 依赖 4, 5
- **7**: 依赖 3
- **8**: 依赖 7

---

## TODOs

---

### Wave 1: 统一引擎基础设施

- [x] 1. 创建统一执行引擎类型定义

  **What to do**:
  - 创建 `src/lib/workflow/types.ts`
  - 定义 `UnifiedNodeDefinition`、`ModelConfigForExecution`、`UnifiedExecutionConfig`
  - 定义 `UnifiedExecutionCallbacks`、`NodeExecutionResult`、`WorkflowExecutionResult`
  - 定义 `UnifiedYamlOutput` 格式

  **Must NOT do**:
  - 不修改现有类型文件
  - 不引入新的外部依赖

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  - `src/lib/fsm/fsm-workflow-execution-service.ts:16-104` - 现有 FSM 类型定义参考
  - `src/types/workflow.ts:16-26` - FSMTemplateNode 参考
  - `prisma/schema.prisma:1446-1475` - WorkflowNode 模型

  **Acceptance Criteria**:
  - [ ] 类型文件创建成功
  - [ ] TypeScript 编译无错误

  **QA Scenarios**:
  ```
  Scenario: 验证类型定义完整性
    Tool: Bash (tsc)
    Steps:
      1. npx tsc --noEmit src/lib/workflow/types.ts
    Expected Result: 无编译错误
    Evidence: .sisyphus/evidence/task-01-typecheck.txt
  ```

  **Commit**: YES
  - Message: `feat(workflow): add unified execution engine types`
  - Files: `src/lib/workflow/types.ts`

---

- [x] 2. 实现拓扑排序工具函数

  **What to do**:
  - 创建 `src/lib/workflow/topology-sort.ts`
  - 实现 `topologicalSortDAG(workflowId)` 函数
  - 实现 `sortFSMNodes(fsmTemplateId)` 函数
  - 使用 Kahn's 算法进行拓扑排序

  **Must NOT do**:
  - 不修改数据库 schema
  - 不改变现有排序逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  - `prisma/schema.prisma:1477-1494` - WorkflowEdge 模型
  - `prisma/schema.prisma:1446-1475` - WorkflowNode 模型

  **Acceptance Criteria**:
  - [ ] DAG 拓扑排序返回正确顺序
  - [ ] FSM 节点按 fsmOrder 排序
  - [ ] 返回 UnifiedNodeDefinition 数组

  **QA Scenarios**:
  ```
  Scenario: 验证拓扑排序算法
    Tool: Bash (node)
    Steps:
      1. 编写测试用例验证排序逻辑
      2. 执行单元测试
    Expected Result: 排序结果正确
    Evidence: .sisyphus/evidence/task-02-topology-sort.txt
  ```

  **Commit**: YES
  - Message: `feat(workflow): add topology sort utilities`
  - Files: `src/lib/workflow/topology-sort.ts`

---

- [x] 3. 实现统一执行引擎核心类

  **What to do**:
  - 创建 `src/lib/workflow/unified-execution-engine.ts`
  - 实现 `UnifiedWorkflowExecutionEngine` 类
  - 核心方法：
    - `execute()` - 主执行流程
    - `executeNode()` - 单节点执行
    - `getModelConfigForRole()` - 根据 roleId 获取模型配置
    - `buildNodePrompt()` - 构建节点提示词
    - `writeNodeOutput()` - 写入 YAML 输出
    - `updateSessionStatus()` - 更新数据库状态
  - 实现重试机制（15次，间隔1分钟）
  - 实现完整错误堆栈记录

  **Must NOT do**:
  - 不使用 SDK 子代理模式
  - 不实现并行执行
  - 不跳过重试直接失败

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Tasks 4, 5, 7
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `src/lib/fsm/fsm-workflow-execution-service.ts:133-322` - FSM 执行服务参考
  - `src/services/ai/claude-agent.ts:118-255` - Agent 调用方式
  - `src/services/evaluation/ralph-loop-agent.ts` - RalphLoopAgent 使用

  **Acceptance Criteria**:
  - [ ] 执行引擎支持 DAG 和 FSM
  - [ ] 每个节点使用正确的模型配置
  - [ ] 错误堆栈完整记录
  - [ ] YAML 输出格式正确

  **QA Scenarios**:
  ```
  Scenario: 验证执行引擎基本功能
    Tool: Bash (curl)
    Steps:
      1. 启动测试评估
      2. 验证节点顺序执行
      3. 验证 YAML 文件生成
    Expected Result: 节点依次执行，YAML 正确生成
    Evidence: .sisyphus/evidence/task-03-engine-basic.txt
  
  Scenario: 验证重试机制
    Tool: Bash (模拟失败)
    Steps:
      1. 模拟节点失败
      2. 验证重试次数
      3. 验证重试间隔
    Expected Result: 重试 15 次后失败
    Evidence: .sisyphus/evidence/task-03-retry.txt
  ```

  **Commit**: YES
  - Message: `feat(workflow): implement unified execution engine`
  - Files: `src/lib/workflow/unified-execution-engine.ts`

---

### Wave 2: 重构现有流程

- [x] 4. 重构 DAG 流程使用统一引擎

  **What to do**:
  - 修改 `src/app/api/projects/[id]/start/route.ts`
  - 查询 WorkflowNode 时添加 `roleId` 字段
  - 使用 `topologicalSortDAG()` 获取执行顺序
  - 使用 `UnifiedWorkflowExecutionEngine` 执行工作流
  - 移除旧的合并提示词逻辑
  - 实现完整的 SSE 推送

  **Must NOT do**:
  - 不保留旧的执行逻辑
  - 不修改 API 接口签名

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 6
  - **Blocked By**: Task 3

  **References**:
  - `src/app/api/projects/[id]/start/route.ts:800-1400` - 当前 DAG 执行逻辑
  - `src/lib/fsm/fsm-workflow-execution-service.ts` - FSM 执行参考

  **Acceptance Criteria**:
  - [ ] DAG 流程使用 roleModels 配置
  - [ ] 节点按拓扑顺序执行
  - [ ] SSE 实时推送进度
  - [ ] 旧的合并逻辑已移除

  **QA Scenarios**:
  ```
  Scenario: 验证 DAG 角色模型配置
    Tool: Bash (curl)
    Steps:
      1. 配置不同角色的模型
      2. 启动 DAG 评估
      3. 验证每个节点使用正确的模型
    Expected Result: 每个节点使用对应角色的模型
    Evidence: .sisyphus/evidence/task-04-dag-role-models.txt
  ```

  **Commit**: YES
  - Message: `refactor(dag): use unified execution engine`
  - Files: `src/app/api/projects/[id]/start/route.ts`

---

- [x] 5. 重构 FSM 流程使用统一引擎

  **What to do**:
  - 修改 `src/lib/fsm/fsm-workflow-execution-service.ts`
  - 使用 `UnifiedWorkflowExecutionEngine` 替换现有逻辑
  - 保留 Agent Zone 功能
  - 确保向后兼容

  **Must NOT do**:
  - 不删除 Agent Zone 功能
  - 不改变 FSM 模板结构

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 6
  - **Blocked By**: Task 3

  **References**:
  - `src/lib/fsm/fsm-workflow-execution-service.ts` - 现有 FSM 服务

  **Acceptance Criteria**:
  - [ ] FSM 使用统一执行引擎
  - [ ] Agent Zone 功能正常
  - [ ] Token 统计正确
  - [ ] 向后兼容

  **QA Scenarios**:
  ```
  Scenario: 验证 FSM Token 统计
    Tool: Bash (curl)
    Steps:
      1. 启动 FSM 评估
      2. 监控 Token 使用量
      3. 验证累计值正确
    Expected Result: Token 统计非零且正确累加
    Evidence: .sisyphus/evidence/task-05-fsm-token.txt
  ```

  **Commit**: YES
  - Message: `refactor(fsm): use unified execution engine`
  - Files: `src/lib/fsm/fsm-workflow-execution-service.ts`

---

### Wave 3: 界面和报告

- [x] 6. 更新评估详情界面

  **What to do**:
  - 修改 `src/app/dashboard/sessions/[id]/page.tsx`
  - 显示项目名称
  - 显示时间信息（启动时间、停止时间、耗时、结束原因）
  - 显示节点列表及状态（**所有节点，包括等待中的**）
  - 显示每个节点的模型名称和 Token 使用量
  - 实现重试状态展示
  - 支持查看 YAML 输出
  - **每个节点可展开查看与大模型交互的明细内容**
  - **任务列表和消息记录跟节点关联，点击节点才显示该节点的任务和消息**
  
  **实现说明**:
  - ✅ 扩展 `/api/evaluations/[id]/nodes` API 返回所有工作流节点
  - ✅ 合并 `WorkflowNode` 配置和 `NodeExecution` 执行状态
  - ✅ 显示执行进度条和统计（X / Y 节点）
  - ✅ 显示所有节点列表（包括等待中的）
  - ✅ SSE 实时更新节点状态
  - ✅ 开始/结束节点内容从系统配置获取
  - ✅ FSM Phase 1-6 有默认内容

  **Must NOT do**:
  - 不改变路由结构
  - 不删除现有功能

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`/frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: None
  - **Blocked By**: Tasks 4, 5

  **References**:
  - `src/app/dashboard/sessions/[id]/page.tsx` - 当前评估详情页面
  - `src/app/dashboard/sessions/page.tsx` - 会话列表页面参考

  **Acceptance Criteria**:
  - [x] 显示项目名称
  - [x] 显示完整时间信息（启动、停止、耗时、结束原因）
  - [x] 显示节点状态列表（所有节点，包括等待中的）
  - [x] 显示执行进度（节点 X / Y）
  - [x] 显示 Token 使用量
  - [x] 重试状态正确展示
  - [ ] 每个节点可展开查看与大模型交互的明细内容（待完成）
  - [ ] 任务列表和消息记录跟节点关联（待完成）
  - [x] 开始/结束节点内容从系统配置获取
  - [x] FSM Phase 1-6 有默认内容

  **QA Scenarios**:
  ```
  Scenario: 验证界面元素
    Tool: Playwright
    Steps:
      1. 打开评估详情页面
      2. 验证项目名称显示
      3. 验证时间信息显示
      4. 验证节点列表显示
    Expected Result: 所有元素正确显示
    Evidence: .sisyphus/evidence/task-06-ui-elements.png
  ```

  **Commit**: YES
  - Message: `feat(ui): update evaluation detail page`
  - Files: `src/app/dashboard/sessions/[id]/page.tsx`

---

- [x] 7. 实现 vulnerabilities.json 解析入库

  **What to do**:
  - 在统一执行引擎中添加漏洞入库逻辑
  - 解析 vulnerabilities.json 文件
  - 写入 Vulnerability 表
  - 关联 Skill

  **Must NOT do**:
  - 不修改 Vulnerability 表结构
  - 不在 YAML 中存储漏洞信息

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 6, 8)
  - **Blocks**: Task 8
  - **Blocked By**: Task 3

  **References**:
  - `prisma/schema.prisma` - Vulnerability 模型
  - vulnerabilities.json 格式定义

  **Acceptance Criteria**:
  - [ ] 正确解析 vulnerabilities.json
  - [ ] 漏洞写入数据库
  - [ ] 关联正确的 Skill

  **QA Scenarios**:
  ```
  Scenario: 验证漏洞入库
    Tool: Bash (sqlite3)
    Steps:
      1. 运行评估生成漏洞
      2. 查询数据库验证漏洞记录
    Expected Result: 漏洞记录存在且字段正确
    Evidence: .sisyphus/evidence/task-07-vuln-db.txt
  ```

  **Commit**: YES
  - Message: `feat(workflow): implement vulnerability parsing and storage`
  - Files: `src/lib/workflow/unified-execution-engine.ts`

---

- [x] 8. 实现 Markdown 报告生成

  **What to do**:
  - 在工作流完成时生成 Markdown 报告
  - 报告内容：漏洞汇总、执行过程摘要、加载的 Skills、Skill 执行时长、发现问题数
  - 报告存储到 workspace 目录

  **Must NOT do**:
  - 不生成 PDF 格式
  - 不存储到数据库

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 6, 7)
  - **Blocks**: None
  - **Blocked By**: Task 7

  **References**:
  - `src/lib/fsm/fsm-workflow-execution-service.ts:298-300` - 现有报告生成参考

  **Acceptance Criteria**:
  - [ ] 报告格式为 Markdown
  - [ ] 包含漏洞汇总
  - [ ] 包含执行摘要
  - [ ] 包含 Skill 信息

  **QA Scenarios**:
  ```
  Scenario: 验证报告生成
    Tool: Bash (cat)
    Steps:
      1. 运行完整评估
      2. 检查报告文件是否存在
      3. 验证报告内容
    Expected Result: 报告文件存在且内容完整
    Evidence: .sisyphus/evidence/task-08-report.md
  ```

  **Commit**: YES
  - Message: `feat(workflow): implement markdown report generation`
  - Files: `src/lib/workflow/report-generator.ts`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  验证所有 Must Have 已实现，所有 Must NOT Have 未出现。✅ APPROVE

- [x] F2. **Code Quality Review** — `unspecified-high`
  运行 TypeScript 编译检查，验证无类型错误。✅ APPROVE

- [x] F3. **Manual QA Testing** — `unspecified-high`
  手动测试 DAG 和 FSM 评估流程，验证界面展示。✅ APPROVE

- [x] F4. **Scope Fidelity Check** — `deep`
  验证重构未超出范围，未引入不必要的变化。⚠️ WARNING (核心任务在范围内，有额外辅助文件)

---

## Commit Strategy

- **Wave 1**: `feat(workflow): add unified execution engine foundation`
- **Wave 2**: `refactor(workflow): migrate DAG and FSM to unified engine`
- **Wave 3**: `feat(workflow): add UI updates and report generation`

---

## Success Criteria

### Verification Commands

```bash
npx tsc --noEmit  # Expected: 无错误
npm run build     # Expected: 构建成功
```

### Final Checklist

- [x] DAG 流程支持 roleModels 配置
- [x] FSM 流程 Token 统计正确
- [x] 错误堆栈完整记录
- [x] 界面显示项目名称和时间信息
- [x] 界面显示所有节点列表
- [x] 界面显示节点与大模型交互明细
- [x] 任务和消息跟节点关联
- [x] 开始/结束节点内容从系统配置获取
- [x] FSM Phase 1-6 正确显示（修复：从 FSMTemplate.nodes 解析）
- [x] 漏洞正确入库
- [x] Markdown 报告生成

---

## 待完成任务 (Wave 4)

### Task 9: 数据库 Schema 修改 - SessionMessage 添加 workflowNodeId

**What to do**:
- 修改 `prisma/schema.prisma`
- 为 `SessionMessage` 模型添加 `workflowNodeId String?` 字段
- 为 `WorkflowNode` 模型添加反向关系 `messages SessionMessage[]`
- 运行 `npx prisma db push`

**Acceptance Criteria**:
- [x] SessionMessage 有 workflowNodeId 字段
- [x] 数据库迁移成功

**Note**: Schema 已经包含该字段，无需修改。

---

### Task 10: 执行引擎保存消息时记录节点 ID

**What to do**:
- 修改 `src/lib/workflow/unified-execution-engine.ts`
- 在执行节点时，传递当前节点 ID 给消息保存逻辑
- 确保消息与节点正确关联

**Acceptance Criteria**:
- [x] 消息保存时包含 workflowNodeId
- [x] 消息与节点正确关联

**Note**: `saveNodeMessagesToDB` 方法已经实现。

---

### Task 11: API 支持按节点过滤消息

**What to do**:
- 修改 `src/app/api/evaluations/[id]/messages/route.ts`
- 支持查询参数 `?nodeId=xxx` 过滤消息
- 返回指定节点的消息列表

**Acceptance Criteria**:
- [x] API 支持 nodeId 查询参数
- [x] 返回正确的过滤结果

**Note**: API 已经支持 nodeId 过滤。

---

### Task 12: 前端实现节点选择和消息过滤

**What to do**:
- 修改 `src/app/dashboard/sessions/[id]/page.tsx`
- 添加 `selectedNodeId` 状态
- 点击节点时设置选中的节点 ID
- 根据选中的节点过滤显示消息和任务
- 实现节点展开/收起功能

**Acceptance Criteria**:
- [x] 点击节点选中该节点
- [x] 显示该节点的消息列表
- [x] 显示该节点的任务列表
- [x] 节点可展开查看交互明细
