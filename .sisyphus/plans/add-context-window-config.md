# Plan: Token 超限动态处理机制 - SDK Compaction

## TL;DR

> **目标**: 实现完整的 token 超限处理机制：数据库配置 contextWindow + 动态计算 maxTokens + 失败重试 + **SDK Compaction**（使用 Claude Agent SDK 内置压缩功能）
> 
> **交付物**:
> - ModelConfig 表添加 `contextWindow` 字段（默认值 0）
> - 前端界面显示 contextWindow（只读）+ 复位按钮
> - 动态 maxTokens 计算函数
> - 错误解析与智能学习
> - **SDK Compaction 配置**（autoCompactWindow + PreCompact/PostCompact Hooks）
> 
> **执行策略**: Wave 1-3 并行执行，依赖任务按序完成
> 
> **验证策略**: Agent-Executed QA（每个 TODO 完成后运行验证脚本）

---

## Context

### 原始需求
评估过程中遇到 token 超限错误（MiniMax M2.5 实际限制 163,804 tokens）。

### 用户确认的约束
- "contextWindow 在界面的值默认为0, 0代表就以maxtoken为准"
- "第一次调用超限时报错，再错误学习"
- "不要 SDK 用默认值, 先设置一个很大的值，例如 1M"
- "contextWindow 在模型界面不能编辑，只能可看，值>0时可点击复位到0"
- "我压缩方式不需要编码，直接使用 Claude 的能力"
- buffer = 1000 tokens
- inputTokens: API 计数优先，估算 fallback（4字符=1token）

### 设计方案

| 参数 | 方案 |
|------|------|
| **buffer** | 1000 tokens |
| **inputTokens** | 先调 API 计数 → 失败则估算（4字符=1token） |
| **计算时机** | 调用失败时计算并重试 |
| **contextWindow** | 数据库字段，**默认值 0**，界面只读显示 |

### contextWindow 特殊值
- **contextWindow = 0**：不启用动态计算，直接使用配置的 maxTokens
- **contextWindow > 0**：启用动态计算

### 动态计算公式
```typescript
if (contextWindow > 0) {
  safeMaxTokens = min(config.maxTokens, contextWindow - inputTokens - buffer)
  safeMaxTokens = max(safeMaxTokens, MIN_TOKENS)  // 最小值保护
} else {
  safeMaxTokens = config.maxTokens  // 使用原配置
}
```

### SDK Compaction 策略

#### 自动学习流程
```
1. SDK 初始化时设置 autoCompactWindow = 1000000（或数据库值）
2. 第一次调用超限 → API 返回错误："context length is only XXX tokens"
3. parseContextWindowFromError() → 提取实际 contextWindow（如 163804）
4. 自动写入数据库 ModelConfig.contextWindow
5. 下次调用时从数据库读取正确值
```

#### SDK Options 配置点
文件: `src/services/ai/claude-agent.ts` 第 162-201 行

---

## Work Objectives

### 核心目标
添加 `contextWindow` 配置能力，支持 token 超限智能处理。

### Definition of Done
- [ ] Prisma schema 更新完成
- [ ] 数据库字段存在
- [ ] API POST/PUT 支持 contextWindow
- [ ] Reset API 端点可用
- [ ] 前端显示 contextWindow + 复位按钮
- [ ] Token 计数函数可用
- [ ] 安全 maxTokens 计算函数可用
- [ ] 错误解析函数可用
- [ ] SDK Compaction 配置完成

---

## Execution Strategy

### Wave 1 (基础 - 可并行)
- Task 1: Schema 添加 contextWindow
- Task 2: 创建 token-counter.ts
- Task 3: 创建 safe-max-tokens.ts
- Task 4: 创建 error-parser.ts
- Task 5: 创建 reset-context-window API
- Task 6: 修改 models API routes
- Task 7: 前端 contextWindow 显示

### Wave 2 (集成 - 依赖 Wave 1)
- Task 8: 运行 db:push + db:generate
- Task 9: SDK Compaction 配置
- Task 10: PreCompact Hook
- Task 11: PostCompact Hook

### Wave 3 (传递 - 依赖 Wave 2)
- Task 12: FSM 传递 contextWindow

### Wave Final (验证)
- Task F1-F4: 最终验证

---

## TODOs

