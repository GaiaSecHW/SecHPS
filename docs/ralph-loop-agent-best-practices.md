# Ralph Loop Agent 最佳实践

## 验证函数设计原则

### 原则 1：验证函数必须是幂等的

验证函数可能被多次调用，不应有副作用（如写文件、发送通知等）。

```typescript
// ✅ 正确：纯检测逻辑
const verify: VerifyCompletionFunction = ({ result }) => {
  return { complete: result.text.includes('完成'), reason: '...' };
};

// ❌ 错误：验证函数有副作用
const verify: VerifyCompletionFunction = async ({ result }) => {
  await sendEmail('done@example.com'); // 每次验证都会发邮件！
  return { complete: true };
};
```

### 原则 2：提供有意义的反馈

当 `complete: false` 时，`reason` 字段会作为反馈注入到下一次迭代，
必须清晰、可操作。

```typescript
// ✅ 正确：清晰的反馈
return {
  complete: false,
  reason: `第 ${iteration} 次迭代未完成。请：
1. 检查 /output/report.json 是否生成
2. 若未生成，检查工具调用是否成功
3. 完成后输出"任务完成"`,
};

// ❌ 错误：模糊的反馈
return { complete: false, reason: '继续' };
```

### 原则 3：渐进式反馈策略

随着迭代次数增加，反馈应该更具体、更有针对性：

```typescript
const verify: VerifyCompletionFunction = ({ result, iteration, originalPrompt }) => {
  if (isComplete(result)) return { complete: true };

  // 早期：简单提示
  if (iteration <= 3) {
    return { complete: false, reason: `第 ${iteration} 次迭代，请继续完成任务。` };
  }

  // 中期：提供具体指导
  if (iteration <= 7) {
    return { complete: false, reason: `第 ${iteration} 次迭代。原始任务：${originalPrompt.slice(0, 200)}。请聚焦于核心目标。` };
  }

  // 后期：紧急提示
  return { complete: false, reason: `⚠️ 第 ${iteration} 次迭代，接近上限。请立即完成并输出完成信号。` };
};
```

### 原则 4：验证函数要快速

验证函数在每次迭代后运行，避免耗时操作：

```typescript
// ✅ 正确：快速文本检查
const verify: VerifyCompletionFunction = ({ result }) => ({
  complete: result.text.includes('DONE'),
});

// ⚠️ 谨慎：文件系统检查（有 I/O 开销）
const verify: VerifyCompletionFunction = async ({ result }) => {
  const exists = await fileExists('/output/report.json');
  return { complete: exists };
};

// ❌ 避免：网络请求（耗时且可能失败）
const verify: VerifyCompletionFunction = async () => {
  const res = await fetch('https://api.example.com/check'); // 危险！
  return { complete: res.ok };
};
```

---

## 停止条件配置

### 推荐配置组合

| 场景 | maxIterations | maxTokens | maxCost |
|------|--------------|-----------|---------|
| 快速任务（文档生成） | 5 | 50,000 | 2.0 |
| 标准任务（代码分析） | 10 | 100,000 | 5.0 |
| 复杂任务（漏洞扫描） | 20 | 200,000 | 10.0 |
| 长周期任务（全量重构） | 30 | 500,000 | 25.0 |

### 避免只设置单一停止条件

```typescript
// ❌ 只有迭代限制：可能超出预期成本
createRalphLoopAgent(config, dir, { maxIterations: 30 });

// ✅ 多重保护
createRalphLoopAgent(config, dir, {
  maxIterations: 15,
  maxTokens: 150_000,
  maxCost: 8.0,
});
```

---

## 性能优化建议

### 1. 减少不必要的 Token 消耗

每次迭代都会累计 Token 成本。以下技巧可以减少 Token 用量：

**精简任务描述**（影响最大）：

```typescript
// ❌ 冗余的任务描述
const task = `
请对以下项目进行详细、全面、深入的安全漏洞扫描工作。
您需要仔细检查每一个文件，不要遗漏任何可能存在的安全问题...
（500 字冗余描述）
`;

// ✅ 精简的任务描述
const task = `对项目进行安全漏洞扫描，输出 JSON 格式的漏洞报告，完成后说明"漏洞扫描完成"。`;
```

**合理设置 maxTokens**：

```typescript
// 根据任务复杂度设置，不要盲目设置为最大值
maxTokens: 80_000,  // 够用即可，过大会浪费
```

### 2. 利用 onIterationEnd 回调进行进度持久化

```typescript
onIterationEnd: async (iteration, duration, result) => {
  // 保存每次迭代的中间结果，避免失败后重新开始
  await saveCheckpoint(evaluationId, iteration, result.text);
},
```

