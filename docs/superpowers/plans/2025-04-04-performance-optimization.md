# Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement comprehensive performance optimizations including API response caching, database query optimization, and pagination improvements.

**Architecture:** Multi-layered approach with in-memory caching for frequently accessed data, optimized Prisma queries with proper indexing, cursor-based pagination for large datasets, and response compression middleware.

**Tech Stack:** Next.js 16 API routes, Prisma ORM, SQLite, lru-cache for in-memory caching

---

## Files Structure

```
src/lib/
├── cache.ts                    # In-memory cache utility (LRU cache)
├── query-optimizer.ts          # Database query optimization helpers
└── middleware/
    └── compression.ts          # Response compression middleware

src/app/api/
├── cache/                      # Cache management API
│   ├── clear/route.ts          # Clear cache endpoint
│   └── stats/route.ts          # Cache statistics endpoint
└── [existing routes]           # Apply caching and pagination

prisma/
└── schema.prisma               # Add missing indexes

src/types/
└── pagination.ts               # Pagination types
```

---

### Task 1: Pagination Types and Utilities

**Files:**
- Create: `src/types/pagination.ts`
- Create: `src/lib/pagination.ts`

- [ ] **Step 1: Create pagination types**

```typescript
// src/types/pagination.ts

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
}

export interface CursorPaginatedResponse<T> {
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}

export interface OffsetPaginationOptions {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CursorPaginationOptions {
  cursor?: string;
  limit: number;
  cursorField?: string;
}
```

- [ ] **Step 2: Create pagination utility functions**

```typescript
// src/lib/pagination.ts

import type { PaginationParams, PaginatedResponse, CursorPaginationParams, CursorPaginatedResponse } from '@/types/pagination';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function getOffsetPagination(params: PaginationParams): { skip: number; take: number; page: number; limit: number } {
  const limit = Math.min(params.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = Math.max(params.page || 1, 1);
  const skip = (page - 1) * limit;

  return { skip, take: limit, page, limit };
}

export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

export function getCursorPagination(params: CursorPaginationParams): { take: number; cursor?: { id: string } } {
  const limit = Math.min(params.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const cursor = params.cursor ? { id: params.cursor } : undefined;

  return { take: limit + 1, cursor };
}

export function createCursorPaginatedResponse<T extends { id: string }>(
  data: T[],
  limit: number
): CursorPaginatedResponse<T> {
  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, -1) : data;
  const nextCursor = items.length > 0 ? items[items.length - 1].id : null;

  return {
    data: items,
    pagination: {
      nextCursor,
      hasMore,
      limit,
    },
  };
}

export function getSortOptions(
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
  defaultSortBy: string = 'createdAt',
  defaultSortOrder: 'asc' | 'desc' = 'desc'
): Record<string, 'asc' | 'desc'> {
  const field = sortBy || defaultSortBy;
  const order = sortOrder || defaultSortOrder;
  return { [field]: order };
}
```

- [ ] **Step 3: Commit pagination utilities**

```bash
git add src/types/pagination.ts src/lib/pagination.ts
git commit -m "feat: add pagination types and utilities

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: In-Memory Cache System

**Files:**
- Create: `src/lib/cache.ts`

- [ ] **Step 1: Create cache utility with LRU eviction**

```typescript
// src/lib/cache.ts

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  ksize: number;
  vsize: number;
}

class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxKeys: number;
  private defaultTTL: number;
  private stats = { hits: 0, misses: 0 };

  constructor(maxKeys: number = 500, defaultTTL: number = 60000) {
    this.maxKeys = maxKeys;
    this.defaultTTL = defaultTTL;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.stats.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttl?: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxKeys && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttl ?? this.defaultTTL),
      createdAt: Date.now(),
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  getStats(): CacheStats & { hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      keys: this.cache.size,
      ksize: this.cache.size,
      vsize: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}