- [ ] 1. **Prisma Schema 添加 contextWindow 字段**

  **What to do**:
  - 编辑 `prisma/schema.prisma`
  - 在 ModelConfig 模型的 maxTokens 之后添加字段
  
  **实现代码**:
  ```prisma
  model ModelConfig {
    // ... existing fields ...
    maxTokens           Int                   @default(32000)
    contextWindow       Int                   @default(0) // 模型的 context window 大小，0 表示不启用动态计算
    temperature         Float                 @default(0.3)
    // ... rest ...
  }
  ```
  
  **位置**: 第 520 行（在 maxTokens 和 temperature 之间）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [] (无特殊技能需要)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-7)
  - **Blocks**: Task 5, Task 6, Task 8
  - **Blocked By**: None

  **QA Scenarios**:
  ```
  Scenario: Schema modification successful
    Tool: Bash
    Steps:
      1. grep schema for "contextWindow" pattern
    Expected Result: Line found with "contextWindow Int @default(0)"
    Evidence: .sisyphus/evidence/task-01-schema.txt
  ```

  **Commit**: YES (单独 commit)
  - Message: `feat(schema): add contextWindow field to ModelConfig`
  - Files: `prisma/schema.prisma`

- [ ] 2. **创建 token-counter.ts**

  **What to do**:
  - 创建新文件 `src/lib/token-counter.ts`
  - 实现 token 估算函数
  
  **实现代码**:
  ```typescript
  /**
   * Token 计数工具
   * 估算规则：平均 4字符 = 1token
   * 每条消息额外加 4 tokens 用于格式开销
   */

  /**
   * 估算消息列表的 token 数
   */
  export function countTokens(messages: Array<{role: string; content: string | any[]}>): number {
    let total = 0;
    for (const msg of messages) {
      total += 4; // 消息格式开销
      if (typeof msg.content === 'string') {
        total += Math.ceil(msg.content.length / 4);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            total += Math.ceil(part.text.length / 4);
          }
        }
      }
    }
    return total;
  }

  /**
   * 估算单段文本的 token 数
   */
  export function estimateTextTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None
  - **Blocked By**: None

  **QA Scenarios**:
  ```
  Scenario: File created successfully
    Tool: Bash
    Steps:
      1. Test-Path src/lib/token-counter.ts
    Expected Result: True
    Evidence: .sisyphus/evidence/task-02-file-exists.txt
  
  Scenario: Function exports correctly
    Tool: Bash
    Steps:
      1. grep "export function countTokens" src/lib/token-counter.ts
    Expected Result: Line found
  ```

  **Commit**: YES (group with Tasks 3-4)
  - Message: `feat(lib): add token counting utilities`
  - Files: `src/lib/token-counter.ts`, `src/lib/safe-max-tokens.ts`, `src/lib/error-parser.ts`

- [ ] 3. **创建 safe-max-tokens.ts**

  **What to do**:
  - 创建新文件 `src/lib/safe-max-tokens.ts`
  
  **实现代码**:
  ```typescript
  /**
   * 动态计算安全的 maxTokens 值
   */

  const BUFFER = 1000; // 安全缓冲区
  const MIN_TOKENS = 1024; // 最小输出 token 数

  /**
   * 计算安全的 maxTokens
   * 
   * @param maxTokens - 配置的最大 token 数
   * @param contextWindow - 模型的 context window（0 表示不启用动态计算）
   * @param inputTokens - 当前已使用的 input token 数
   */
  export function calculateSafeMaxTokens(
    maxTokens: number,
    contextWindow: number,
    inputTokens: number
  ): number {
    // contextWindow = 0 时，不启用动态计算
    if (contextWindow <= 0) {
      return Math.max(maxTokens, MIN_TOKENS);
    }
    
    // 动态计算: contextWindow - inputTokens - buffer
    const availableTokens = contextWindow - inputTokens - BUFFER;
    const safeTokens = Math.min(maxTokens, availableTokens);
    
    return Math.max(safeTokens, MIN_TOKENS);
  }

  export { BUFFER, MIN_TOKENS };
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**: Wave 1, parallel

  **QA Scenarios**:
  ```
  Scenario: Function works correctly
    Tool: Bash (node REPL)
    Steps:
      1. Import calculateSafeMaxTokens
      2. Test: calculateSafeMaxTokens(4096, 0, 1000) → expect 4096
      3. Test: calculateSafeMaxTokens(4096, 8192, 2000) → expect 5192
    Evidence: .sisyphus/evidence/task-03-function-test.txt
  ```

  **Commit**: YES (group with Tasks 2-4)

