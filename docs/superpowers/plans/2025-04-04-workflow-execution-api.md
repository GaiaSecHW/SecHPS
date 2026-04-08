# 工作流执行 API 完善实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完善工作流执行 API，实现真实的工作流执行逻辑，连接 workflow-executor 与 API，支持异步执行、进度追踪和取消功能。

**Architecture:** 创建 WorkflowExecutionService 类，封装工作流执行逻辑，通过 SSE 实现实时进度更新，支持执行取消和错误处理。

**Tech Stack:** Next.js 16, TypeScript, Prisma ORM, Server-Sent Events

---

## 现状分析

当前实现：
- `src/lib/workflow-executor.ts` - 工作流执行引擎（已完善，支持各种动作）
- `src/app/api/workflows/[id]/execute/route.ts` - API 存在，但只创建记录，标记为 TODO
- `src/app/api/executions/[id]/cancel/route.ts` - API 存在，但只更新状态，标记为 TODO
- `src/app/api/executions/[id]/route.ts` - 执行详情 API（需检查）

需要实现：
1. 工作流执行服务（异步执行、进度追踪）
2. 执行 API 集成（启动执行、返回执行 ID）
3. 取消 API 完善（中断正在执行的工作流）
4. 进度查询 API（SSE 实时进度）

---

## 文件结构

```
src/lib/
├── workflow-executor.ts              # 已有：工作流执行引擎
├── workflow-execution-service.ts     # 新增：执行服务（管理执行生命周期）
└── workflow-actions/                 # 已有：动作执行器

src/app/api/
├── workflows/[id]/
│   └── execute/
│       └── route.ts                  # 修改：启动执行
├── executions/
│   ├── [id]/
│   │   ├── route.ts                  # 修改：执行详情（含进度）
│   │   ├── cancel/
│   │   │   └── route.ts              # 修改：取消执行
│   │   └── progress/
│   │       └── route.ts              # 新增：SSE 进度流
│   └── route.ts                      # 已有：执行列表
```

---

## Task 1: 创建工作流执行服务

**Files:**
- Create: `src/lib/workflow-execution-service.ts`

- [ ] **Step 1: 创建执行服务核心类**

