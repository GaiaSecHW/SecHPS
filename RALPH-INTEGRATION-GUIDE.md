# Ralph Loop Agent 集成指南

## 概述

Ralph Loop Agent 已深度集成到项目中，提供可靠的任务完成验证机制，解决评估任务结束时间不稳定的问题。

## 核心文件

### 1. Ralph Loop Agent 核心实现

```
src/services/evaluation/
├── ralph-loop-agent.ts              # 核心停止条件和 token 管理
├── ralph-loop-agent-evaluator.ts    # 验证器接口定义
├── ralph-loop-agent-wrapper.ts      # Ralph Loop Agent 包装器（主实现）
└── index.ts                         # 统一导出
```

### 2. API 端点

```
src/app/api/evaluations/[id]/
├── ralph-start/route.ts            # Ralph Loop Agent 启动端点（POST）
└── iterations/route.ts             # 迭代历史查询端点（GET，支持分页和过滤）
```

### 3. 前端组件 & Hook

```
src/hooks/
└── use-ralph-events.ts             # 迭代进度轮询 Hook（每 3s 轮询 iterations API）

src/components/evaluation/
└── iteration-progress.tsx          # 迭代进度展示组件（含汇总卡片、迭代列表、展开详情）
```

### 4. 完整使用示例

```
src/examples/
├── ralph-vulnerability-scan.ts     # 漏洞扫描场景示例
├── ralph-code-refactor.ts          # 代码重构场景示例
└── ralph-test-runner.ts            # 测试运行场景示例
```

### 5. 参考文档

```
docs/
├── ralph-loop-agent-usage.md           # 快速开始 & 常见场景使用指南
└── ralph-loop-agent-best-practices.md  # 最佳实践 & 陷阱规避
```

## 使用方法

### 方法 1：通过 API 启动（推荐）

#### 请求示例

```bash
curl -X POST http://localhost:3000/api/evaluations/{evaluation-id}/ralph-start \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "maxIterations": 15,
    "maxTokens": 100000,
    "maxCost": 5.00,
    "verifyCompletion": {
      "type": "tool-call",
      "toolName": "markComplete"
    }
  }'
```

#### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|--------|---------|------|
| `maxIterations` | number | 否 | 10 | 最大迭代次数 |
| `maxTokens` | number | 否 | 100000 | 最大 token 数量 |
| `maxCost` | number | 否 | 5.00 | 最大成本（美元） |
| `verifyCompletion` | object | 否 | - | 完成验证配置 |

#### 验证配置类型

##### 1. 工具调用验证

```json
{
  "type": "tool-call",
  "toolName": "markComplete"
}
```

**说明**：当检测到指定工具被调用时，认为任务完成。

**适用场景**：
- 漏洞扫描任务：检测到 `markComplete` 工具调用
- 代码生成任务：检测到 `generateReport` 工具调用
- 测试执行任务：检测到 `runTests` 工具调用

##### 2. 关键词验证

```json
{
  "type": "keyword",
  "keywords": ["完成", "DONE", "finished", "报告已生成"]
}
```

**说明**：当 AI 响应中包含任一关键词时，认为任务完成。

**适用场景**：
- 简单任务：AI 在输出中明确说明完成
- 快速验证：不需要复杂逻辑，只需关键词匹配

##### 3. 自定义验证（预留）

```json
{
  "type": "custom",
  "logic": "..."
}
```

**说明**：自定义验证逻辑（需要扩展实现）。

**适用场景**：
- 复杂验证逻辑：需要运行实际测试、检查文件状态等
- 多条件验证：需要组合多个验证条件

---

### 方法 2：直接在代码中使用

#### 示例 1：漏洞扫描任务