// Global cache instances
export const userCache = new LRUCache(200, 5 * 60 * 1000); // 5 minutes
export const permissionCache = new LRUCache(500, 10 * 60 * 1000); // 10 minutes
export const workflowCache = new LRUCache(100, 2 * 60 * 1000); // 2 minutes
export const configCache = new LRUCache(50, 30 * 60 * 1000); // 30 minutes
export const skillCache = new LRUCache(100, 15 * 60 * 1000); // 15 minutes
export const patternCache = new LRUCache(100, 15 * 60 * 1000); // 15 minutes

// Cache key generators
export const cacheKeys = {
  user: (userId: string) => `user:${userId}`,
  userPermissions: (userId: string) => `user:perms:${userId}`,
  workflow: (workflowId: string) => `workflow:${workflowId}`,
  workflowList: (userId: string, page: number) => `workflows:${userId}:${page}`,
  config: (configId: string) => `config:${configId}`,
  skill: (skillId: string) => `skill:${skillId}`,
  skillList: (category?: string) => `skills:${category || 'all'}`,
  pattern: (patternId: string) => `pattern:${patternId}`,
  patternList: (category?: string) => `patterns:${category || 'all'}`,
};

// Utility function to get with fallback
export async function getOrSet<T>(
  cache: LRUCache<T>,
  key: string,
  fetcher: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const value = await fetcher();
  cache.set(key, value, ttl);
  return value;
}

// Invalidate related caches
export function invalidateUserCaches(userId: string): void {
  userCache.delete(cacheKeys.user(userId));
  userCache.delete(cacheKeys.userPermissions(userId));
}

export function invalidateWorkflowCaches(workflowId: string, userId?: string): void {
  workflowCache.delete(cacheKeys.workflow(workflowId));
  if (userId) {
    // Invalidate all workflow list pages for this user (approximation)
    for (let i = 1; i <= 10; i++) {
      workflowCache.delete(cacheKeys.workflowList(userId, i));
    }
  }
}

export function clearAllCaches(): void {
  userCache.clear();
  permissionCache.clear();
  workflowCache.clear();
  configCache.clear();
  skillCache.clear();
  patternCache.clear();
}

export function getAllCacheStats(): Record<string, ReturnType<LRUCache<unknown>['getStats']>> {
  return {
    user: userCache.getStats(),
    permission: permissionCache.getStats(),
    workflow: workflowCache.getStats(),
    config: configCache.getStats(),
    skill: skillCache.getStats(),
    pattern: patternCache.getStats(),
  };
}
```

- [ ] **Step 2: Commit cache system**

```bash
git add src/lib/cache.ts
git commit -m "feat: add in-memory LRU cache system

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Database Query Optimizer

**Files:**
- Create: `src/lib/query-optimizer.ts`

- [ ] **Step 1: Create query optimization utilities**