```typescript
// src/lib/workflow-execution-service.ts

import { prisma } from '@/lib/prisma';
import { executeWorkflow, WorkflowExecutionOptions } from './workflow-executor';
import type { FlowNode, FlowEdge, ExecutionContext, StepResult } from '@/types/workflow';

/**
 * 执行状态
 */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * 执行进度
 */
export interface ExecutionProgress {
  executionId: string;
  workflowId: string;
  status: ExecutionStatus;
  currentNodeId: string | null;
  currentNodeName: string | null;
  totalNodes: number;
  completedNodes: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  steps: StepProgress[];
}

/**
 * 步骤进度
 */
export interface StepProgress {
  stepId: string;
  nodeId: string;
  nodeName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: Date | null;
  completedAt: Date | null;
  output: unknown;
  error: string | null;
}

/**
 * 执行选项
 */
export interface ExecutionServiceOptions extends WorkflowExecutionOptions {
  executionId: string;
  workflowId: string;
  userId: string;
}

/**
 * 活跃执行追踪
 */
const activeExecutions = new Map<string, {
  controller: AbortController;
  progress: ExecutionProgress;
}>();

/**
 * 工作流执行服务
 */
export class WorkflowExecutionService {
  private executionId: string;
  private workflowId: string;
  private userId: string;
  private controller: AbortController;
  private progress: ExecutionProgress;
  private nodeMap: Map<string, FlowNode>;

  constructor(options: ExecutionServiceOptions) {
    this.executionId = options.executionId;
    this.workflowId = options.workflowId;
    this.userId = options.userId;
    this.controller = new AbortController();
    this.nodeMap = new Map();
    this.progress = {
      executionId: this.executionId,
      workflowId: this.workflowId,
      status: 'pending',
      currentNodeId: null,
      currentNodeName: null,
      totalNodes: 0,
      completedNodes: 0,
      startedAt: null,
      completedAt: null,
      error: null,
      steps: [],
    };
  }

  /**
   * 执行工作流
   */
  async execute(nodes: FlowNode[], edges: FlowEdge[]): Promise<ExecutionProgress> {
    // 初始化节点映射
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
    }

    this.progress.totalNodes = nodes.length;
    this.progress.status = 'running';
    this.progress.startedAt = new Date();

    // 注册活跃执行
    activeExecutions.set(this.executionId, {
      controller: this.controller,
      progress: this.progress,
    });

    // 更新数据库状态
    await this.updateExecutionStatus('running');

    // 初始化步骤进度
    await this.initializeSteps(nodes);

    try {
      // 执行工作流
      const options: WorkflowExecutionOptions = {
        variables: {},
        onStepStart: (nodeId, nodeName) => {
          this.handleStepStart(nodeId, nodeName);
        },
        onStepComplete: (result) => {
          this.handleStepComplete(result);
        },
        onStepError: (nodeId, error) => {
          this.handleStepError(nodeId, error);
        },
      };

      // 检查是否被取消
      if (this.controller.signal.aborted) {
        throw new Error('Execution cancelled');
      }

      // 执行
      await executeWorkflow(nodes, edges, options);

      // 完成
      this.progress.status = 'completed';
      this.progress.completedAt = new Date();
      await this.updateExecutionStatus('completed');

    } catch (error) {
      if (this.controller.signal.aborted) {
        this.progress.status = 'cancelled';
        await this.updateExecutionStatus('cancelled');
      } else {
        this.progress.status = 'failed';
        this.progress.error = error instanceof Error ? error.message : 'Unknown error';
        await this.updateExecutionStatus('failed', this.progress.error);
      }
    } finally {
      activeExecutions.delete(this.executionId);
    }

    return this.progress;
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.controller.abort();
  }

  /**
   * 获取进度
   */
  getProgress(): ExecutionProgress {
    return { ...this.progress };
  }

  /**
   * 处理步骤开始
   */
  private async handleStepStart(nodeId: string, nodeName: string): Promise<void> {
    this.progress.currentNodeId = nodeId;
    this.progress.currentNodeName = nodeName;

    // 更新步骤状态
    const step = this.progress.steps.find(s => s.nodeId === nodeId);
    if (step) {
      step.status = 'running';
      step.startedAt = new Date();
    }

    // 更新数据库
    await prisma.workflowExecutionStep.updateMany({
      where: { executionId: this.executionId, nodeId },
      data: { status: 'running', startedAt: new Date() },
    });

    // 更新执行记录
    await prisma.workflowExecution.update({
      where: { id: this.executionId },
      data: { currentNodeId: nodeId },
    });
  }

  /**
   * 处理步骤完成
   */
  private async handleStepComplete(result: StepResult): Promise<void> {
    this.progress.completedNodes++;

    // 更新步骤状态
    const step = this.progress.steps.find(s => s.nodeId === result.nodeId);
    if (step) {
      step.status = result.status === 'completed' ? 'completed' : 'failed';
      step.completedAt = new Date();
      step.output = result.output;
      step.error = result.error;
    }

    // 更新数据库
    await prisma.workflowExecutionStep.updateMany({
      where: { executionId: this.executionId, nodeId: result.nodeId },
      data: {
        status: result.status,
        completedAt: new Date(),
        output: result.output ? JSON.stringify(result.output) : null,
        error: result.error,
      },
    });
  }

  /**
   * 处理步骤错误
   */
  private async handleStepError(nodeId: string, error: string): Promise<void> {
    const step = this.progress.steps.find(s => s.nodeId === nodeId);
    if (step) {
      step.status = 'failed';
      step.error = error;
      step.completedAt = new Date();
    }

    await prisma.workflowExecutionStep.updateMany({
      where: { executionId: this.executionId, nodeId },
      data: { status: 'failed', error, completedAt: new Date() },
    });
  }

  /**
   * 初始化步骤
   */
  private async initializeSteps(nodes: FlowNode[]): Promise<void> {
    for (const node of nodes) {
      this.progress.steps.push({
        stepId: `${this.executionId}-${node.id}`,
        nodeId: node.id,
        nodeName: node.data.label || node.type,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        output: null,
        error: null,
      });
    }
  }

  /**
   * 更新执行状态
   */
  private async updateExecutionStatus(status: ExecutionStatus, error?: string): Promise<void> {
    await prisma.workflowExecution.update({
      where: { id: this.executionId },
      data: {
        status,
        error,
        completedAt: status === 'completed' || status === 'failed' || status === 'cancelled'
          ? new Date()
          : undefined,
      },
    });
  }
}

/**
 * 获取活跃执行
 */
export function getActiveExecution(executionId: string): {
  controller: AbortController;
  progress: ExecutionProgress;
} | undefined {
  return activeExecutions.get(executionId);
}

/**
 * 取消活跃执行
 */
export function cancelExecution(executionId: string): boolean {
  const execution = activeExecutions.get(executionId);
  if (execution) {
    execution.controller.abort();
    return true;
  }
  return false;
}

/**
 * 获取执行进度
 */
export async function getExecutionProgress(executionId: string): Promise<ExecutionProgress | null> {
  // 先检查活跃执行
  const active = activeExecutions.get(executionId);
  if (active) {
    return active.progress;
  }

  // 从数据库获取
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    include: {
      steps: true,
    },
  });

  if (!execution) {
    return null;
  }

  // 获取工作流节点信息
  const workflow = await prisma.workflow.findUnique({
    where: { id: execution.workflowId },
    include: { nodes: true },
  });

  const nodeMap = new Map<string, string>();
  if (workflow) {
    for (const node of workflow.nodes) {
      const nodeData = node.data as { label?: string };
      nodeMap.set(node.id, nodeData.label || node.type);
    }
  }

  return {
    executionId: execution.id,
    workflowId: execution.workflowId,
    status: execution.status as ExecutionStatus,
    currentNodeId: null,
    currentNodeName: null,
    totalNodes: execution.steps.length,
    completedNodes: execution.steps.filter(s => s.status === 'completed').length,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    error: execution.error,
    steps: execution.steps.map(step => ({
      stepId: step.id,
      nodeId: step.nodeId,
      nodeName: nodeMap.get(step.nodeId) || step.nodeId,
      status: step.status as StepProgress['status'],
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      output: step.output ? JSON.parse(step.output as string) : null,
      error: step.error,
    })),
  };
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/workflow-execution-service.ts
git commit -m "feat(workflow): add workflow execution service with progress tracking"
```

