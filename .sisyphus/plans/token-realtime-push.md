# Token 实时推送修复计划

## 问题
DAG 模式执行中的节点 Token 统计无法获取，原因是 `execute/route.ts` 中 `onTokenUsage` 回调为空。

## 影响范围
- 执行中节点：Token 实时显示失败
- 结束后节点：Token 从 NodeExecution 表读取（正常）

## 解决方案

### 方案 A: SSE 实时推送 (推荐)
使用 Server-Sent Events 将 Token 数据实时推送到前端。

### 方案 B: 写入 TokenUsage 表
将实时 Token 写入数据库，前端轮询查询。

## 任务清单

### Wave 1: 分析现有 SSE 实现
- [ ] 1. 检查现有 SSE 端点 (evaluations/[id]/stream)
- [ ] 2. 检查前端 Token 显示组件

### Wave 2: 实现 Token SSE 推送
- [ ] 3. 修改 execute/route.ts 实现 onTokenUsage 回调
- [ ] 4. 修改 SSE stream 端点推送 Token 数据
- [ ] 5. 验证前端接收

## 相关文件
- src/app/api/evaluations/[id]/execute/route.ts (line 76: onTokenUsage: () => {})
- src/app/api/evaluations/[id]/stream/route.ts (SSE 端点)
- src/lib/workflow/unified-execution-engine.ts (onTokenUsage 调用)