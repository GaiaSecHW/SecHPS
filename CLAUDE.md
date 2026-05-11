# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI4WEB Test Platform - An AI-powered coding assistant platform with role-based access control (RBAC), multi-tenancy, workflow management, and AI model routing capabilities. Built with Next.js 16, React 19, TypeScript, Prisma ORM, and PostgreSQL.

## Build and Development Commands

```bash
# Development server
npm run dev

# Production build
npm run build

# Production run
npm start

# Linting
npm run lint

# Database commands
npm run db:generate    # Generate Prisma client
npm run db:push        # Push schema changes to database
npm run db:seed        # Seed database with initial data

# Database migrations (if needed)
npx prisma migrate dev --name <migration_name>
```

## Architecture Overview

### Technology Stack
- **Frontend**: Next.js 16 App Router + React 19 + TypeScript
- **Styling**: Tailwind CSS 4
- **Database**: Prisma ORM + PostgreSQL
- **Authentication**: JWT + bcryptjs (custom implementation in `src/lib/auth.ts`)
- **Workflow Editor**: @xyflow/react (React Flow)

### Key Directories

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes (REST endpoints)
│   │   ├── auth/          # Authentication (login, register)
│   │   ├── users/         # User management
│   │   ├── roles/         # Role management
│   │   ├── permissions/   # Permission management
│   │   ├── workflows/     # Workflow CRUD and execution
│   │   ├── executions/    # Workflow execution history
│   │   ├── agent-apps/    # Agent application management
│   │   ├── skills/        # Skill management
│   │   ├── models/        # AI model configuration
│   │   ├── mcp-servers/   # MCP server management
│   │   ├── projects/      # Project management
│   │   ├── admin/         # Platform admin APIs
│   │   │   └── tenants/   # Tenant CRUD and user assignment
│   │   └── config/        # System configuration
│   ├── dashboard/         # Protected dashboard pages
│   │   ├── workflows/     # Workflow editor and management
│   │   ├── executions/    # Execution history viewer
│   │   ├── sessions/      # Project sessions
│   │   └── admin/         # Admin-only pages
│   │       └── tenants/   # Tenant management UI
│   ├── login/             # Login page
│   └── layout.tsx         # Root layout
├── components/
│   ├── workflow/          # Workflow editor components
│   │   ├── WorkflowEditor.tsx    # Main visual workflow editor
│   │   ├── CustomNodes.tsx       # Custom node types
│   │   ├── NodePalette.tsx       # Drag-and-drop node palette
│   │   └── ExecutionMonitor.tsx  # Execution monitoring
│   └── MarkdownRenderer.tsx      # Markdown rendering for AI responses
├── lib/
│   ├── auth.ts            # Authentication utilities (JWT, password hashing)
│   ├── api-auth.ts        # Enhanced auth middleware with tenant context
│   ├── prisma.ts          # Prisma client singleton
│   ├── tenant.ts          # Tenant context resolution (TenantContext interface)
│   ├── tenant-filter.ts   # Tenant isolation query filters (buildTenantFilter, etc.)
│   ├── workflow-executor.ts      # Workflow execution engine
│   ├── workflow-validator.ts     # Workflow validation
│   └── claude-router/     # AI model routing system
├── types/
│   ├── permissions.ts     # Permission constants and role definitions
│   ├── workflow.ts        # Workflow types (nodes, edges, execution)
│   └── config.ts          # Configuration types
└── prisma/
    └── schema.prisma      # Database schema (PostgreSQL)