---

## Task 2: 更新执行 API

**Files:**
- Modify: `src/app/api/workflows/[id]/execute/route.ts`

- [ ] **Step 1: 更新执行 API 使用执行服务**

```typescript
// src/app/api/workflows/[id]/execute/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { WorkflowExecutionService } from '@/lib/workflow-execution-service';

// 执行工作流
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_EXECUTE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id: workflowId } = await params;

    // 查询工作流
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      include: {
        nodes: true,
        edges: true,
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    }

    // 检查工作流是否属于当前用户或有执行权限
    if (workflow.userId !== payload.userId) {
      const share = await prisma.workflowShare.findFirst({
        where: {
          workflowId,
          sharedWith: payload.userId,
          permission: { in: ['execute', 'edit'] },
        },
      });

      if (!share) {
        return NextResponse.json({ error: '无权执行此工作流' }, { status: 403 });
      }
    }

    // 检查工作流状态
    if (workflow.status !== 'published') {
      return NextResponse.json(
        { error: '只能执行已发布的工作流' },
        { status: 400 }
      );
    }

    // 检查工作流是否有效
    const startNode = workflow.nodes.find((node) => node.type === 'start');
    const endNode = workflow.nodes.find((node) => node.type === 'end');

    if (!startNode || !endNode) {
      return NextResponse.json(
        { error: '工作流缺少开始或结束节点' },
        { status: 400 }
      );
    }

    // 解析节点和边数据
    const nodes = workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type as 'start' | 'end' | 'task' | 'subtask',
      position: node.position as { x: number; y: number },
      data: node.data as { label: string; config?: Record<string, unknown> },
    }));

    const edges = workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      data: edge.data as Record<string, unknown> | undefined,
    }));

    // 创建执行记录
    const execution = await prisma.workflowExecution.create({
      data: {
        workflowId,
        userId: payload.userId,
        status: 'pending',
      },
    });

    // 为每个节点创建执行步骤记录
    await Promise.all(
      workflow.nodes.map((node) =>
        prisma.workflowExecutionStep.create({
          data: {
            executionId: execution.id,
            nodeId: node.id,
            status: 'pending',
          },
        })
      )
    );

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'workflow_execute',
        resource: execution.id,
        details: JSON.stringify({
          workflowId,
          workflowName: workflow.name,
          nodeCount: workflow.nodes.length,
        }),
      },
    });

    // 异步执行工作流
    const executionService = new WorkflowExecutionService({
      executionId: execution.id,
      workflowId,
      userId: payload.userId,
    });

    // 在后台执行（不阻塞响应）
    executionService.execute(nodes, edges).catch((error) => {
      console.error('[Workflow Execution Error]:', error);
    });

    return NextResponse.json(
      {
        message: '工作流执行已启动',
        execution: {
          id: execution.id,
          workflowId: execution.workflowId,
          status: execution.status,
          startedAt: execution.startedAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Execute workflow error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/api/workflows/[id]/execute/route.ts
git commit -m "feat(api): integrate workflow execution service with execute API"
```

---

## Task 3: 创建进度 SSE API

**Files:**
- Create: `src/app/api/executions/[id]/progress/route.ts`

- [ ] **Step 1: 创建进度 SSE API**

