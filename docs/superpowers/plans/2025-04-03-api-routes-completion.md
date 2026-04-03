# 补齐 API 路由实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐缺失的 5 个 API 模块：漏洞模式库、扫描任务、工具管理、代码理解、Agent 执行。

**Architecture:** 遵循现有 API 路由模式，使用 Next.js App Router + Prisma ORM + SQLite，实现 RESTful API 端点。

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma ORM, SQLite

---

## 文件结构

```
src/app/api/
├── patterns/
│   ├── route.ts              # GET/POST 模式列表/创建
│   ├── categories/route.ts   # GET 分类列表
│   └── [id]/
│       ├── route.ts          # GET/PUT/DELETE 模式详情
│       └── skills/route.ts   # GET 关联的 Skills
│
├── scans/
│   ├── route.ts              # GET/POST 扫描任务列表/创建
│   └── [id]/
│       ├── route.ts          # GET/PUT/DELETE 任务详情
│       ├── start/route.ts    # POST 启动扫描
│       ├── cancel/route.ts   # POST 取消扫描
│       ├── progress/route.ts # GET 进度(SSE)
│       └── reports/
│           ├── route.ts      # GET 报告列表
│           └── export/route.ts # POST 导出报告
│
├── tools/
│   ├── route.ts              # GET/POST 工具列表/创建
│   └── [id]/
│       ├── route.ts          # GET/PUT/DELETE 工具详情
│       ├── execute/route.ts  # POST 执行工具
│       └── validate/route.ts # POST 验证参数
│
├── code/
│   ├── analyze/route.ts      # POST 分析项目
│   └── [projectId]/
│       ├── structure/route.ts  # GET 项目结构
│       ├── knowledge/route.ts  # GET 代码知识
│       ├── graph/route.ts      # GET 调用图
│       ├── dataflow/route.ts   # GET 数据流
│       └── search/route.ts     # GET 搜索实体
│
└── agent/
    ├── execute/route.ts      # POST 执行 Skill
    ├── chat/route.ts         # POST 与 Agent 对话
    └── executions/
        └── [id]/
            ├── route.ts      # GET 执行状态
            └── cancel/route.ts # POST 取消执行
```

---

## Task 1: 创建漏洞模式库 API 路由

**Files:**
- Create: `src/app/api/patterns/route.ts`
- Create: `src/app/api/patterns/categories/route.ts`
- Create: `src/app/api/patterns/[id]/route.ts`
- Create: `src/app/api/patterns/[id]/skills/route.ts`

- [ ] **Step 1: 创建模式列表和创建 API**