### 3. 合理的轮询间隔

前端轮询间隔不要太短，避免服务器压力：

```typescript
// ✅ 合理间隔（任务运行中 3s，已完成停止轮询）
useRalphEvents({ evaluationId, token, pollInterval: 3000 });

// ❌ 过于频繁（给服务器造成不必要压力）
useRalphEvents({ evaluationId, token, pollInterval: 500 });
```

---

## 常见陷阱与解决方案

### 陷阱 1：验证关键词被截断

**问题**：AI 输出了"任务完成"但被分在两个 chunk 中（"任务" + "完成"），
单 chunk 检测失败。

**解决**：在 `onComplete` 中检测全文，而非在 `onChunk` 中：

```typescript
// ralph-loop-agent-wrapper.ts 中的验证是在完整响应上进行的 ✓
// 不要在 onChunk 回调中做验证判断
```

### 陷阱 2：并发启动多个 Ralph Loop Agent

**问题**：同一个 evaluationId 启动了两个 Ralph Loop Agent，两个 agent 同时写入数据库，造成迭代记录冲突。

**解决**：启动前检查状态：

```typescript
// ralph-start/route.ts 已有保护：
if (evaluation.status === 'running') {
  return NextResponse.json({ error: '评估会话已在运行中' }, { status: 400 });
}
```

### 陷阱 3：忘记处理 abort

**问题**：用户关闭页面后，后台 Ralph Loop Agent 仍在运行，消耗资源。

**解决**：在需要取消时调用 `agent.abort()`，并更新数据库状态：

```typescript
// 在 /api/evaluations/[id]/stop/route.ts 中添加对 ralph agent 的支持
agent.abort();
await prisma.evaluationSession.update({
  where: { id },
  data: { status: 'cancelled', completedAt: new Date() },
});
```

### 陷阱 4：verifyCompletion 抛出异常

**问题**：验证函数中的文件读取或网络请求抛出异常，导致整个 Ralph Loop 崩溃。

**解决**：验证函数内部捕获异常：

```typescript
const verify: VerifyCompletionFunction = async ({ result, iteration }) => {
  try {
    const fileExists = await checkFile('/output/report.json');
    return { complete: fileExists };
  } catch (err) {
    // 不要让验证异常传播，返回未完成
    console.error('[verify] 检查失败:', err);
    return { complete: false, reason: `第 ${iteration} 次：验证检查失败，请重试` };
  }
};
```

### 陷阱 5：迭代反馈信息过长

**问题**：验证函数返回的 `reason`（反馈）被追加到下一次迭代的提示中，
如果反馈很长（几千字），会迅速消耗 Token 配额。

**解决**：控制反馈长度：

```typescript
// ✅ 简洁反馈（< 200 字）
return { complete: false, reason: `第 ${iteration} 次未完成，请输出"任务完成"。` };

// ❌ 过长反馈（耗费大量 Token）
return { complete: false, reason: `${originalPrompt}（完整内容，几千字）...` };
```

---

## 测试策略

### 单元测试验证函数

```typescript
import { describe, it, expect } from 'vitest';
import { verifyScanCompletion } from '@/examples/ralph-vulnerability-scan';

describe('verifyScanCompletion', () => {
  it('检测到关键词时返回 complete=true', async () => {
    const mockResult = { text: '漏洞扫描完成，共发现 3 个漏洞', steps: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    const result = await verifyScanCompletion({
      result: mockResult as any,
      iteration: 1,
      allResults: [],
      originalPrompt: '扫描任务',
    });
    expect(result.complete).toBe(true);
  });

  it('未检测到关键词时返回 complete=false 并附带反馈', async () => {
    const mockResult = { text: '正在分析代码...', steps: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    const result = await verifyScanCompletion({
      result: mockResult as any,
      iteration: 1,
      allResults: [],
      originalPrompt: '扫描任务',
    });
    expect(result.complete).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
```

### 集成测试（模拟 Ralph Loop）

```typescript
import { RalphLoopAgent } from '@/services/evaluation';

describe('RalphLoopAgent', () => {
  it('在验证通过后停止循环', async () => {
    let callCount = 0;
    const agent = new RalphLoopAgent({
      providerType: 'claude',
      apiKey: 'test',
      model: 'claude-sonnet-4-20250514',
      maxIterations: 5,
      verifyCompletion: ({ iteration }) => {
        callCount++;
        // 第 2 次迭代通过验证
        return { complete: iteration >= 2, reason: '测试完成' };
      },
    });

    // 注意：实际集成测试需要 mock EnhancedEvaluationCaller
    // 这里仅展示测试结构
  });
});
```