```typescript
import { createRalphLoopAgent, type RalphLoopAgentConfig } from '@/services/evaluation';
import { prisma } from '@/lib/prisma';

// 创建 Ralph Loop Agent
const agent = createRalphLoopAgent(
  {
    providerType: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    apiBaseUrl: process.env.ANTHROPIC_API_URL || '',
    models: 'claude-sonnet-4',
  },
  workingDirectory,
  {
    maxIterations: 15,
    maxTokens: 100000,
    maxCost: 5.00,
    verifyCompletion: async ({ result, iteration }) => {
      // 检查 1：是否调用了漏洞扫描工具
      const forVulnerabilityScan = result.text.includes('vulnerability') ||
                                    result.text.includes('漏洞') ||
                                    result.text.includes('scan');

      // 检查 2：是否生成了报告
      const hasReport = result.text.includes('report') ||
                      result.text.includes('报告') ||
                      result.text.includes('总结');

      // 检查 3：是否有明确的完成标记
      const hasCompleteMarker = result.text.includes('任务完成') ||
                                result.text.includes('已完成') ||
                                result.text.includes('DONE');

      if (forVulnerabilityScan && hasReport) {
        return {
          complete: true,
          reason: '发现漏洞并生成了报告',
        };
      }

      if (iteration >= 3 && !forVulnerabilityScan) {
        return {
          complete: false,
          reason: '已经尝试 3 次，但没有发现漏洞。请确保执行了漏洞扫描。',
        };
      }

      return {
        complete: false,
        reason: '请继续执行漏洞扫描并生成报告',
      };
    },
    onIterationStart: (iteration) => {
      console.log(`[Ralph] 开始第 ${iteration} 次迭代`);

      // 可以通过 SSE 发送迭代开始事件
      // sendSSE({ type: 'iteration_start', data: { iteration } });
    },
    onIterationEnd: async (iteration, duration, result) => {
      console.log(`[Ralph] 第 ${iteration} 次迭代完成，耗时 ${duration}ms`);

      // 可以通过 SSE 发送迭代结束事件
      // sendSSE({ type: 'iteration_end', data: { iteration, duration } });

      // 保存迭代记录到数据库
      await prisma.evaluationIteration.create({
        data: {
          evaluationSessionId: evaluationId,
          iterationNumber: iteration,
          status: 'completed',
          startedAt: new Date(Date.now() - duration),
          completedAt: new Date(),
          duration,
          responseText: result.text,
        },
      });
    },
    onRalphComplete: async (result) => {
      console.log('[Ralph] 任务完成:', result);

      // 更新数据库状态
      await prisma.evaluationSession.update({
        where: { id: evaluationId },
        data: {
          status: result.completionReason === 'verified' ? 'completed' : 'failed',
          completedAt: new Date(),
          summary: result.reason,
        },
      });

      // 发送完成事件
      // sendSSE({ type: 'complete', data: result });
    },
  }
);

// 启动 Ralph Loop Agent
const ralphResult = await agent.loop(
  evaluationId,
  projectId,
  {
    projectName: 'My Project',
    projectDescription: '执行漏洞扫描任务',
    taskDescription: '请扫描项目中的安全漏洞，并生成详细的报告',
  },
  {
    onChunk: (text) => {
      // 流式输出
      sendSSE({ type: 'chunk', data: text });
    },
    onToolCall: (name, parameters) => {
      console.log(`[Ralph] 工具调用: ${name}`, parameters);
    },
    onToolResult: (name, result) => {
      console.log(`[Ralph] 工具结果: ${name}`, result);
    },
    onError: (error) => {
      console.error('[Ralph] 错误:', error);
      sendSSE({ type: 'error', data: error.message });
    },
  }
);

console.log(`[Ralph] 任务完成，共 ${ralphResult.iterations} 次迭代`);
console.log(`[Ralph] 完成原因: ${ralphResult.completionReason}`);
console.log(`[Ralph] Token 使用:`, ralphResult.totalUsage);
```

#### 示例 2：代码重构任务

```typescript
const agent = createRalphLoopAgent(
  modelConfig,
  workingDirectory,
  {
    maxIterations: 20,
    verifyCompletion: async ({ result, iteration }) => {
      // 检查 1：是否修改了文件
      const hasFileModification = result.text.includes('已修改') ||
                                    result.text.includes('修改了') ||
                                    result.text.includes('updated');

      // 检查 2：是否运行了测试
      const hasTestRun = result.text.includes('测试') ||
                        result.text.includes('test') ||
                        result.text.includes('passed');

      // 检查 3：是否有错误
      const hasError = result.text.includes('错误') ||
                      result.text.includes('error') ||
                      result.text.includes('failed');

      if (hasFileModification && hasTestRun && !hasError) {
        return {
          complete: true,
          reason: '文件修改完成且测试通过',
        };
      }

      if (hasError) {
        return {
          complete: false,
          reason: '检测到错误，请修复后再试',
        };
      }

      if (iteration >= 5 && !hasFileModification) {
        return {
          complete: false,
          reason: '已经尝试 5 次，但没有修改文件。请确保执行了重构操作。',
        };
      }

      return {
        complete: false,
        reason: '请继续重构代码并运行测试',
      };
    },
  }
);
```