```

### Authentication & Authorization

- JWT-based authentication stored in localStorage
- JWT payload includes `tenantId` and `isIcsTenant` for multi-tenancy
- RBAC with 5 default roles: `admin`, `manager`, `developer`, `user`, `viewer`
- Permission checking via `hasPermission()` in `src/lib/auth.ts`
- Protected routes use dashboard layout which checks for token presence

### Multi-Tenancy

The platform implements application-level multi-tenancy with three user classes:

| User Type | Tenant Binding | Access Scope | Can Create Public |
|-----------|---------------|--------------|-------------------|
| Platform Admin | None (`tenantId=null`) | All data | Yes |
| ICSL Tenant | `isIcsTenant=true` | All data | Yes |
| Regular Tenant | `tenantId=<id>` | Own tenant + public | No |

**Core tenant files:**
- `src/lib/tenant.ts` — `TenantContext` interface and `getTenantContext()` resolution from JWT
- `src/lib/tenant-filter.ts` — `buildTenantFilter()` for Prisma WHERE conditions, `getTenantIdForCreate()`
- `src/lib/api-auth.ts` — `authenticateRequestEnhanced()` returns `AuthSuccessResult` with tenant context

**Data isolation model:** Business tables (AgentApp, Project, Workflow, Skill, AgentTeam, ModelConfig, McpServerConfig, TaskInstance) include `tenantId` (nullable) and `isPublic` (Boolean) fields. Queries apply tenant filters at the application layer.

**Tenant admin API:** `/api/admin/tenants` — CRUD for tenants and user assignment (Platform Admin only).
**Tenant admin UI:** `/dashboard/admin/tenants` — tenant management page with user assignment.

See `docs/multi-tenant-design.md` for the full design document.

### Permission System

Permissions are defined in `src/types/permissions.ts` with format `module:action`:
- Session: `session:create`, `session:read`, `session:update`, `session:delete`, `session:share`, `session:revert`
- User: `user:create`, `user:read`, `user:update`, `user:delete`, `user:assign_role`
- Role: `role:create`, `role:read`, `role:update`, `role:delete`, `role:assign_permission`
- Workflow: `workflow:create`, `workflow:read`, `workflow:update`, `workflow:delete`, `workflow:execute`, `workflow:share`, `workflow:export`, `workflow:import`
- Config: `config:read`, `config:update`, `config:delete`

### API Pattern

All API routes follow this pattern:
1. Extract JWT token from Authorization header
2. Verify token with `verifyToken()`
3. Check permissions with `hasPermission()`
4. **Resolve tenant context** via `authenticateRequestEnhanced()` (tenant-aware routes)
5. **Apply tenant isolation** via `buildTenantFilter()` for queries
6. Execute business logic with Prisma
7. Return JSON response with appropriate status

### Workflow System

The workflow system uses React Flow for visual editing:
- **Node Types**: `start`, `end`, `task`, `subtask`
- **Execution**: Topological sort determines execution order
- **Persistence**: Workflows stored in database with nodes/edges as JSON
- See `src/types/workflow.ts` for type definitions

### Claude Router (`src/lib/claude-router/`)

AI model routing system that handles:
- Multiple AI provider integrations (OpenAI, Anthropic, Gemini, DeepSeek, etc.)
- Request/response transformations
- Token counting and speed monitoring
- Streaming support with SSE

## Code Conventions

1. **决策确认**: 遇到不确定的代码设计问题时，必须先询问 Boss，不得直接行动
2. **代码兼容性**: 不能写兼容性代码，除非 Boss 主动要求
3. **语言规则**: 用中文回答
4. **大项目拆分**: 对于非常大的项目，请将范围拆分为更小的计划，以避免达到输出令牌最大限制的问题

### Import Order
1. React imports
2. Third-party libraries
3. Internal imports using `@/` alias

### Naming Conventions
- **Components**: PascalCase (`UserTable`, `WorkflowEditor`)
- **Functions**: camelCase (`fetchUsers`, `handleSubmit`)
- **Constants**: UPPER_SNAKE_CASE (`PERMISSIONS`, `ROLES`)
- **Files**: kebab-case (`user-table.tsx`, `auth-utils.ts`)

### Client Components
Add `'use client'` directive for components using:
- React hooks (useState, useEffect, etc.)
- Browser APIs (localStorage, etc.)
- Event handlers

### Database Operations
Always use the singleton Prisma client from `@/lib/prisma`:
```typescript
import { prisma } from '@/lib/prisma';
```

## Test Accounts

Default accounts (seeded on `npm run db:seed`):
- **Platform Admin**: `admin@opencode.com` / `admin123` (no tenant, full access)
- **ICSL User**: `icsl_user` (ICSL tenant, full access)
- **Regular Tenant User**: `team_a_user` (team-a tenant, restricted access)

## Environment Variables

Required in `.env`:
```
DATABASE_URL="postgresql://user:password@host:5432/dbname"
JWT_SECRET="your-secret-key-change-in-production"
NODE_ENV="development"
```

## Claude Router Notes

The `src/lib/claude-router/` directory is excluded from TypeScript compilation in tsconfig.json. It contains a sophisticated AI model routing system with:
- Provider transformers for different AI APIs
- Plugin system for extensibility
- Streaming support with SSE parsing
- Token counting and caching