```typescript
// src/lib/query-optimizer.ts

import { Prisma } from '@prisma/client';

/**
 * Select only specific fields to reduce data transfer
 */
export function selectFields<T extends Record<string, unknown>>(
  fields: (keyof T)[]
): Prisma.SelectSubset<T, T> {
  return fields.reduce((acc, field) => {
    acc[field as string] = true;
    return acc;
  }, {} as Record<string, boolean>) as Prisma.SelectSubset<T, T>;
}

/**
 * Common user select for minimal user data
 */
export const userSelectMinimal = {
  id: true,
  email: true,
  username: true,
  name: true,
  avatar: true,
  isActive: true,
  createdAt: true,
};

/**
 * Common workflow select for list views
 */
export const workflowSelectMinimal = {
  id: true,
  name: true,
  description: true,
  thumbnail: true,
  status: true,
  version: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Common workflow select with user info
 */
export const workflowSelectWithUser = {
  id: true,
  name: true,
  description: true,
  thumbnail: true,
  status: true,
  version: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: userSelectMinimal,
  },
};

/**
 * Common skill select for list views
 */
export const skillSelectMinimal = {
  id: true,
  name: true,
  displayName: true,
  description: true,
  category: true,
  severity: true,
  isActive: true,
  successRate: true,
  execCount: true,
};

/**
 * Common pattern select for list views
 */
export const patternSelectMinimal = {
  id: true,
  name: true,
  displayName: true,
  description: true,
  category: true,
  isActive: true,
  isBuiltin: true,
};

/**
 * Build where clause with optional filters
 */
export function buildWhereClause<T extends Record<string, unknown>>(
  filters: Partial<T>
): Partial<T> {
  const where: Partial<T> = {};

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      (where as Record<string, unknown>)[key] = value;
    }
  }

  return where;
}

/**
 * Build search filter for text fields
 */
export function buildSearchFilter(
  searchFields: string[],
  searchTerm?: string
): Prisma.WhereInput | undefined {
  if (!searchTerm || searchTerm.trim() === '') {
    return undefined;
  }

  const term = searchTerm.trim();

  if (searchFields.length === 1) {
    return { [searchFields[0]]: { contains: term } };
  }

  return {
    OR: searchFields.map((field) => ({
      [field]: { contains: term },
    })),
  };
}

/**
 * Build date range filter
 */
export function buildDateRangeFilter(
  startDate?: Date | string,
  endDate?: Date | string
): { gte?: Date; lte?: Date } | undefined {
  const filter: { gte?: Date; lte?: Date } = {};

  if (startDate) {
    filter.gte = typeof startDate === 'string' ? new Date(startDate) : startDate;
  }

  if (endDate) {
    filter.lte = typeof endDate === 'string' ? new Date(endDate) : endDate;
  }

  if (Object.keys(filter).length === 0) {
    return undefined;
  }

  return filter;
}

/**
 * Build status filter
 */
export function buildStatusFilter(
  statuses?: string[]
): { in: string[] } | undefined {
  if (!statuses || statuses.length === 0) {
    return undefined;
  }

  return { in: statuses };
}

/**
 * Combine multiple where clauses
 */
export function combineWhereClauses(
  ...clauses: (Prisma.WhereInput | undefined)[]
): Prisma.WhereInput {
  const validClauses = clauses.filter((c) => c !== undefined && Object.keys(c).length > 0);

  if (validClauses.length === 0) {
    return {};
  }

  if (validClauses.length === 1) {
    return validClauses[0] as Prisma.WhereInput;
  }

  return { AND: validClauses };
}

/**
 * Count query optimization - use count with where only
 */
export async function optimizedCount<T>(
  model: { count: (args: { where: unknown }) => Promise<number> },
  where: unknown
): Promise<number> {
  return model.count({ where });
}
```

- [ ] **Step 2: Commit query optimizer**