```typescript
// src/app/api/executions/[id]/progress/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { getExecutionProgress, getActiveExecution } from '@/lib/workflow-execution-service';

// GET /api/executions/:id/progress - SSE 进度流
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id: executionId } = await params;

    // 验证执行记录
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    if (execution.userId !== payload.userId) {
      return NextResponse.json({ error: '无权访问此执行' }, { status: 403 });
    }

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let lastStatus = '';
        let lastCompletedNodes = -1;

        const sendProgress = async () => {
          try {
            const progress = await getExecutionProgress(executionId);
            if (!progress) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '执行不存在' })}\n\n`));
              controller.close();
              return;
            }

            // 只在状态或进度变化时发送
            if (progress.status !== lastStatus || progress.completedNodes !== lastCompletedNodes) {
              lastStatus = progress.status;
              lastCompletedNodes = progress.completedNodes;

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
            }

            // 检查是否已完成
            if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled') {
              controller.close();
              return;
            }
          } catch (error) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '获取进度失败' })}\n\n`));
            controller.close();
          }
        };

        // 初始发送
        await sendProgress();

        // 定期轮询
        const interval = setInterval(async () => {
          await sendProgress();
        }, 500);

        // 清理
        const cleanup = () => {
          clearInterval(interval);
        };

        // 设置超时（5分钟）
        setTimeout(() => {
          cleanup();
          controller.close();
        }, 5 * 60 * 1000);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Get execution progress error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/api/executions/[id]/progress/route.ts
git commit -m "feat(api): add SSE progress endpoint for workflow execution"
```

---

## Task 4: 完善取消执行 API

**Files:**
- Modify: `src/app/api/executions/[id]/cancel/route.ts`

- [ ] **Step 1: 更新取消 API**

```typescript
// src/app/api/executions/[id]/cancel/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { cancelExecution, getActiveExecution } from '@/lib/workflow-execution-service';

// 取消正在执行的流程
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_EXECUTE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id: executionId } = await params;

    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    if (execution.userId !== payload.userId) {
      return NextResponse.json({ error: '无权取消此执行' }, { status: 403 });
    }

    // 检查执行状态
    if (execution.status === 'completed') {
      return NextResponse.json({ error: '执行已完成，无法取消' }, { status: 400 });
    }

    if (execution.status === 'failed') {
      return NextResponse.json({ error: '执行已失败，无法取消' }, { status: 400 });
    }

    if (execution.status === 'cancelled') {
      return NextResponse.json({ error: '执行已取消' }, { status: 400 });
    }

    // 尝试取消活跃执行
    const wasActive = cancelExecution(executionId);

    // 更新数据库状态
    const updatedExecution = await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    // 取消所有正在运行的步骤
    await prisma.workflowExecutionStep.updateMany({
      where: {
        executionId,
        status: { in: ['pending', 'running'] },
      },
      data: {
        status: 'skipped',
      },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'execution_cancel',
        resource: executionId,
        details: JSON.stringify({
          workflowId: execution.workflowId,
          previousStatus: execution.status,
          wasActive,
        }),
      },
    });

    return NextResponse.json({
      message: '执行已取消',
      execution: updatedExecution,
      wasActive,
    });
  } catch (error) {
    console.error('Cancel execution error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/api/executions/[id]/cancel/route.ts
git commit -m "feat(api): implement real execution cancellation with active execution support"
```

---

## Task 5: 更新执行详情 API

**Files:**
- Modify: `src/app/api/executions/[id]/route.ts`

- [ ] **Step 1: 读取现有文件**

检查是否需要更新。

- [ ] **Step 2: 更新执行详情 API（如需要）**

如果现有 API 需要更新以包含更多进度信息，更新它。

- [ ] **Step 3: 提交**

```bash
git add src/app/api/executions/[id]/route.ts
git commit -m "feat(api): enhance execution details with progress info"
```

---

## Task 6: 验证和最终提交

- [ ] **Step 1: 运行构建**

```bash
cd D:/claude-web-platform && npm run build
```

Expected: 构建成功

- [ ] **Step 2: 最终提交**

```bash
git add -A
git commit -m "feat(workflow): complete workflow execution API with async execution and progress tracking

- Add WorkflowExecutionService for managing execution lifecycle
- Integrate execution service with workflow execute API
- Add SSE progress endpoint for real-time updates
- Implement real execution cancellation
- Support active execution tracking and interruption

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 完成检查清单

- [ ] 工作流执行服务创建完成
- [ ] 执行 API 更新完成
- [ ] 进度 SSE API 创建完成
- [ ] 取消执行 API 完善完成
- [ ] 执行详情 API 检查完成
- [ ] TypeScript 类型检查通过
- [ ] 构建成功
- [ ] 所有更改已提交

---

## 使用说明

### 启动工作流执行

```typescript
POST /api/workflows/{id}/execute
Response: { executionId, status, startedAt }
```

### 获取实时进度

```typescript
GET /api/executions/{id}/progress
// SSE 流，每 500ms 更新一次
data: { status, completedNodes, totalNodes, steps, ... }
```

### 取消执行

```typescript
POST /api/executions/{id}/cancel
Response: { message, execution, wasActive }
```

## 限制

1. 执行是异步的，不阻塞 HTTP 响应
2. 进度通过 SSE 轮询实现（每 500ms）
3. 活跃执行存储在内存中（重启后丢失）
4. 未来可考虑使用 Redis 或消息队列进行持久化