- [ ] 4. **创建 error-parser.ts**

  **What to do**:
  - 创建新文件 `src/lib/error-parser.ts`
  
  **实现代码**:
  ```typescript
  /**
   * 错误解析工具 - 从 API 错误信息中提取 contextWindow
   */

  /**
   * 从 API 错误信息中提取 contextWindow
   */
  export function parseContextWindowFromError(error: string | any): number | null {
    const errorStr = typeof error === 'string' 
      ? error 
      : (error?.message || error?.error?.message || error?.error || JSON.stringify(error));
    
    if (!errorStr || typeof errorStr !== 'string') return null;
    
    const patterns = [
      /context length is only (\d+) tokens/i,
      /context length is (\d+) tokens/i,
      /model's context length is only (\d+)/i,
      /this model's context length is (\d+)/i,
      /context window is (\d+)/i,
      /max context is (\d+)/i,
      /maximum context length is (\d+)/i,
    ];
    
    for (const pattern of patterns) {
      const match = errorStr.match(pattern);
      if (match && match[1]) {
        const value = parseInt(match[1], 10);
        if (value > 1000 && value < 2000000) return value;
      }
    }
    return null;
  }

  /**
   * 从错误信息中提取输入 token 数
   */
  export function parseInputTokensFromError(error: string | any): number | null {
    const errorStr = typeof error === 'string' 
      ? error 
      : (error?.message || JSON.stringify(error));
    if (!errorStr) return null;
    
    const patterns = [
      /passed (\d+) input tokens/i,
      /input tokens: (\d+)/i,
      /(\d+) input tokens/i,
    ];
    
    for (const pattern of patterns) {
      const match = errorStr.match(pattern);
      if (match && match[1]) {
        const value = parseInt(match[1], 10);
        if (value > 0 && value < 2000000) return value;
      }
    }
    return null;
  }

  /**
   * 解析完整的上下文错误信息
   */
  export function parseContextError(error: string | any): {
    contextWindow: number | null;
    inputTokens: number | null;
    overflow: number | null;
  } {
    const contextWindow = parseContextWindowFromError(error);
    const inputTokens = parseInputTokensFromError(error);
    const overflow = (contextWindow && inputTokens) ? inputTokens - contextWindow : null;
    return { contextWindow, inputTokens, overflow };
  }
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**: Wave 1, parallel

  **QA Scenarios**:
  ```
  Scenario: Parse Anthropic-style error
    Tool: Bash (node REPL)
    Steps:
      1. Import parseContextWindowFromError
      2. Test: parseContextWindowFromError("context length is only 163804 tokens")
      3. Expected: 163804
    Evidence: .sisyphus/evidence/task-04-parse-test.txt
  ```

  **Commit**: YES (group with Tasks 2-4)

- [ ] 5. **创建 reset-context-window API**

  **What to do**:
  - 创建 `src/app/api/models/[id]/reset-context-window/route.ts`
  - POST 方法，将 contextWindow 重置为 0
  
  **实现代码**:
  ```typescript
  import { NextResponse } from 'next/server';
  import { prisma } from '@/lib/prisma';
  import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
  import { logger, LOG_MODULES } from '@/lib/logger';

  // POST /api/models/[id]/reset-context-window
  export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const auth = authenticateRequest(request);
    if (!auth.success) return authErrorResponse(auth);
    const { payload } = auth;

    try {
      const { id } = await params;

      const existingModel = await prisma.modelConfig.findUnique({
        where: { id },
      });

      if (!existingModel) {
        return NextResponse.json({ error: '模型不存在' }, { status: 404 });
      }

      // Permission: owner or admin
      const userIsAdmin = isAdmin(payload);
      if (!userIsAdmin && existingModel.userId !== payload.userId) {
        return NextResponse.json({ error: '禁止访问' }, { status: 403 });
      }

      const model = await prisma.modelConfig.update({
        where: { id },
        data: { 
          contextWindow: 0,
          updatedAt: new Date(),
        },
      });

      logger.update(LOG_MODULES.MODEL, payload, id, { 
        name: model.name, 
        action: 'reset_context_window',
      });

      return NextResponse.json({
        model: {
          id: model.id,
          name: model.name,
          contextWindow: model.contextWindow,
          updatedAt: model.updatedAt,
        },
        message: 'contextWindow 已重置为 0',
      });
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.MODEL, '重置 contextWindow 失败', { 
        details: { error: String(error) } 
      });
      return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
    }
  }
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (but depends on Task 1 schema)
  - **Parallel Group**: Wave 1
  - **Blocked By**: Task 1 (schema must have contextWindow)

  **QA Scenarios**:
  ```
  Scenario: API endpoint exists
    Tool: Bash
    Steps:
      1. Test-Path src/app/api/models/*/reset-context-window/route.ts
    Expected Result: True
    Evidence: .sisyphus/evidence/task-05-api-exists.txt
  ```

  **Commit**: YES (单独)
  - Message: `feat(api): add reset-context-window endpoint`

