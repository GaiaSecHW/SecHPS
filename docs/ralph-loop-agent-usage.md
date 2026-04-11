# Ralph Loop Agent 使用指南

## 快速开始

### 1. 通过 API 启动（最简方式）

```bash
curl -X POST /api/evaluations/{id}/ralph-start \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "maxIterations": 15,
    "maxTokens": 100000,
    "maxCost": 5.00,
    "verifyCompletionConfig": {
      "type": "keyword",
      "keywords": ["任务完成", "评估完成", "扫描完成"]
    }
  }'
```

成功响应：

```json
{
  "success": true,
  "message": "Ralph Loop Agent 已启动",
  "evaluationId": "eval-xxx",
  "config": {
    "maxIterations": 15,
    "maxTokens": 100000,
    "maxCost": 5.00,
    "hasVerifyCompletion": true,
    "model": "claude-sonnet-4-20250514"
  }
}
```

### 2. 查询迭代进度

```bash
curl /api/evaluations/{id}/iterations \
  -H "Authorization: Bearer <token>"
```

响应包含：

```json
{
  "iterations": [
    {
      "id": "iter-001",
      "iterationNumber": 1,
      "status": "completed",
      "duration": 45000,
      "inputTokens": 1200,
      "outputTokens": 800,
      "toolCallCount": 5,
      "verificationComplete": false,
      "verificationReason": "未检测到完成关键词，请继续执行"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 3, "totalPages": 1 },
  "summary": {
    "total": 3,
    "completed": 3,
    "failed": 0,
    "totalInputTokens": 3600,
    "totalOutputTokens": 2400,
    "totalDuration": 135000,
    "verifiedCount": 1
  },
  "evaluationStatus": "completed"
}
```

---

## 常见使用场景

### 场景 1：漏洞扫描

```typescript
import { runVulnerabilityScan } from '@/examples/ralph-vulnerability-scan';

const result = await runVulnerabilityScan({
  evaluationId: 'eval-123',
  projectId: 'proj-456',
  projectName: 'my-web-app',
  projectPath: '/path/to/project',
  taskDescription: '对该 Java Spring Boot 应用进行全面的安全漏洞扫描...',
  modelConfig: {
    providerType: 'claude',
    apiKey: 'sk-...',
    apiBaseUrl: 'https://api.anthropic.com',
    models: '["claude-sonnet-4-20250514"]',
  },
});

console.log(result.success ? '扫描完成' : '扫描未完成');
console.log(`共迭代 ${result.iterations} 次，使用 ${result.totalTokens} tokens`);
```

### 场景 2：代码重构

```typescript
import { runCodeRefactor } from '@/examples/ralph-code-refactor';

const result = await runCodeRefactor({
  evaluationId: 'eval-789',
  projectId: 'proj-101',
  projectName: 'legacy-service',
  projectPath: '/path/to/service',
  taskDescription: '将所有 callback 回调函数重构为 async/await 风格',
  targetFiles: ['src/api/users.js', 'src/api/orders.js'],
  modelConfig: { ... },
  maxIterations: 12,
});
```

### 场景 3：测试运行

```typescript
import { runTestSuite, formatTestReport } from '@/examples/ralph-test-runner';

const report = await runTestSuite({
  evaluationId: 'eval-test-001',
  projectId: 'proj-202',
  projectName: 'api-service',
  projectPath: '/path/to/service',
  testCommand: 'npm test',
  taskDescription: '运行所有单元测试，修复失败的测试用例，直到所有测试通过',
  modelConfig: { ... },
  onProgress: (msg) => console.log('[进度]', msg),
});

console.log(formatTestReport(report));
```

### 场景 4：自定义验证函数

```typescript
import { createRalphLoopAgent } from '@/services/evaluation';
import type { VerifyCompletionFunction } from '@/services/evaluation';

// 自定义验证：检查报告文件是否存在
const verifyReportExists: VerifyCompletionFunction = async ({ result, iteration }) => {
  const fs = await import('fs/promises');
  try {
    await fs.access('/output/report.json');
    return { complete: true, reason: '报告文件已生成' };
  } catch {
    return {
      complete: false,
      reason: `第 ${iteration} 次迭代：报告文件尚未生成，请继续执行`,
    };
  }
};

const agent = createRalphLoopAgent(modelConfig, workingDir, {
  maxIterations: 10,
  verifyCompletion: verifyReportExists,
});
```

---

## 前端集成

### 使用迭代进度组件

```tsx
'use client';
import { useRalphEvents } from '@/hooks/use-ralph-events';
import { IterationProgress } from '@/components/evaluation/iteration-progress';

export function EvaluationDetailPage({ evaluationId }: { evaluationId: string }) {
  const token = localStorage.getItem('token') ?? '';

  const { iterations, summary, evaluationStatus, isLoading, error, refresh } = useRalphEvents({
    evaluationId,
    token,
    enabled: true,
    pollInterval: 3000,   // 每 3 秒轮询一次
  });

  return (
    <IterationProgress
      iterations={iterations}
      summary={summary}
      evaluationStatus={evaluationStatus}
      isLoading={isLoading}
      error={error}
      onRefresh={refresh}
    />
  );
}
```

---

## 故障排除

### 问题 1：Ralph Loop Agent 不停止

**原因**：验证函数未能正确检测完成状态。

**解决**：
- 检查完成关键词是否与 AI 实际输出匹配
- 降低 `maxIterations` 值（如从 15 改为 5）测试
- 查看 `verificationReason` 字段了解每次验证的原因

```bash
# 查看迭代记录中的验证反馈
curl /api/evaluations/{id}/iterations | jq '.iterations[].verificationReason'
```

### 问题 2：Token 超出限制

**症状**：`completionReason` 为 `"max-iterations"` 且 token 用量异常高。

**解决**：
- 调整 `maxTokens`（默认 100,000）
- 精简任务描述，减少每次迭代的 token 消耗
- 使用更小的模型（如 `gpt-4o-mini`）

### 问题 3：前端迭代进度不更新

**症状**：页面显示"暂无迭代记录"。

**解决**：
1. 检查 `evaluationId` 是否正确
2. 确认 `EvaluationIteration` 表已创建（运行 `npm run db:push`）
3. 检查 token 是否有效

### 问题 4：数据库表不存在

**解决**：

```bash
npm run db:push   # 同步 schema 到数据库
```

---

## 配置参数速查

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxIterations` | number | 10 | 最大迭代次数 |
| `maxTokens` | number | 100,000 | 最大 Token 用量 |
| `maxCost` | number | 5.0 | 最大成本（美元） |
| `verifyCompletionConfig.type` | string | - | 验证类型：`keyword` / `tool-call` |
| `verifyCompletionConfig.keywords` | string[] | - | 关键词列表（type=keyword 时使用） |
| `verifyCompletionConfig.toolName` | string | - | 工具名称（type=tool-call 时使用） |