```typescript
// src/app/api/patterns/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/patterns - 获取漏洞模式列表
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const isActive = searchParams.get('isActive');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (isActive !== null) where.isActive = isActive === 'true';

    const [patterns, total] = await Promise.all([
      prisma.vulnerabilityPattern.findMany({
        where,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.vulnerabilityPattern.count({ where }),
    ]);

    return NextResponse.json({
      patterns: patterns.map(p => ({
        ...p,
        patterns: JSON.parse(p.patterns),
        languages: JSON.parse(p.languages),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('获取漏洞模式列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/patterns - 创建漏洞模式
export async function POST(request: Request) {
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      displayName,
      description,
      category,
      cwe,
      cve,
      patterns,
      languages,
      exampleVulnerable,
      exampleFixed,
      fixGuidance,
    } = body;

    if (!name || !displayName || !description || !category || !patterns || !languages) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    const existing = await prisma.vulnerabilityPattern.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { error: '模式名称已存在' },
        { status: 400 }
      );
    }

    const pattern = await prisma.vulnerabilityPattern.create({
      data: {
        name,
        displayName,
        description,
        category,
        cwe,
        cve,
        patterns: JSON.stringify(patterns),
        languages: JSON.stringify(languages),
        exampleVulnerable,
        exampleFixed,
        fixGuidance,
        isBuiltin: false,
      },
    });

    return NextResponse.json(
      {
        pattern: {
          ...pattern,
          patterns: JSON.parse(pattern.patterns),
          languages: JSON.parse(pattern.languages),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('创建漏洞模式错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 创建模式分类 API**

```typescript
// src/app/api/patterns/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/patterns/categories - 获取模式分类列表
export async function GET(request: Request) {
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

    const categories = await prisma.vulnerabilityPattern.groupBy({
      by: ['category'],
      _count: {
        id: true,
      },
      where: {
        isActive: true,
      },
    });

    const categoryLabels: Record<string, string> = {
      'code-audit': '代码安全审计',
      'auth': '认证与授权',
      'sensitive': '敏感信息泄露',
      'api': 'API 安全',
      'config': '依赖与配置',
      'crypto': '加密与数据',
      'web': 'Web 安全',
      'business': '业务逻辑',
      'client': '客户端安全',
      'cloud': '云与容器安全',
    };

    const result = categories.map(c => ({
      name: c.category,
      label: categoryLabels[c.category] || c.category,
      count: c._count.id,
    }));

    return NextResponse.json({ categories: result });
  } catch (error) {
    console.error('获取模式分类错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 创建模式详情和更新删除 API**

```typescript
// src/app/api/patterns/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/patterns/:id - 获取模式详情
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

    const { id } = await params;

    const pattern = await prisma.vulnerabilityPattern.findUnique({
      where: { id },
    });

    if (!pattern) {
      return NextResponse.json({ error: '模式不存在' }, { status: 404 });
    }

    return NextResponse.json({
      pattern: {
        ...pattern,
        patterns: JSON.parse(pattern.patterns),
        languages: JSON.parse(pattern.languages),
      },
    });
  } catch (error) {
    console.error('获取模式详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/patterns/:id - 更新模式
export async function PUT(
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const pattern = await prisma.vulnerabilityPattern.findUnique({ where: { id } });
    if (!pattern) {
      return NextResponse.json({ error: '模式不存在' }, { status: 404 });
    }

    if (pattern.isBuiltin && Object.keys(body).some(k => k !== 'isActive')) {
      return NextResponse.json(
        { error: '内置模式只能修改启用状态' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.displayName !== undefined) updateData.displayName = body.displayName;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.cwe !== undefined) updateData.cwe = body.cwe;
    if (body.cve !== undefined) updateData.cve = body.cve;
    if (body.patterns !== undefined) updateData.patterns = JSON.stringify(body.patterns);
    if (body.languages !== undefined) updateData.languages = JSON.stringify(body.languages);
    if (body.exampleVulnerable !== undefined) updateData.exampleVulnerable = body.exampleVulnerable;
    if (body.exampleFixed !== undefined) updateData.exampleFixed = body.exampleFixed;
    if (body.fixGuidance !== undefined) updateData.fixGuidance = body.fixGuidance;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const updated = await prisma.vulnerabilityPattern.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      pattern: {
        ...updated,
        patterns: JSON.parse(updated.patterns),
        languages: JSON.parse(updated.languages),
      },
    });
  } catch (error) {
    console.error('更新模式错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/patterns/:id - 删除模式
export async function DELETE(
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    const pattern = await prisma.vulnerabilityPattern.findUnique({ where: { id } });
    if (!pattern) {
      return NextResponse.json({ error: '模式不存在' }, { status: 404 });
    }

    if (pattern.isBuiltin) {
      return NextResponse.json(
        { error: '内置模式不能删除' },
        { status: 400 }
      );
    }

    await prisma.vulnerabilityPattern.delete({ where: { id } });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除模式错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 创建模式关联 Skills API**

```typescript
// src/app/api/patterns/[id]/skills/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/patterns/:id/skills - 获取模式关联的 Skills
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

    const { id } = await params;

    const pattern = await prisma.vulnerabilityPattern.findUnique({
      where: { id },
    });

    if (!pattern) {
      return NextResponse.json({ error: '模式不存在' }, { status: 404 });
    }

    // 根据 CWE 查找关联的 Skills
    const skills = await prisma.skill.findMany({
      where: pattern.cwe
        ? { cwe: pattern.cwe, isActive: true }
        : { category: pattern.category, isActive: true },
      orderBy: [{ severity: 'desc' }, { name: 'asc' }],
    });

    return NextResponse.json({
      skills: skills.map(s => ({
        ...s,
        tools: JSON.parse(s.tools),
        parameters: JSON.parse(s.parameters),
      })),
    });
  } catch (error) {
    console.error('获取关联 Skills 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 5: 提交**

```bash
git add src/app/api/patterns/
git commit -m "feat(api): add VulnerabilityPattern CRUD API routes"
```

---

## Task 2: 创建扫描任务 API 路由

**Files:**
- Create: `src/app/api/scans/route.ts`
- Create: `src/app/api/scans/[id]/route.ts`
- Create: `src/app/api/scans/[id]/start/route.ts`
- Create: `src/app/api/scans/[id]/cancel/route.ts`
- Create: `src/app/api/scans/[id]/progress/route.ts`
- Create: `src/app/api/scans/[id]/reports/route.ts`
- Create: `src/app/api/scans/[id]/reports/export/route.ts`

- [ ] **Step 1: 创建扫描任务列表和创建 API**

```typescript
// src/app/api/scans/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/scans - 获取扫描任务列表
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;

    const [scans, total] = await Promise.all([
      prisma.scanTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          project: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.scanTask.count({ where }),
    ]);

    return NextResponse.json({
      scans: scans.map(s => ({
        ...s,
        skillIds: JSON.parse(s.skillIds),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('获取扫描任务列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/scans - 创建扫描任务
export async function POST(request: Request) {
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

    const body = await request.json();
    const { projectId, name, description, skillIds, schedule } = body;

    if (!projectId || !name || !skillIds || skillIds.length === 0) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    // 验证项目存在
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 验证 Skills 存在
    const skills = await prisma.skill.findMany({
      where: { id: { in: skillIds }, isActive: true },
    });
    if (skills.length !== skillIds.length) {
      return NextResponse.json({ error: '部分 Skill 不存在或未启用' }, { status: 400 });
    }

    const scan = await prisma.scanTask.create({
      data: {
        projectId,
        userId: payload.userId as string,
        name,
        description,
        skillIds: JSON.stringify(skillIds),
        schedule,
        totalSkills: skillIds.length,
      },
    });

    return NextResponse.json(
      {
        scan: {
          ...scan,
          skillIds: JSON.parse(scan.skillIds),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('创建扫描任务错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 创建扫描任务详情和更新删除 API**

```typescript
// src/app/api/scans/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/scans/:id - 获取扫描任务详情
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

    const { id } = await params;

    const scan = await prisma.scanTask.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true },
        },
        executions: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          include: {
            skill: {
              select: { id: true, name: true, displayName: true },
            },
          },
        },
        reports: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    return NextResponse.json({
      scan: {
        ...scan,
        skillIds: JSON.parse(scan.skillIds),
        executions: scan.executions.map(e => ({
          ...e,
          input: JSON.parse(e.input),
          output: e.output ? JSON.parse(e.output) : null,
        })),
        reports: scan.reports.map(r => ({
          ...r,
          summary: JSON.parse(r.summary),
          details: JSON.parse(r.details),
        })),
      },
    });
  } catch (error) {
    console.error('获取扫描任务详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/scans/:id - 更新扫描任务
export async function PUT(
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

    const { id } = await params;
    const body = await request.json();

    const scan = await prisma.scanTask.findUnique({ where: { id } });
    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    if (scan.status === 'running') {
      return NextResponse.json({ error: '运行中的任务不能修改' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.skillIds !== undefined) {
      updateData.skillIds = JSON.stringify(body.skillIds);
      updateData.totalSkills = body.skillIds.length;
    }
    if (body.schedule !== undefined) updateData.schedule = body.schedule;

    const updated = await prisma.scanTask.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      scan: {
        ...updated,
        skillIds: JSON.parse(updated.skillIds),
      },
    });
  } catch (error) {
    console.error('更新扫描任务错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/scans/:id - 删除扫描任务
export async function DELETE(
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

    const { id } = await params;

    const scan = await prisma.scanTask.findUnique({ where: { id } });
    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    if (scan.status === 'running') {
      return NextResponse.json({ error: '运行中的任务不能删除' }, { status: 400 });
    }

    await prisma.scanTask.delete({ where: { id } });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除扫描任务错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 创建启动扫描 API**

```typescript
// src/app/api/scans/[id]/start/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/scans/:id/start - 启动扫描
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

    const { id } = await params;

    const scan = await prisma.scanTask.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    if (scan.status === 'running') {
      return NextResponse.json({ error: '任务已在运行中' }, { status: 400 });
    }

    // 更新任务状态
    const updated = await prisma.scanTask.update({
      where: { id },
      data: {
        status: 'running',
        startedAt: new Date(),
        progress: 0,
        completedSkills: 0,
        findingsCount: 0,
        currentSkill: null,
        error: null,
      },
    });

    // TODO: 实际执行扫描的逻辑（后台任务）
    // 这里只更新状态，实际执行需要集成 Agent 执行引擎

    return NextResponse.json({
      scan: {
        ...updated,
        skillIds: JSON.parse(updated.skillIds),
      },
      message: '扫描任务已启动',
    });
  } catch (error) {
    console.error('启动扫描错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 创建取消扫描 API**

```typescript
// src/app/api/scans/[id]/cancel/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/scans/:id/cancel - 取消扫描
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

    const { id } = await params;

    const scan = await prisma.scanTask.findUnique({ where: { id } });

    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    if (scan.status !== 'running') {
      return NextResponse.json({ error: '只有运行中的任务可以取消' }, { status: 400 });
    }

    // 更新任务状态
    const updated = await prisma.scanTask.update({
      where: { id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    // 取消关联的执行
    await prisma.skillExecution.updateMany({
      where: {
        scanTaskId: id,
        status: 'pending',
      },
      data: {
        status: 'cancelled',
      },
    });

    return NextResponse.json({
      scan: {
        ...updated,
        skillIds: JSON.parse(updated.skillIds),
      },
      message: '扫描任务已取消',
    });
  } catch (error) {
    console.error('取消扫描错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 5: 创建扫描进度 API (SSE)**

```typescript
// src/app/api/scans/[id]/progress/route.ts

import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/scans/:id/progress - 获取扫描进度 (SSE)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);

  if (!payload) {
    return new Response(JSON.stringify({ error: '无效的令牌' }), { status: 401 });
  }

  const { id } = await params;

  const scan = await prisma.scanTask.findUnique({ where: { id } });
  if (!scan) {
    return new Response(JSON.stringify({ error: '扫描任务不存在' }), { status: 404 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const sendData = async () => {
        const currentScan = await prisma.scanTask.findUnique({ where: { id } });
        if (!currentScan) {
          controller.close();
          return;
        }

        const data = JSON.stringify({
          taskId: currentScan.id,
          status: currentScan.status,
          progress: currentScan.progress,
          currentSkill: currentScan.currentSkill,
          totalSkills: currentScan.totalSkills,
          completedSkills: currentScan.completedSkills,
          findingsCount: currentScan.findingsCount,
          startedAt: currentScan.startedAt,
          completedAt: currentScan.completedAt,
          error: currentScan.error,
        });

        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));

        if (currentScan.status === 'completed' || currentScan.status === 'failed' || currentScan.status === 'cancelled') {
          controller.close();
        }
      };

      // 立即发送一次
      await sendData();

      // 每2秒轮询一次
      const interval = setInterval(async () => {
        try {
          await sendData();
        } catch (err) {
          controller.close();
          clearInterval(interval);
        }
      }, 2000);

      // 30秒后超时
      setTimeout(() => {
        clearInterval(interval);
        controller.close();
      }, 30000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

- [ ] **Step 6: 创建扫描报告列表 API**

```typescript
// src/app/api/scans/[id]/reports/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/scans/:id/reports - 获取扫描报告列表
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

    const { id } = await params;

    const reports = await prisma.scanReport.findMany({
      where: { scanTaskId: id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      reports: reports.map(r => ({
        ...r,
        summary: JSON.parse(r.summary),
        details: JSON.parse(r.details),
      })),
    });
  } catch (error) {
    console.error('获取扫描报告错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 7: 提交**

```bash
git add src/app/api/scans/
git commit -m "feat(api): add ScanTask CRUD and execution API routes"
```

---

## Task 3: 创建工具管理 API 路由

**Files:**
- Create: `src/app/api/tools/route.ts`
- Create: `src/app/api/tools/[id]/route.ts`
- Create: `src/app/api/tools/[id]/execute/route.ts`
- Create: `src/app/api/tools/[id]/validate/route.ts`

- [ ] **Step 1: 创建工具列表和创建 API**

```typescript
// src/app/api/tools/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/tools - 获取工具列表
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const isActive = searchParams.get('isActive');

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (isActive !== null) where.isActive = isActive === 'true';

    const tools = await prisma.tool.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({
      tools: tools.map(t => ({
        ...t,
        parameters: JSON.parse(t.parameters),
        executorConfig: t.executorConfig ? JSON.parse(t.executorConfig) : null,
      })),
    });
  } catch (error) {
    console.error('获取工具列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/tools - 创建工具
export async function POST(request: Request) {
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      displayName,
      description,
      category,
      parameters,
      executor,
      executorConfig,
      requiresPermission,
      allowedInSandbox,
      timeout,
    } = body;

    if (!name || !displayName || !description || !category || !parameters || !executor) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    const existing = await prisma.tool.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { error: '工具名称已存在' },
        { status: 400 }
      );
    }

    const tool = await prisma.tool.create({
      data: {
        name,
        displayName,
        description,
        category,
        parameters: JSON.stringify(parameters),
        executor,
        executorConfig: executorConfig ? JSON.stringify(executorConfig) : null,
        requiresPermission: requiresPermission ?? false,
        allowedInSandbox: allowedInSandbox ?? true,
        timeout: timeout ?? 30000,
        isBuiltin: false,
      },
    });

    return NextResponse.json(
      {
        tool: {
          ...tool,
          parameters: JSON.parse(tool.parameters),
          executorConfig: tool.executorConfig ? JSON.parse(tool.executorConfig) : null,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('创建工具错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 创建工具详情和更新删除 API**

```typescript
// src/app/api/tools/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/tools/:id - 获取工具详情
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

    const { id } = await params;

    const tool = await prisma.tool.findUnique({ where: { id } });

    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    return NextResponse.json({
      tool: {
        ...tool,
        parameters: JSON.parse(tool.parameters),
        executorConfig: tool.executorConfig ? JSON.parse(tool.executorConfig) : null,
      },
    });
  } catch (error) {
    console.error('获取工具详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/tools/:id - 更新工具
export async function PUT(
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const tool = await prisma.tool.findUnique({ where: { id } });
    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    if (tool.isBuiltin && Object.keys(body).some(k => k !== 'isActive')) {
      return NextResponse.json(
        { error: '内置工具只能修改启用状态' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.displayName !== undefined) updateData.displayName = body.displayName;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.parameters !== undefined) updateData.parameters = JSON.stringify(body.parameters);
    if (body.executor !== undefined) updateData.executor = body.executor;
    if (body.executorConfig !== undefined) updateData.executorConfig = body.executorConfig ? JSON.stringify(body.executorConfig) : null;
    if (body.requiresPermission !== undefined) updateData.requiresPermission = body.requiresPermission;
    if (body.allowedInSandbox !== undefined) updateData.allowedInSandbox = body.allowedInSandbox;
    if (body.timeout !== undefined) updateData.timeout = body.timeout;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const updated = await prisma.tool.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      tool: {
        ...updated,
        parameters: JSON.parse(updated.parameters),
        executorConfig: updated.executorConfig ? JSON.parse(updated.executorConfig) : null,
      },
    });
  } catch (error) {
    console.error('更新工具错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/tools/:id - 删除工具
export async function DELETE(
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    const tool = await prisma.tool.findUnique({ where: { id } });
    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    if (tool.isBuiltin) {
      return NextResponse.json(
        { error: '内置工具不能删除' },
        { status: 400 }
      );
    }

    await prisma.tool.delete({ where: { id } });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除工具错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 创建工具执行 API**

```typescript
// src/app/api/tools/[id]/execute/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/tools/:id/execute - 执行工具
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

    const { id } = await params;
    const body = await request.json();

    const tool = await prisma.tool.findUnique({ where: { id } });

    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    if (!tool.isActive) {
      return NextResponse.json({ error: '工具未启用' }, { status: 400 });
    }

    // TODO: 实际执行工具的逻辑
    // 这里返回模拟结果
    const result = {
      toolId: tool.id,
      toolName: tool.name,
      parameters: body,
      executedAt: new Date().toISOString(),
      status: 'success',
      output: { message: '工具执行成功（模拟）' },
    };

    return NextResponse.json({ result });
  } catch (error) {
    console.error('执行工具错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 创建工具参数验证 API**

```typescript
// src/app/api/tools/[id]/validate/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/tools/:id/validate - 验证工具参数
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

    const { id } = await params;
    const body = await request.json();

    const tool = await prisma.tool.findUnique({ where: { id } });

    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    const parameters = JSON.parse(tool.parameters);
    const errors: string[] = [];

    // 验证必填参数
    for (const [key, schema] of Object.entries(parameters)) {
      const paramSchema = schema as Record<string, unknown>;
      if (paramSchema.required && (body[key] === undefined || body[key] === null || body[key] === '')) {
        errors.push(`参数 "${key}" 是必填的`);
      }
      // 类型验证
      if (body[key] !== undefined && paramSchema.type) {
        const actualType = typeof body[key];
        if (actualType !== paramSchema.type) {
          errors.push(`参数 "${key}" 类型错误，期望 ${paramSchema.type}，实际 ${actualType}`);
        }
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({
        valid: false,
        errors,
      }, { status: 400 });
    }

    return NextResponse.json({
      valid: true,
      message: '参数验证通过',
    });
  } catch (error) {
    console.error('验证参数错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 5: 提交**

```bash
git add src/app/api/tools/
git commit -m "feat(api): add Tool management API routes"
```

---

## Task 4: 创建代码理解 API 路由

**Files:**
- Create: `src/app/api/code/analyze/route.ts`
- Create: `src/app/api/code/[projectId]/structure/route.ts`
- Create: `src/app/api/code/[projectId]/knowledge/route.ts`
- Create: `src/app/api/code/[projectId]/graph/route.ts`
- Create: `src/app/api/code/[projectId]/dataflow/route.ts`
- Create: `src/app/api/code/[projectId]/search/route.ts`

- [ ] **Step 1: 创建代码分析 API**

```typescript
// src/app/api/code/analyze/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/code/analyze - 分析项目代码
export async function POST(request: Request) {
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

    const body = await request.json();
    const { projectId, options } = body;

    if (!projectId) {
      return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { files: true },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 检查是否已有结构分析
    let structure = await prisma.projectStructure.findUnique({
      where: { projectId },
    });

    if (!structure) {
      // 创建初始结构记录
      structure = await prisma.projectStructure.create({
        data: {
          projectId,
          structure: '{}',
          fileCount: project.files.length,
          codeCount: project.files.filter(f => 
            ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp'].includes(f.fileType)
          ).length,
          languageStats: '{}',
          status: 'pending',
        },
      });

      // TODO: 实际分析逻辑（后台任务）
      // 这里只更新状态为分析中
      await prisma.projectStructure.update({
        where: { id: structure.id },
        data: { status: 'analyzing' },
      });
    }

    // 统计知识库
    const knowledgeCount = await prisma.codeKnowledge.count({
      where: { projectId },
    });

    // 统计数据流
    const dataFlowCount = await prisma.dataFlow.count({
      where: { projectId },
    });

    return NextResponse.json({
      projectId,
      structure: structure ? {
        id: structure.id,
        projectId: structure.projectId,
        structure: JSON.parse(structure.structure),
        fileCount: structure.fileCount,
        codeCount: structure.codeCount,
        languageStats: JSON.parse(structure.languageStats),
        status: structure.status,
        analyzedAt: structure.analyzedAt,
        createdAt: structure.createdAt,
        updatedAt: structure.updatedAt,
      } : null,
      knowledgeCount,
      dataFlowCount,
      status: structure?.status || 'pending',
    });
  } catch (error) {
    console.error('分析项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 创建项目结构 API**

```typescript
// src/app/api/code/[projectId]/structure/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/structure - 获取项目结构
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
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

    const { projectId } = await params;

    const structure = await prisma.projectStructure.findUnique({
      where: { projectId },
    });

    if (!structure) {
      return NextResponse.json({ error: '项目结构不存在，请先分析项目' }, { status: 404 });
    }

    return NextResponse.json({
      structure: {
        id: structure.id,
        projectId: structure.projectId,
        structure: JSON.parse(structure.structure),
        fileCount: structure.fileCount,
        codeCount: structure.codeCount,
        languageStats: JSON.parse(structure.languageStats),
        status: structure.status,
        analyzedAt: structure.analyzedAt,
        createdAt: structure.createdAt,
        updatedAt: structure.updatedAt,
      },
    });
  } catch (error) {
    console.error('获取项目结构错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 创建代码知识 API**

```typescript
// src/app/api/code/[projectId]/knowledge/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/knowledge - 获取代码知识
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
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

    const { projectId } = await params;
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType');
    const name = searchParams.get('name');
    const filePath = searchParams.get('filePath');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');

    const where: Record<string, unknown> = { projectId };
    if (entityType) where.entityType = entityType;
    if (name) where.name = { contains: name };
    if (filePath) where.filePath = { contains: filePath };

    const [knowledge, total] = await Promise.all([
      prisma.codeKnowledge.findMany({
        where,
        orderBy: [{ filePath: 'asc' }, { lineStart: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.codeKnowledge.count({ where }),
    ]);

    return NextResponse.json({
      knowledge: knowledge.map(k => ({
        ...k,
        calls: k.calls ? JSON.parse(k.calls) : null,
        calledBy: k.calledBy ? JSON.parse(k.calledBy) : null,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('获取代码知识错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 创建调用图 API**

```typescript
// src/app/api/code/[projectId]/graph/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/graph - 获取调用图
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
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

    const { projectId } = await params;

    // 获取所有代码知识
    const knowledge = await prisma.codeKnowledge.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        entityType: true,
        filePath: true,
        lineStart: true,
        lineEnd: true,
        calls: true,
        calledBy: true,
      },
    });

    // 构建节点
    const nodes = knowledge.map(k => ({
      id: k.id,
      name: k.name,
      type: k.entityType,
      filePath: k.filePath,
      lineStart: k.lineStart,
      lineEnd: k.lineEnd,
    }));

    // 构建边
    const edges: Array<{ source: string; target: string; type: string }> = [];
    const nodeMap = new Map(knowledge.map(k => [k.id, k]));

    for (const k of knowledge) {
      const calls = k.calls ? JSON.parse(k.calls) : [];
      for (const call of calls) {
        // 查找被调用的函数
        const target = knowledge.find(t => t.name === call && t.id !== k.id);
        if (target) {
          edges.push({
            source: k.id,
            target: target.id,
            type: 'calls',
          });
        }
      }
    }

    return NextResponse.json({
      nodes,
      edges,
      stats: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        byType: knowledge.reduce((acc, k) => {
          acc[k.entityType] = (acc[k.entityType] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (error) {
    console.error('获取调用图错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 5: 创建数据流 API**

```typescript
// src/app/api/code/[projectId]/dataflow/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/dataflow - 获取数据流
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
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

    const { projectId } = await params;
    const { searchParams } = new URL(request.url);
    const userInputOnly = searchParams.get('userInputOnly') === 'true';
    const sensitiveOnly = searchParams.get('sensitiveOnly') === 'true';

    const where: Record<string, unknown> = { projectId };
    if (userInputOnly) where.isUserInput = true;
    if (sensitiveOnly) where.isSensitive = true;

    const dataFlows = await prisma.dataFlow.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      dataFlows: dataFlows.map(df => ({
        ...df,
        path: JSON.parse(df.path),
      })),
      total: dataFlows.length,
    });
  } catch (error) {
    console.error('获取数据流错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 6: 创建代码搜索 API**

```typescript
// src/app/api/code/[projectId]/search/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/search - 搜索代码实体
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
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

    const { projectId } = await params;
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const type = searchParams.get('type');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    if (!query) {
      return NextResponse.json({ error: '缺少搜索关键词' }, { status: 400 });
    }

    const where: Record<string, unknown> = { projectId };
    if (type) where.entityType = type;

    // 搜索名称或签名
    const results = await prisma.codeKnowledge.findMany({
      where: {
        ...where,
        OR: [
          { name: { contains: query } },
          { signature: { contains: query } },
          { docstring: { contains: query } },
          { code: { contains: query } },
        ],
      },
      orderBy: [{ filePath: 'asc' }, { lineStart: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const total = await prisma.codeKnowledge.count({
      where: {
        ...where,
        OR: [
          { name: { contains: query } },
          { signature: { contains: query } },
          { docstring: { contains: query } },
          { code: { contains: query } },
        ],
      },
    });

    return NextResponse.json({
      results: results.map(r => ({
        ...r,
        calls: r.calls ? JSON.parse(r.calls) : null,
        calledBy: r.calledBy ? JSON.parse(r.calledBy) : null,
      })),
      query,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('搜索代码错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 7: 提交**

```bash
git add src/app/api/code/
git commit -m "feat(api): add code understanding API routes"
```

---

## Task 5: 创建 Agent 执行 API 路由

**Files:**
- Create: `src/app/api/agent/execute/route.ts`
- Create: `src/app/api/agent/chat/route.ts`
- Create: `src/app/api/agent/executions/[id]/route.ts`
- Create: `src/app/api/agent/executions/[id]/cancel/route.ts`

- [ ] **Step 1: 创建 Agent 执行 Skill API**

```typescript
// src/app/api/agent/execute/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createEvaluationCaller } from '@/services/evaluation';

// POST /api/agent/execute - 执行 Skill
export async function POST(request: Request) {
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

    const body = await request.json();
    const { skillId, projectId, parameters } = body;

    if (!skillId || !projectId) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 获取 Skill
    const skill = await prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    if (!skill.isActive) {
      return NextResponse.json({ error: 'Skill 未启用' }, { status: 400 });
    }

    // 获取项目
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { files: true, config: true },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 创建执行记录
    const execution = await prisma.skillExecution.create({
      data: {
        skillId,
        projectId,
        input: JSON.stringify(parameters || {}),
        status: 'running',
        startedAt: new Date(),
      },
    });

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      await prisma.skillExecution.update({
        where: { id: execution.id },
        data: { status: 'failed', error: '模型配置不存在', completedAt: new Date() },
      });
      return NextResponse.json({ error: '模型配置不存在' }, { status: 500 });
    }

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        const caller = createEvaluationCaller(modelConfig);
        let fullResponse = '';

        try {
          // 构建 Prompt
          const systemPrompt = skill.systemPrompt;
          const userPrompt = skill.userPrompt
            .replace('{{filePath}}', parameters?.filePath || '')
            .replace('{{language}}', parameters?.language || 'unknown')
            .replace('{{code}}', parameters?.code || '');

          await caller.startEvaluation(execution.id, {
            projectName: project.name,
            projectDescription: project.description || undefined,
            environmentUrl: project.environmentUrl || undefined,
            files: project.files.map(f => ({
              name: f.fileName,
              type: f.fileType,
              size: f.fileSize,
            })),
            taskDescription: `System: ${systemPrompt}\n\nUser: ${userPrompt}`,
          }, {
            onChunk: (text) => {
              fullResponse += text;
              const data = JSON.stringify({
                type: 'message',
                content: text,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
            },
            onComplete: async () => {
              await prisma.skillExecution.update({
                where: { id: execution.id },
                data: {
                  status: 'completed',
                  output: JSON.stringify({ response: fullResponse }),
                  completedAt: new Date(),
                  duration: Date.now() - execution.startedAt.getTime(),
                },
              });

              const data = JSON.stringify({
                type: 'done',
                executionId: execution.id,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
            },
            onError: async (error) => {
              await prisma.skillExecution.update({
                where: { id: execution.id },
                data: {
                  status: 'failed',
                  error: error.message,
                  completedAt: new Date(),
                },
              });

              const data = JSON.stringify({
                type: 'error',
                error: error.message,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
            },
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          await prisma.skillExecution.update({
            where: { id: execution.id },
            data: {
              status: 'failed',
              error: errorMessage,
              completedAt: new Date(),
            },
          });

          const data = JSON.stringify({
            type: 'error',
            error: errorMessage,
            timestamp: Date.now(),
          });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          controller.close();
        }
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
    console.error('执行 Skill 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

async function getModelConfig() {
  const envApiKey = process.env.ANTHROPIC_API_KEY;
  const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const envModel = process.env.ANTHROPIC_MODEL;

  if (envApiKey) {
    return {
      providerType: 'claude',
      apiKey: envApiKey,
      apiBaseUrl: envBaseUrl || 'https://api.anthropic.com/v1/messages',
      models: JSON.stringify([envModel || 'claude-sonnet-4-20250514']),
    };
  }

  return prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });
}
```

- [ ] **Step 2: 创建 Agent 对话 API**

```typescript
// src/app/api/agent/chat/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createEvaluationCaller } from '@/services/evaluation';

// POST /api/agent/chat - 与 Agent 对话
export async function POST(request: Request) {
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

    const body = await request.json();
    const { executionId, message } = body;

    if (!executionId || !message) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 获取执行记录
    const execution = await prisma.skillExecution.findUnique({
      where: { id: executionId },
      include: {
        project: {
          include: { files: true, config: true },
        },
      },
    });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    if (execution.status !== 'completed') {
      return NextResponse.json({ error: '执行未完成，无法继续对话' }, { status: 400 });
    }

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json({ error: '模型配置不存在' }, { status: 500 });
    }

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        const caller = createEvaluationCaller(modelConfig);
        const project = execution.project;

        try {
          await caller.continueConversation(executionId, message, {
            projectName: project.name,
            projectDescription: project.description || undefined,
            environmentUrl: project.environmentUrl || undefined,
            files: project.files.map(f => ({
              name: f.fileName,
              type: f.fileType,
              size: f.fileSize,
            })),
          }, {
            onChunk: (text) => {
              const data = JSON.stringify({
                type: 'message',
                content: text,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
            },
            onComplete: () => {
              const data = JSON.stringify({
                type: 'done',
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
            },
            onError: (error) => {
              const data = JSON.stringify({
                type: 'error',
                error: error.message,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
            },
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          const data = JSON.stringify({
            type: 'error',
            error: errorMessage,
            timestamp: Date.now(),
          });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          controller.close();
        }
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
    console.error('Agent 对话错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

async function getModelConfig() {
  const envApiKey = process.env.ANTHROPIC_API_KEY;
  const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const envModel = process.env.ANTHROPIC_MODEL;

  if (envApiKey) {
    return {
      providerType: 'claude',
      apiKey: envApiKey,
      apiBaseUrl: envBaseUrl || 'https://api.anthropic.com/v1/messages',
      models: JSON.stringify([envModel || 'claude-sonnet-4-20250514']),
    };
  }

  return prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });
}
```

- [ ] **Step 3: 创建执行状态查询 API**

```typescript
// src/app/api/agent/executions/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/agent/executions/:id - 获取执行状态
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

    const { id } = await params;

    const execution = await prisma.skillExecution.findUnique({
      where: { id },
      include: {
        skill: {
          select: { id: true, name: true, displayName: true, category: true },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    return NextResponse.json({
      execution: {
        ...execution,
        input: JSON.parse(execution.input),
        output: execution.output ? JSON.parse(execution.output) : null,
      },
    });
  } catch (error) {
    console.error('获取执行状态错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 创建取消执行 API**

```typescript
// src/app/api/agent/executions/[id]/cancel/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/agent/executions/:id/cancel - 取消执行
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

    const { id } = await params;

    const execution = await prisma.skillExecution.findUnique({ where: { id } });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    if (execution.status !== 'running' && execution.status !== 'pending') {
      return NextResponse.json({ error: '只能取消运行中或待执行的记录' }, { status: 400 });
    }

    const updated = await prisma.skillExecution.update({
      where: { id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      execution: {
        ...updated,
        input: JSON.parse(updated.input),
        output: updated.output ? JSON.parse(updated.output) : null,
      },
      message: '执行已取消',
    });
  } catch (error) {
    console.error('取消执行错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 5: 提交**

```bash
git add src/app/api/agent/
git commit -m "feat(api): add Agent execution API routes"
```

---

## Task 6: 最终验证和提交

- [ ] **Step 1: 运行构建验证**

```bash
cd D:/claude-web-platform && npm run build
```

Expected: 构建成功，列出所有新 API 路由

- [ ] **Step 2: 验证 API 路由**

检查构建输出中是否包含：
- `/api/patterns/*`
- `/api/scans/*`
- `/api/tools/*`
- `/api/code/*`
- `/api/agent/*`

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "feat(api): add missing API routes for vulnerability platform

- Add VulnerabilityPattern CRUD API (patterns/*)
- Add ScanTask management API (scans/*)
- Add Tool management API (tools/*)
- Add Code understanding API (code/*)
- Add Agent execution API (agent/*)

All routes follow existing patterns with:
- JWT authentication
- Permission checking
- Prisma ORM integration
- Proper error handling"
```

---

## 完成检查清单

- [ ] 漏洞模式库 API 完成
- [ ] 扫描任务 API 完成
- [ ] 工具管理 API 完成
- [ ] 代码理解 API 完成
- [ ] Agent 执行 API 完成
- [ ] TypeScript 类型检查通过
- [ ] 构建成功
- [ ] 所有更改已提交

---

## 后续任务（不在本计划范围）

1. 实现实际的 Agent 执行引擎
2. 实现工具执行器（read_file, write_file 等）
3. 添加单元测试
4. 添加 API 文档
5. 性能优化和缓存