- [ ] 6. **修改 models API routes**

  **What to do**:
  - 修改 `src/app/api/models/route.ts`
  - 修改 `src/app/api/models/[id]/route.ts`
  - 在 formatModel 中添加 contextWindow
  - POST/PUT 支持 contextWindow 参数
  
  **实现修改**:
  
  `src/app/api/models/route.ts`:
  ```typescript
  // formatModel 函数添加 contextWindow (line 23)
  contextWindow: model.contextWindow ?? 0,
  
  // POST handler body 解构添加 contextWindow (line 121)
  const { ..., contextWindow } = body;
  
  // Prisma create 添加 contextWindow
  contextWindow: contextWindow ?? 0,
  ```
  
  `src/app/api/models/[id]/route.ts`:
  ```typescript
  // formatModel 函数添加 contextWindow
  contextWindow: model.contextWindow ?? 0,
  
  // PUT handler 添加 contextWindow 处理
  const { ..., contextWindow } = body;
  if (contextWindow !== undefined) updateData.contextWindow = contextWindow;
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Blocked By**: Task 1 (schema)

  **QA Scenarios**:
  ```
  Scenario: GET returns contextWindow
    Tool: Bash (curl)
    Steps:
      1. curl GET /api/models/[id] with auth token
      2. Check response has contextWindow field
    Evidence: .sisyphus/evidence/task-06-api-response.txt
  ```

  **Commit**: YES
  - Message: `feat(api): add contextWindow support to models routes`

- [ ] 7. **前端 contextWindow 显示**

  **What to do**:
  - 修改 `src/app/dashboard/models/page.tsx`
  - 添加 contextWindow 到 interface
  - 显示只读值 + 复位按钮（值>0时）
  
  **实现代码**:
  
  Interface 添加:
  ```typescript
  interface ModelConfig {
    // ... existing fields
    contextWindow: number;
  }
  ```
  
  State 添加:
  ```typescript
  const [resettingContextWindow, setResettingContextWindow] = useState<string | null>(null);
  ```
  
  Handler 添加:
  ```typescript
  const handleResetContextWindow = async (modelId: string) => {
    try {
      setResettingContextWindow(modelId);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/models/${modelId}/reset-context-window`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('复位失败');
      
      // Update local state
      setModels(models.map(m => 
        m.id === modelId ? { ...m, contextWindow: 0 } : m
      ));
      if (editingModel?.id === modelId) {
        setEditingModel({ ...editingModel, contextWindow: 0 });
      }
      setSuccess('Context Window 已复位');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResettingContextWindow(null);
    }
  };
  ```
  
  UI 显示（在编辑 Modal 的高级参数部分后添加）:
  ```tsx
  {/* Context Window - 只读显示 */}
  <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
    <label className="block text-sm font-medium text-gray-700 mb-2">
      Context Window
    </label>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold text-gray-900">
          {editingModel?.contextWindow ?? 0}
        </span>
        <span className="text-sm text-gray-500">tokens</span>
      </div>
      
      {editingModel?.contextWindow > 0 && (
        <button
          onClick={() => handleResetContextWindow(editingModel.id)}
          disabled={resettingContextWindow === editingModel.id}
          className="px-3 py-1.5 text-sm text-orange-600 bg-orange-50 
                     border border-orange-200 rounded-md hover:bg-orange-100
                     disabled:opacity-50"
        >
          {resettingContextWindow === editingModel.id ? '复位中...' : '复位'}
        </button>
      )}
    </div>
    <p className="text-xs text-gray-500 mt-2">
      {editingModel?.contextWindow > 0 
        ? '已学习到的值，点击复位重新学习'
        : '未设置，下次调用超限时自动学习'}
    </p>
  </div>
  ```

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Blocked By**: Task 5, Task 6 (API ready)

  **QA Scenarios**:
  ```
  Scenario: UI displays contextWindow
    Tool: Playwright
    Steps:
      1. Navigate to /dashboard/models
      2. Open edit modal for a model
      3. Check contextWindow section visible
      4. If contextWindow > 0, check reset button visible
    Evidence: .sisyphus/evidence/task-07-ui-display.png
  ```

  **Commit**: YES
  - Message: `feat(ui): add contextWindow display and reset button`

---

## Wave 2 TODOs (依赖 Wave 1)

- [ ] 8. **运行数据库迁移**

  **What to do**:
  - 运行 `npm run db:push` 应用 schema 变更
  - 运行 `npm run db:generate` 生成 Prisma client
  
  **QA Scenarios**:
  ```
  Scenario: Database migration successful
    Tool: Bash
    Steps:
      1. npm run db:push
      2. npm run db:generate
      3. Check no errors
    Evidence: .sisyphus/evidence/task-08-db-migrate.txt
  ```

  **Blocked By**: Task 1

- [ ] 9. **SDK Compaction 配置**

  **What to do**:
  - 修改 `src/services/ai/claude-agent.ts`
  - 在 Options 中添加 settings.autoCompactWindow
  
  **实现代码**:
  ```typescript
  // 在 options 对象中添加 (约 line 162-201)
  const options: Options = {
    // ... existing options ...
    
    settings: {
      autoCompactWindow: this.config.contextWindow > 0 
        ? this.config.contextWindow 
        : 1000000,  // 默认 1M
    },
    
    // ... hooks ...
  };
  ```

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Blocked By**: Task 8 (Prisma client ready)

  **QA Scenarios**:
  ```
  Scenario: SDK options configured
    Tool: Bash
    Steps:
      1. grep "autoCompactWindow" src/services/ai/claude-agent.ts
    Expected Result: Line found
  ```

- [ ] 10. **添加 PreCompact Hook**

  **What to do**:
  - 在 Options hooks 中添加 PreCompact Hook
  - 注入自定义摘要指令
  
  **实现代码**:
  ```typescript
  hooks: {
    PreCompact: [{
      hooks: [async (input) => {
        return {
          custom_instructions: '保留以下内容：关键决策和原因、代码片段和文件路径、错误及其修复方法、当前任务状态和进度'
        };
      }]
    }],
    // ... PostCompact ...
  }
  ```

  **Blocked By**: Task 9

- [ ] 11. **添加 PostCompact Hook**

  **What to do**:
  - 添加 PostCompact Hook 记录日志
  
  **实现代码**:
  ```typescript
  hooks: {
    // ... PreCompact ...
    PostCompact: [{
      hooks: [async (input) => {
        console.log('[SDK Compact] 压缩完成:', {
          trigger: input.trigger,
          summaryLength: input.compact_summary?.length,
        });
        return {};
      }]
    }],
  }
  ```

  **Blocked By**: Task 9

- [ ] 12. **FSM 传递 contextWindow**

  **What to do**:
  - 修改 `src/lib/fsm/fsm-workflow-execution-service.ts`
  - 从 modelConfig 读取 contextWindow 传递给 ClaudeAgent
  
  **Blocked By**: Task 8

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  验证所有 Must Have 实现，Must NOT Have 不存在

- [ ] F2. **Code Quality Review** — `unspecified-high`
  tsc --noEmit + lint + 测试

- [ ] F3. **Manual QA** — `unspecified-high`
  完整流程测试：超限报错 → 学习 → 重试

- [ ] F4. **Scope Fidelity Check** — `deep`
  验证实现与计划一致

---

## Commit Strategy

| Commit | Tasks | Message |
|--------|-------|---------|
| 1 | 1 | `feat(schema): add contextWindow field to ModelConfig` |
| 2 | 2-4 | `feat(lib): add token counting and safe maxTokens utilities` |
| 3 | 5 | `feat(api): add reset-context-window endpoint` |
| 4 | 6 | `feat(api): add contextWindow support to models routes` |
| 5 | 7 | `feat(ui): add contextWindow display and reset button` |
| 6 | 8 | `chore(db): run migration for contextWindow` |
| 7 | 9-11 | `feat(sdk): configure Claude SDK compaction with hooks` |
| 8 | 12 | `feat(fsm): pass contextWindow to ClaudeAgent` |

---

## Success Criteria

### 验证命令
```bash
# 1. Schema 检查
grep "contextWindow" prisma/schema.prisma

# 2. 文件检查
Test-Path src/lib/token-counter.ts
Test-Path src/lib/safe-max-tokens.ts
Test-Path src/lib/error-parser.ts
Test-Path src/app/api/models/*/reset-context-window/route.ts

# 3. API 检查
curl GET /api/models/[id] | jq .contextWindow

# 4. SDK 配置检查
grep "autoCompactWindow" src/services/ai/claude-agent.ts
```

### Final Checklist
- [ ] Schema 有 contextWindow 字段
- [ ] 三个 lib 文件创建完成
- [ ] Reset API 端点可用
- [ ] Models API 支持 contextWindow
- [ ] 前端显示 + 复位按钮
- [ ] SDK Compaction 配置完成
- [ ] FSM 传递 contextWindow