```bash
git add src/lib/query-optimizer.ts
git commit -m "feat: add database query optimization utilities

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Cache Management API

**Files:**
- Create: `src/app/api/admin/cache/stats/route.ts`
- Create: `src/app/api/admin/cache/clear/route.ts`

- [ ] **Step 1: Create cache statistics endpoint**

```typescript
// src/app/api/admin/cache/stats/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getAllCacheStats } from '@/lib/cache';

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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const stats = getAllCacheStats();

    return NextResponse.json({
      caches: stats,
      summary: {
        totalKeys: Object.values(stats).reduce((sum, s) => sum + s.keys, 0),
        totalHits: Object.values(stats).reduce((sum, s) => sum + s.hits, 0),
        totalMisses: Object.values(stats).reduce((sum, s) => sum + s.misses, 0),
        averageHitRate: Object.values(stats).reduce((sum, s) => sum + s.hitRate, 0) / Object.keys(stats).length,
      },
    });
  } catch (error) {
    console.error('Cache stats error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create cache clear endpoint**

```typescript
// src/app/api/admin/cache/clear/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { clearAllCaches, invalidateUserCaches, invalidateWorkflowCaches } from '@/lib/cache';
import { prisma } from '@/lib/prisma';

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

    const body = await request.json().catch(() => ({}));
    const { cacheType, userId, workflowId } = body;

    if (cacheType === 'user' && userId) {
      invalidateUserCaches(userId);
      return NextResponse.json({ message: '用户缓存已清除', cacheType: 'user', userId });
    }

    if (cacheType === 'workflow' && workflowId) {
      invalidateWorkflowCaches(workflowId, userId);
      return NextResponse.json({ message: '工作流缓存已清除', cacheType: 'workflow', workflowId });
    }

    // Clear all caches
    clearAllCaches();

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'cache_clear',
        details: JSON.stringify({ cacheType: cacheType || 'all' }),
      },
    });

    return NextResponse.json({ message: '所有缓存已清除' });
  } catch (error) {
    console.error('Cache clear error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit cache API endpoints**

```bash
git add src/app/api/admin/cache/stats/route.ts src/app/api/admin/cache/clear/route.ts
git commit -m "feat: add cache management API endpoints

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Add Missing Database Indexes

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Review current indexes and add missing ones**

Add the following indexes to optimize common queries:

```prisma
// Add to model Workflow (around line 238)
@@index([userId, status])
@@index([status, isActive])

// Add to model WorkflowExecution (around line 301)
@@index([startedAt])
@@index([workflowId, status])

// Add to model SkillExecution (around line 460)
@@index([projectId, status])
@@index([skillId, status])

// Add to model Vulnerability (around line 544)
@@index([projectId, status])
@@index([severity, status])

// Add to model ScanTask (around line 627)
@@index([userId, status])

// Add to model AuditLog (around line 213)
@@index([action, createdAt])
```

- [ ] **Step 2: Run prisma migration**

```bash
npx prisma db push
```

- [ ] **Step 3: Commit schema changes**

```bash
git add prisma/schema.prisma
git commit -m "feat: add missing database indexes for query optimization

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Apply Pagination to Workflows API

**Files:**
- Modify: `src/app/api/workflows/route.ts`

- [ ] **Step 1: Read the current workflows route**

Run: Read file at `src/app/api/workflows/route.ts`

- [ ] **Step 2: Update workflows list endpoint with pagination and caching**

```typescript
// src/app/api/workflows/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { workflowSelectWithUser, buildSearchFilter, combineWhereClauses } from '@/lib/query-optimizer';
import { workflowCache, cacheKeys, getOrSet } from '@/lib/cache';

// GET /api/workflows - List workflows with pagination
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

    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // Build where clause
    const where = combineWhereClauses(
      { userId: payload.userId },
      status ? { status } : undefined,
      buildSearchFilter(['name', 'description'], search)
    );

    // Get total count and data in parallel
    const [total, workflows] = await Promise.all([
      prisma.workflow.count({ where }),
      prisma.workflow.findMany({
        where,
        select: workflowSelectWithUser,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return NextResponse.json(createPaginatedResponse(workflows, total, pageNum, pageLimit));
  } catch (error) {
    console.error('Get workflows error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/workflows - Create workflow (keep existing implementation)
// ... existing POST handler ...
```

- [ ] **Step 3: Commit workflows pagination**

```bash
git add src/app/api/workflows/route.ts
git commit -m "feat: add pagination and caching to workflows list API

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Apply Pagination to Executions API

**Files:**
- Modify: `src/app/api/executions/route.ts`

- [ ] **Step 1: Read current executions route**

Run: Read file at `src/app/api/executions/route.ts`

- [ ] **Step 2: Update executions list endpoint with pagination**

```typescript
// src/app/api/executions/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { combineWhereClauses, buildDateRangeFilter, buildStatusFilter } from '@/lib/query-optimizer';

// GET /api/executions - List executions with pagination
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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status')?.split(',') || undefined;
    const workflowId = searchParams.get('workflowId') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // Build where clause
    const where = combineWhereClauses(
      { userId: payload.userId },
      workflowId ? { workflowId } : undefined,
      buildStatusFilter(status),
      { startedAt: buildDateRangeFilter(startDate, endDate) }
    );

    // Get total count and data in parallel
    const [total, executions] = await Promise.all([
      prisma.workflowExecution.count({ where }),
      prisma.workflowExecution.findMany({
        where,
        include: {
          workflow: {
            select: { id: true, name: true, status: true },
          },
        },
        skip,
        take,
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    return NextResponse.json(createPaginatedResponse(executions, total, pageNum, pageLimit));
  } catch (error) {
    console.error('Get executions error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit executions pagination**

```bash
git add src/app/api/executions/route.ts
git commit -m "feat: add pagination and filtering to executions list API

Co-Authored-By Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Apply Pagination to Skills API

**Files:**
- Modify: `src/app/api/skills/route.ts`

- [ ] **Step 1: Read current skills route**

Run: Read file at `src/app/api/skills/route.ts`

- [ ] **Step 2: Add pagination to skills list endpoint**

Apply similar pagination pattern to the skills list endpoint with caching for frequently accessed skill lists.

- [ ] **Step 3: Commit skills pagination**

```bash
git add src/app/api/skills/route.ts
git commit -m "feat: add pagination and caching to skills list API

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Apply Pagination to Vulnerabilities API

**Files:**
- Modify: `src/app/api/vulnerabilities/route.ts`

- [ ] **Step 1: Add pagination to vulnerabilities list**

Apply pagination with filtering by severity, status, and projectId.

- [ ] **Step 2: Commit vulnerabilities pagination**

```bash
git add src/app/api/vulnerabilities/route.ts
git commit -m "feat: add pagination and filtering to vulnerabilities list API

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Apply Caching to User Permissions

**Files:**
- Modify: `src/lib/auth.ts`

- [ ] **Step 1: Update getUserWithPermissions to use cache**

```typescript
// Add to src/lib/auth.ts imports
import { userCache, permissionCache, cacheKeys, getOrSet } from '@/lib/cache';

// Update getUserWithPermissions function
export async function getUserWithPermissions(userId: string) {
  const cacheKey = cacheKeys.userPermissions(userId);

  return getOrSet(
    permissionCache,
    cacheKey,
    async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  permissions: true,
                },
              },
            },
          },
        },
      });

      if (!user) {
        return null;
      }

      // Extract all permissions (deduplicated)
      const permissions = new Set<string>();
      user.userRoles.forEach(userRole => {
        userRole.role.permissions.forEach(permission => {
          permissions.add(permission.name);
        });
      });

      return {
        user,
        roles: user.userRoles.map(ur => ur.role),
        permissions: Array.from(permissions),
      };
    },
    5 * 60 * 1000 // 5 minutes TTL
  );
}
```

- [ ] **Step 2: Commit auth caching**

```bash
git add src/lib/auth.ts
git commit -m "feat: add permission caching to getUserWithPermissions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Performance Testing Verification

**Files:**
- None (testing only)

- [ ] **Step 1: Run build to verify no errors**

```bash
npm run build
```

- [ ] **Step 2: Verify cache stats endpoint**

Start the server and test:
```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/admin/cache/stats
```

Expected: JSON with cache statistics

- [ ] **Step 3: Verify pagination on workflows endpoint**

```bash
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/workflows?page=1&limit=10"
```

Expected: JSON with `data` array and `pagination` object

---

## Summary

This plan implements:
1. **Pagination utilities** - Types and helpers for offset and cursor-based pagination
2. **LRU Cache system** - In-memory caching with TTL and automatic eviction
3. **Query optimizer** - Selective field queries and where clause builders
4. **Cache management API** - Admin endpoints for cache stats and clearing
5. **Database indexes** - Missing indexes for common query patterns
6. **Applied optimizations** - Pagination on list endpoints, caching on user permissions