#### 示例 3：组合验证条件

```typescript
const agent = createRalphLoopAgent(
  modelConfig,
  workingDirectory,
  {
    maxIterations: 15,
    maxTokens: 150000,
    maxCost: 10.00,
    verifyCompletion: async ({ result, iteration, allResults }) => {
      // 检查 1：工具调用
      const toolCalls = allResults.flatMap(r =>
        r.steps.flatMap(s => s.toolResults.map(tr => tr.toolName))
      );

      const hasVulnerabilityScan = toolCalls.includes('scanVulnerabilities');
      const hasReportGeneration = toolCalls.includes('generateReport');

      // 检查 2：输出内容
      const text = result.text.toLowerCase();
      const hasCompletionKeywords = ['完成', 'done', 'finished', 'complete']
        .some(keyword => text.includes(keyword));

      const hasErrorIndicators = ['错误', 'error', 'failed', '异常']
        .some(keyword => text.includes(keyword));

      // 检查 3：迭代次数
      const isLateIteration = iteration >= 10;

      // 综合判断
      if (hasVulnerabilityScan && hasReportGeneration && hasCompletionKeywords) {
        return {
          complete: true,
          reason: '执行了漏洞扫描、生成了报告，并且 AI 明确表示完成',
        };
      }

      if (hasErrorIndicators) {
        return {
          complete: false,
          reason: '检测到错误指示器，请修复问题',
        };
      }

      if (isLateIteration) {
        return {
          complete: false,
          reason: `已经尝试 ${iteration} 次，请确保任务正在正确执行`,
        };
      }

      return {
        complete: false,
        reason: '请继续执行任务，确保完成漏洞扫描和报告生成',
      };
    },
  }
);
```

---

## 数据库集成

### 添加迭代记录表（可选）

如果需要持久化迭代状态，可以在 `schema.prisma` 中添加：

```prisma
model EvaluationIteration {
  id               String   @id @default(cuid())
  evaluationSessionId String

  // 迭代信息
  iterationNumber Int      @default(1)
  status           String   @default("running") // running, completed, failed

  // 执行信息
  startedAt        DateTime  @default(now())
  completedAt      DateTime?
  duration         Int?     // 毫秒

  // 结果信息
  responseText     String?  // AI 响应文本
  verificationResult String?  // verified | failed
  verificationReason String?  // 验证反馈

  // Token 使用
  inputTokens     Int?
  outputTokens    Int?

  // 工具调用统计
  toolCallCount   Int      @default(0)

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  evaluationSession EvaluationSession @relation(fields: [evaluationSessionId], references: [id], onDelete: Cascade)

  @@index([evaluationSessionId])
  @@index([evaluationSessionId, iterationNumber])
  @@index([status])
}
```

---

## 前端集成

### 显示迭代进度

