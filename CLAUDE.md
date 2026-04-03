# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI4WEB Test Platform - An AI-powered coding assistant platform with role-based access control (RBAC), workflow management, and AI model routing capabilities. Built with Next.js 16, React 19, TypeScript, Prisma ORM, and SQLite.

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
- **Database**: Prisma ORM + SQLite
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
│   │   └── config/        # System configuration
│   ├── dashboard/         # Protected dashboard pages
│   │   ├── workflows/     # Workflow editor and management
│   │   ├── executions/    # Execution history viewer
│   │   ├── sessions/      # Project sessions
│   │   └── admin/         # Admin-only pages
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
│   ├── prisma.ts          # Prisma client singleton
│   ├── workflow-executor.ts      # Workflow execution engine
│   ├── workflow-validator.ts     # Workflow validation
│   └── claude-router/     # AI model routing system
├── types/
│   ├── permissions.ts     # Permission constants and role definitions
│   ├── workflow.ts        # Workflow types (nodes, edges, execution)
│   └── config.ts          # Configuration types
└── prisma/
    └── schema.prisma      # Database schema
```

### Authentication & Authorization

- JWT-based authentication stored in localStorage
- RBAC with 5 default roles: `admin`, `manager`, `developer`, `user`, `viewer`
- Permission checking via `hasPermission()` in `src/lib/auth.ts`
- Protected routes use dashboard layout which checks for token presence

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
4. Execute business logic with Prisma
5. Return JSON response with appropriate status

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

## Test Account

Default admin account (seeded on `npm run db:seed`):
- Email: `admin@opencode.com`
- Password: `admin123`

## Environment Variables

Required in `.env`:
```
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret-key-change-in-production"
NODE_ENV="development"
```

## Claude Router Notes

The `src/lib/claude-router/` directory is excluded from TypeScript compilation in tsconfig.json. It contains a sophisticated AI model routing system with:
- Provider transformers for different AI APIs
- Plugin system for extensibility
- Streaming support with SSE parsing
- Token counting and caching