```typescript
'use client';

import { useState, useEffect } from 'react';

export default function EvaluationProgress({ evaluationId }: { evaluationId: string }) {
  const [iterations, setIterations] = useState<any[]>([]);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [status, setStatus] = useState('running');

  // 使用 SSE 监听事件
  useEffect(() => {
    const eventSource = new EventSource(`/api/evaluations/${evaluationId}/stream`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'iteration_start') {
        setCurrentIteration(data.data.iteration);
        setIterations(prev => [...prev, {
          iteration: data.data.iteration,
          status: 'running',
          startedAt: new Date(),
        }]);
      } else if (data.type === 'iteration_end') {
        setIterations(prev => prev.map((it, i) =>
          i === prev.length - 1
            ? { ...it, status: 'completed', duration: data.data.duration }
            : it
        ));
      } else if (data.type === 'complete') {
        setStatus('completed');
      } else if (data.type === 'error') {
        setStatus('failed');
      }
    };

    return () => {
      eventSource.close();
    };
  }, [evaluationId]);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">迭代进度</h2>

      {/* 当前迭代 */}
      <div className="mb-4">
        <div className="text-sm text-gray-600 mb-2">
          当前迭代: <span className="font-medium">{currentIteration}</span> / {iterations.length}
        </div>

        {/* 迭代列表 */}
        <div className="space-y-2 mt-4">
          {iterations.map((it, index) => (
            <div
              key={index}
              className="border rounded-lg p-4 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900">
                  迭代 {it.iteration}
                </span>
                <span
                  className={`text-sm px-3 py-1 rounded-full ${
                    it.status === 'completed'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}
                >
                  {it.status === 'completed' ? '完成' : '运行中'}
                </span>
              </div>

              {it.duration && (
                <div className="text-sm text-gray-600">
                  耗时: {it.duration}ms
                </div>
              )}

              {it.status === 'completed' && (
                <div className="text-sm text-green-600 font-medium">
                  ✓ 完成
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 整体状态 */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-3">整体状态</h3>
        <div
          className={`text-lg font-medium ${
            status === 'completed'
              ? 'text-green-600'
              : status === 'failed'
              ? 'text-red-600'
              : 'text-blue-600'
          }`}
        >
          {status === 'completed' && '✓ 任务完成'}
          {status === 'failed' && '✗ 任务失败'}
          {status === 'running' && '⏳ 任务进行中'}
        </div>
      </div>
    </div>
  );
}
```

---

## 验证函数最佳实践

### 1. 检查工具调用

```typescript
verifyCompletion: async ({ result }) => {
  // 检查特定工具是否被调用
  for (const step of result.steps) {
    for (const toolResult of step.toolResults) {
      if (toolResult.toolName === 'markComplete') {
        return { complete: true, reason: '检测到完成标记' };
      }
    }
  }

  return { complete: false, reason: '未检测到完成标记' };
}
```

### 2. 检查输出内容

```typescript
verifyCompletion: async ({ result }) => {
  const text = result.text.toLowerCase();

  // 检查完成关键词
  const completionKeywords = ['完成', 'done', 'finished', 'complete'];
  const hasCompletionKeyword = completionKeywords.some(keyword =>
    text.includes(keyword)
  );

  // 检查错误关键词
  const errorKeywords = ['错误', 'error', 'failed', '异常'];
  const hasErrorKeyword = errorKeywords.some(keyword =>
    text.includes(keyword)
  );

  if (hasCompletionKeyword && !hasErrorKeyword) {
    return { complete: true, reason: '检测到完成关键词' };
  }

  return { complete: false, reason: '请继续执行任务' };
}
```

### 3. 组合多个条件

```typescript
verifyCompletion: async ({ result, iteration, allResults }) => {
  // 条件 1：工具调用
  const hasRequiredToolCall = checkToolCall(result, 'requiredTool');

  // 条件 2：输出内容
  const hasCompletionKeyword = result.text.includes('完成');

  // 条件 3：迭代次数限制
  const isLateIteration = iteration >= 10;

  // 综合判断
  if (hasRequiredToolCall && hasCompletionKeyword) {
    return { complete: true, reason: '所有条件满足' };
  }

  if (isLateIteration) {
    return { complete: false, reason: '已达到最大迭代次数' };
  }

  return { complete: false, reason: '请继续执行任务' };
}
```

### 4. 使用迭代反馈

```typescript
verifyCompletion: async ({ result, iteration }) => {
  // 第一次迭代不检查
  if (iteration === 1) {
    return { complete: false, reason: '开始执行任务' };
  }

  // 检查是否有错误
  const hasError = result.text.includes('错误') ||
                    result.text.includes('error');

  // 检查是否有成功指示
  const hasSuccess = result.text.includes('成功') ||
                     result.text.includes('success');

  if (hasError) {
    return {
      complete: false,
      reason: '检测到错误，请修复后再试。错误信息：' + extractError(result.text),
    };
  }

  if (hasSuccess) {
    return {
      complete: true,
      reason: '任务成功完成',
    };
  }

  // 根据迭代次数提供不同的反馈
  if (iteration < 5) {
    return {
      complete: false,
      reason: '请继续执行任务，确保完成所有步骤',
    };
  } else {
    return {
      complete: false,
      reason: `已经尝试 ${iteration} 次，请确保任务正在正确执行。如果遇到困难，请详细说明遇到的问题。`,
    };
  }
}
```

---

## 停止条件配置

### 1. 仅迭代次数限制

```typescript
{
  maxIterations: 10
}
```

### 2. 迭代次数 + Token 限制

```typescript
{
  maxIterations: 15,
  maxTokens: 100000
}
```

### 3. 迭代次数 + Token + 成本限制

```typescript
{
  maxIterations: 20,
  maxTokens: 150000,
  maxCost: 5.00
}
```

---

## 调试和日志

### 启用调试日志

Ralph Loop Agent 会在控制台输出详细的调试信息：

```
[Ralph] 开始第 1 次迭代
[Ralph] 工具调用: readFile
[Ralph] 工具结果: readFile { success: true, ... }
[Ralph] 收到文本块: 这是项目的 README 文件...
[Ralph] 第 1 次迭代完成，耗时 1234ms
[Ralph] 迭代 1 反馈: 未检测到完成标记
[Ralph] 开始第 2 次迭代
...
[Ralph] 任务完成: { text: '...', iterations: 2, completionReason: 'verified', ... }
```

### 日志级别

- `[Ralph]` - Ralph Loop Agent 相关日志
- `[Evaluation]` - 原有评估系统日志
- `[EnhancedEvaluationCaller]` - 增强评估调用器日志

---

## 错误处理

### 1. 迭代错误

如果某次迭代失败，Ralph Loop Agent 会：

1. 记录错误到控制台
2. 调用 `onError` 回调
3. 继续下一次迭代（如果未达到最大迭代次数）
4. 如果达到最大迭代次数，标记为 `max-iterations` 完成

### 2. 验证错误

如果验证函数抛出错误：

1. 记录错误到控制台
2. 标记任务为失败状态
3. 返回错误原因

### 3. 网络错误

如果 AI SDK 调用失败：

1. 记录错误到控制台
2. 调用 `onError` 回调
3. 更新数据库状态为失败

---

## 性能优化

### 1. Token 使用优化

- **限制上下文大小**：使用 `maxTokens` 参数控制每次迭代的 token 使用
- **避免重复内容**：Ralph Loop Agent 会自动管理上下文，避免重复发送相同内容
- **使用关键词验证**：简单的关键词匹配比复杂的验证逻辑更节省 token

### 2. 迭代次数优化

- **设置合理的最大迭代次数**：根据任务复杂度设置 10-20 次
- **使用渐进式反馈**：随着迭代次数增加，提供更详细的反馈

### 3. 成本控制

- **设置成本上限**：使用 `maxCost` 参数控制总成本
- **监控成本**：在回调中记录每次迭代的成本

---

## 常见问题

### Q1: 如何停止正在运行的 Ralph Loop Agent？

A: 调用现有的 `/api/evaluations/[id]/stop` 端点。

### Q2: 如何查看迭代历史？

A: 如果添加了 `EvaluationIteration` 表，可以查询：
```typescript
const iterations = await prisma.evaluationIteration.findMany({
  where: { evaluationSessionId },
  orderBy: { iterationNumber: 'asc' },
});
```

### Q3: 如何自定义验证逻辑？

A: 目前支持三种验证类型：
1. `tool-call` - 检查工具调用
2. `keyword` - 检查关键词
3. `custom` - 自定义逻辑（需要扩展实现）

### Q4: 如何处理长时间运行的任务？

A:
1. 设置合理的 `maxIterations`（如 20-30）
2. 设置 `maxTokens`（如 150000-200000）
3. 设置 `maxCost`（如 $10-$20）
4. 在 `verifyCompletion` 中添加迭代次数检查，提供更详细的反馈

---

## 总结

Ralph Loop Agent 提供了：

✅ **可靠的完成验证**：通过 `verifyCompletion` 自定义完成条件
✅ **自动重试机制**：验证失败时自动反馈并继续
✅ **安全保护**：迭代次数、Token、成本限制
✅ **灵活的验证方式**：支持工具调用、关键词、自定义验证
✅ **深度集成**：直接集成到现有评估系统
✅ **最小改动**：不破坏现有架构
✅ **渐进式集成**：可以先使用 API 端点，再逐步深入集成

通过使用 Ralph Loop Agent，你可以解决评估任务结束时间不稳定的问题，让任务执行更加可靠和可控！
