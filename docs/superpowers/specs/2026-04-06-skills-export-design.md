# Skills 混合方案设计文档

**日期**: 2026-04-06  
**版本**: 1.0  
**作者**: AI Assistant  
**状态**: 待审查

## 执行摘要

本文档描述了 SecHPS 测试平台中 Skills 系统的混合方案实现：数据库存储 + Claude 格式导出。该方案保留了现有的数据库存储优势（版本控制、权限管理、详细统计），同时通过自动导出到 `.claude/skills/` 目录，使 Claude 能够自动发现并选择合适的 Skills 进行评估。

## 背景和动机

### 当前问题

1. **Skills 仅存储在数据库中**：无法被 Claude 自动发现和使用
2. **评估流程需要手动注入 Skills**：当前通过 `loadActiveSkills()` 加载并注入到 prompt 中
3. **无法利用 Claude 的智能选择能力**：Claude 无法根据项目特点自动选择 Skills

### 解决方案

实现混合方案：
- **数据库存储**（保留）：继续使用 Prisma 存储 Skills，支持版本控制、权限管理、详细统计
- **Claude 格式导出**（新增）：在评估时自动将 Skills 导出到项目的 `.claude/skills/` 目录
- **自动发现和选择**（Claude 能力）：Claude 根据项目特点自动发现并选择合适的 Skills

## 架构设计

### 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    评估启动流程                           │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  1. 加载项目信息 (Prisma)                                 │
│     - 获取 projectPath                                    │
│     - 验证路径存在性                                       │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  2. 同步 Skills 到项目 (skills-export.ts)                │
│     - 加载激活的 Skills                                   │
│     - 检查版本变更                                        │
│     - 导出/更新 SKILL.md 文件                             │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  3. 继续评估流程 (evaluation.ts)                          │
│     - Claude 自动发现 .claude/skills/                    │
│     - 基于描述智能选择 Skills                             │
│     - 执行评估                                            │
└─────────────────────────────────────────────────────────┘
```

### 目录结构

```
project-root/
├── .claude/
│   └── skills/
│       ├── sql-injection/
│       │   └── SKILL.md
│       ├── xss-detection/
│       │   └── SKILL.md
│       └── auth-bypass/
│           └── SKILL.md
└── src/
    └── ...
```

### 数据流

```
数据库 (Prisma)
    │
    ├─ 激活的 Skills (userId=null || userId=当前用户)
    │  - version
    │  - updatedAt
    │  - systemPrompt, userPrompt
    │
    ▼
Skills 导出服务 (skills-export.ts)
    │
    ├─ 检查版本变更
    │  - 对比文件系统中的 SKILL.md
    │  - 决定是否需要重新导出
    │
    ▼
文件系统
    │
    └─ .claude/skills/{skill-name}/SKILL.md
       - 符合 Claude 官方格式
       - 包含 YAML front matter
       - 包含完整的 skill 定义
```

## 详细设计

### 1. Skills 导出格式

#### 1.1 SKILL.md 文件格式

每个 Skill 导出为独立的 `SKILL.md` 文件，格式如下：

```yaml
---
name: sql-injection
description: 检测代码中的 SQL 注入漏洞，包括直接拼接、不安全的动态查询等常见模式
allowed-tools: 
  - Read
  - Grep
  - Bash(grep *)
version: 3
exportedAt: 2026-04-06T10:00:00Z
---

# SQL 注入检测专家

你是一个专业的 SQL 注入检测专家。请检查代码中的 SQL 注入漏洞：

## 检测重点

1. **用户输入点识别**
   - 识别所有用户输入来源（表单、URL、Cookie、Headers）
   - 跟踪用户输入的数据流向

2. **SQL 查询构建检查**
   - 检查是否存在字符串直接拼接 SQL
   - 验证是否使用参数化查询
   - 检查动态表名/列名的安全性

3. **ORM 使用验证**
   - 检查 ORM 框架的查询构建方法
   - 验证是否存在不安全的原生查询

4. **白名单验证**
   - 检查是否存在有效的输入白名单
   - 验证输入过滤和转义机制

## 输出格式

对每个发现的潜在漏洞，请提供：
- 文件路径和行号
- 漏洞类型（直接拼接、动态查询、ORM 注入等）
- 风险等级
- 修复建议
```

#### 1.2 YAML Front Matter 字段映射

| 数据库字段 | YAML 字段 | 类型 | 必需 | 说明 |
|-----------|----------|------|------|------|
| `name` | `name` | string | ✅ | Skill 唯一标识符 |
| `description` | `description` | string | ✅ | Skill 描述 |
| `tools` (JSON) | `allowed-tools` | array | ✅ | 允许使用的工具列表 |
| `version` | `version` | number | ✅ | Skill 版本号 |
| `updatedAt` | `exportedAt` | datetime | ✅ | 导出时间戳 |
| `paths` (JSON) | `paths` | array | ❌ | Glob 模式数组 |
| `agent` | `agent` | string | ❌ | 子代理类型 |
| `model` | `model` | string | ❌ | 指定模型 |
| `effort` | `effort` | string | ❌ | 工作级别 (low/medium/high/max) |
| `shell` | `shell` | string | ❌ | Shell 类型 (bash/powershell) |

#### 1.3 Markdown 内容结构

```
{systemPrompt}

{userPrompt}
```

将数据库中的 `systemPrompt` 和 `userPrompt` 组合成完整的 Markdown 内容。

### 2. 核心服务实现

#### 2.1 Skills 导出服务 (`src/services/skills-export.ts`)

**主要函数**：

```typescript
/**
 * 同步 Skills 到项目目录
 * 
 * @param projectId - 项目 ID
 * @param projectPath - 项目路径
 * @returns 同步结果统计
 */
export async function syncSkillsToProject(
  projectId: string,
  projectPath: string
): Promise<SkillSyncResult>

/**
 * 生成 Skill 的 SKILL.md 内容
 * 
 * @param skill - Skill 数据
 * @returns SKILL.md 文件内容
 */
export function generateSkillMarkdown(skill: LoadedSkill): string

/**
 * 检查 Skill 是否需要重新导出
 * 
 * @param skill - Skill 数据
 * @param skillPath - SKILL.md 文件路径
 * @returns 是否需要重新导出
 */
export async function needsReexport(
  skill: LoadedSkill,
  skillPath: string
): Promise<boolean>

/**
 * 清理项目中不再激活的 Skills
 * 
 * @param skillsDirectory - .claude/skills 目录路径
 * @param activeSkillNames - 激活的 Skill 名称列表
 * @returns 清理的数量
 */
async function cleanupObsoleteSkills(
  skillsDirectory: string,
  activeSkillNames: string[]
): Promise<number>

/**
 * 获取 Skills 导出目录路径
 * 
 * @param projectPath - 项目路径
 * @returns .claude/skills 目录路径
 */
export function getSkillsExportPath(projectPath: string): string
```

#### 2.2 类型定义 (`src/types/skills.ts` 扩展)

```typescript
/**
 * Skill 导出选项
 */
export interface SkillExportOptions {
  projectPath: string;
  overwrite?: boolean;        // 是否覆盖现有文件（默认 false）
  cleanup?: boolean;          // 是否清理过期的 Skills（默认 true）
  includePrivate?: boolean;   // 是否包含私有 Skills（默认 false）
}

/**
 * Skill 同步结果
 */
export interface SkillSyncResult {
  total: number;              // 总 Skills 数
  exported: number;           // 新导出数量
  updated: number;            // 更新数量
  skipped: number;            // 跳过数量（版本未变更）
  removed: number;            // 清理数量（过期的 Skills）
  errors: Array<{
    skillName: string;
    error: string;
  }>;
}

/**
 * Skill 导出状态
 */
export interface SkillExportStatus {
  skillId: string;
  skillName: string;
  exportedAt: Date;
  version: number;
  path: string;
}

/**
 * YAML Front Matter 结构
 */
export interface SkillFrontMatter {
  name: string;
  description: string;
  allowedTools: string[];
  version: number;
  exportedAt: string;
  paths?: string[];
  agent?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  shell?: 'bash' | 'powershell';
}
```

### 3. API 端点设计

#### 3.1 手动导出 API（可选功能）

虽然主要流程是自动导出，但提供手动导出 API 用于调试和特殊场景。

**POST `/api/skills/export-to-project`**

请求体：
```json
{
  "projectId": "proj_abc123",
  "skillIds": ["skill1", "skill2"],
  "options": {
    "overwrite": true,
    "cleanup": false,
    "includePrivate": false
  }
}
```

响应：
```json
{
  "success": true,
  "result": {
    "total": 10,
    "exported": 3,
    "updated": 2,
    "skipped": 5,
    "removed": 0,
    "errors": []
  }
}
```

#### 3.2 导出状态查询 API

**GET `/api/skills/export-status?projectId=proj_abc123`**

响应：
```json
{
  "success": true,
  "projectPath": "/path/to/project",
  "skillsDirectory": "/path/to/project/.claude/skills",
  "lastSyncAt": "2026-04-06T10:00:00Z",
  "exportedSkills": [
    {
      "skillId": "skill1",
      "skillName": "sql-injection",
      "exportedAt": "2026-04-06T10:00:00Z",
      "version": 3,
      "path": "/path/to/project/.claude/skills/sql-injection/SKILL.md"
    },
    {
      "skillId": "skill2",
      "skillName": "xss-detection",
      "exportedAt": "2026-04-06T10:00:00Z",
      "version": 2,
      "path": "/path/to/project/.claude/skills/xss-detection/SKILL.md"
    }
  ]
}
```

### 4. 评估流程集成

#### 4.1 修改评估路由 (`src/app/api/evaluations/[id]/chat/route.ts`)

在现有评估启动流程中集成 Skills 导出：

```typescript
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ... 现有认证和项目加载逻辑 ...

    // 原有代码: 加载激活的 Skills
    const skills = await loadActiveSkills();
    console.log(`[Chat] 加载了 ${skills.length} 个激活的 Skills`);

    // 新增代码: 同步 Skills 到项目目录
    if (project.projectPath) {
      try {
        const syncResult = await syncSkillsToProject(project.id, project.projectPath);
        console.log('[Chat] Skills 同步结果:', syncResult);
      } catch (error) {
        console.error('[Chat] Skills 导出失败:', error);
        // 不阻塞评估流程，继续执行
      }
    } else {
      console.warn('[Chat] 项目路径未配置，跳过 Skills 导出');
    }

    // 继续原有流程: 创建评估调用器
    const caller = createEvaluationCaller(modelConfig, project.projectPath || undefined);
    
    // ... 其余代码 ...
  } catch (error) {
    // ... 错误处理 ...
  }
}
```

#### 4.2 评估启动流程修改（可选）

如果需要更深入地集成，可以修改 `src/services/evaluation.ts`：

```typescript
export function createEvaluationCaller(
  modelConfig: ModelConfig,
  projectPath?: string,
  skillsDirectory?: string  // 新增参数
) {
  // ... 现有代码 ...
  
  // 如果提供了 skillsDirectory 或 projectPath，配置 SDK 的 skills 路径
  if (skillsDirectory || projectPath) {
    const skillsPath = skillsDirectory || path.join(projectPath!, '.claude', 'skills');
    // SDK 配置中指定 skills 目录
    sdkConfig.skillsDirectory = skillsPath;
  }
  
  // ... 其余代码 ...
}
```

### 5. 版本同步机制

#### 5.1 版本判断逻辑

```typescript
/**
 * 检查是否需要重新导出
 */
async function needsReexport(skill: LoadedSkill, skillPath: string): Promise<boolean> {
  try {
    // 读取现有 SKILL.md 文件
    const existingContent = await fs.readFile(skillPath, 'utf-8');
    
    // 提取 YAML front matter
    const frontMatter = extractYAMLFrontMatter(existingContent);
    
    // 如果文件不存在或格式错误，需要导出
    if (!frontMatter || !frontMatter.version) {
      return true;
    }
    
    // 对比版本号
    if (frontMatter.version !== skill.version) {
      return true;
    }
    
    // 对比 updatedAt（允许 1 秒误差）
    const exportedAt = new Date(frontMatter.exportedAt);
    const updatedAt = new Date(skill.updatedAt);
    if (Math.abs(exportedAt.getTime() - updatedAt.getTime()) > 1000) {
      return true;
    }
    
    return false;
  } catch (error) {
    // 文件不存在，需要导出
    return true;
  }
}

/**
 * 从 Markdown 内容提取 YAML front matter
 */
function extractYAMLFrontMatter(content: string): SkillFrontMatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  
  try {
    // 解析 YAML（使用简单的正则或 YAML 库）
    return parseSimpleYAML(match[1]);
  } catch (error) {
    return null;
  }
}
```

#### 5.2 清理过期 Skills

```typescript
/**
 * 清理项目中不再激活的 Skills
 */
async function cleanupObsoleteSkills(
  skillsDirectory: string,
  activeSkillNames: string[]
): Promise<number> {
  let removedCount = 0;
  
  try {
    const entries = await fs.readdir(skillsDirectory, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillName = entry.name;
        
        // 如果这个 Skill 不在激活列表中，删除它
        if (!activeSkillNames.includes(skillName)) {
          const skillPath = path.join(skillsDirectory, skillName);
          await fs.rm(skillPath, { recursive: true, force: true });
          removedCount++;
          console.log(`[Skills Export] 清理过期 Skill: ${skillName}`);
        }
      }
    }
  } catch (error) {
    console.error('[Skills Export] 清理过期 Skills 失败:', error);
  }
  
  return removedCount;
}
```

### 6. 错误处理和日志

#### 6.1 错误处理策略

```typescript
try {
  await syncSkillsToProject(projectId, projectPath);
} catch (error) {
  // 不阻塞评估流程
  console.error('[Skills Export] 导出失败:', error);
  
  // 记录到数据库（可选）
  await prisma.auditLog.create({
    data: {
      action: 'skill_export_error',
      resource: projectId,
      details: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        projectPath,
      }),
    },
  });
  
  // 继续评估流程
}
```

#### 6.2 日志格式

```
[Skills Export] 开始同步 Skills 到项目: /path/to/project
[Skills Export] 创建目录: /path/to/project/.claude/skills
[Skills Export] 加载了 15 个激活的 Skills
[Skills Export] 导出 Skill: sql-injection (v3)
[Skills Export] 更新 Skill: xss-detection (v2 -> v3)
[Skills Export] 跳过 Skill: auth-bypass (版本未变更)
[Skills Export] 清理过期 Skill: deprecated-skill
[Skills Export] 同步完成: 导出 3, 更新 1, 跳过 11, 清理 1
```

### 7. 性能优化

#### 7.1 缓存机制

```typescript
// 内存缓存导出状态
const exportCache = new Map<string, {
  version: number;
  updatedAt: Date;
  exportedAt: Date;
}>();

async function syncSkillsToProject(
  projectId: string,
  projectPath: string
): Promise<SkillSyncResult> {
  // 检查缓存，避免重复导出
  const cacheKey = `${projectId}:${projectPath}`;
  const cached = exportCache.get(cacheKey);
  
  if (cached && isRecentlyExported(cached.exportedAt, 5 * 60 * 1000)) {
    // 5 分钟内已导出，跳过
    console.log('[Skills Export] 使用缓存，跳过同步');
    return {
      total: 0,
      exported: 0,
      updated: 0,
      skipped: 0,
      removed: 0,
      errors: [],
    };
  }
  
  // ... 执行导出逻辑 ...
  
  // 更新缓存
  exportCache.set(cacheKey, {
    version: latestVersion,
    updatedAt: new Date(),
    exportedAt: new Date(),
  });
}
```

#### 7.2 批量写入

```typescript
// 使用 Promise.allSettled 并发导出
const exportPromises = skills.map(skill => exportSkill(skill, skillsDirectory));
const results = await Promise.allSettled(exportPromises);

// 统计结果
let exported = 0;
let updated = 0;
let skipped = 0;
const errors: Array<{ skillName: string; error: string }> = [];

results.forEach((result, index) => {
  if (result.status === 'fulfilled') {
    if (result.value === 'exported') exported++;
    else if (result.value === 'updated') updated++;
    else if (result.value === 'skipped') skipped++;
  } else {
    errors.push({
      skillName: skills[index].name,
      error: result.reason.message,
    });
  }
});
```

### 8. 安全考虑

#### 8.1 路径验证

```typescript
/**
 * 验证并规范化项目路径
 */
function validateProjectPath(projectPath: string): string {
  // 规范化路径
  const normalizedPath = path.normalize(projectPath);
  
  // 检查路径是否存在
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`项目路径不存在: ${normalizedPath}`);
  }
  
  // 检查是否为目录
  const stat = fs.statSync(normalizedPath);
  if (!stat.isDirectory()) {
    throw new Error(`项目路径不是目录: ${normalizedPath}`);
  }
  
  // 检查路径注入攻击（可选）
  if (normalizedPath.includes('..')) {
    throw new Error(`项目路径包含非法字符: ${normalizedPath}`);
  }
  
  return normalizedPath;
}
```

#### 8.2 文件权限

```typescript
/**
 * 确保 .claude/skills 目录有正确的权限
 */
async function ensureSkillsDirectory(skillsDirectory: string): Promise<void> {
  await fs.mkdir(skillsDirectory, { recursive: true, mode: 0o755 });
}
```

## 实现计划

### 阶段一：核心功能（必须）

1. **创建 Skills 导出服务** (`src/services/skills-export.ts`)
   - `syncSkillsToProject()`
   - `generateSkillMarkdown()`
   - `needsReexport()`
   - `cleanupObsoleteSkills()`
   - `getSkillsExportPath()`

2. **扩展类型定义** (`src/types/skills.ts`)
   - `SkillExportOptions`
   - `SkillSyncResult`
   - `SkillExportStatus`
   - `SkillFrontMatter`

3. **修改评估路由** (`src/app/api/evaluations/[id]/chat/route.ts`)
   - 集成 Skills 导出逻辑
   - 错误处理和日志

4. **单元测试**
   - 导出服务测试
   - Markdown 生成测试
   - 版本判断测试

### 阶段二：API 端点（推荐）

1. **手动导出 API** (`src/app/api/skills/export-to-project/route.ts`)
   - POST 端点实现
   - 权限验证
   - 参数验证

2. **导出状态查询 API** (`src/app/api/skills/export-status/route.ts`)
   - GET 端点实现
   - 状态返回

### 阶段三：优化和监控（可选）

1. **性能优化**
   - 缓存机制
   - 批量写入
   - 增量同步

2. **监控和日志**
   - 详细的日志记录
   - 导出统计
   - 错误追踪

3. **管理界面**（如果有前端）
   - 导出状态查看
   - 手动触发导出
   - 导出历史记录

## 测试计划

### 单元测试

1. **Markdown 生成测试**
   - 测试 YAML front matter 生成
   - 测试 Markdown 内容组合
   - 测试特殊字符转义

2. **版本判断测试**
   - 测试版本号对比
   - 测试时间戳对比
   - 测试文件不存在的情况

3. **同步逻辑测试**
   - 测试新导出
   - 测试更新导出
   - 测试跳过导出
   - 测试清理过期 Skills

### 集成测试

1. **评估流程集成测试**
   - 测试评估启动时自动导出
   - 测试导出失败不阻塞评估
   - 测试项目路径不存在的情况

2. **API 端点测试**
   - 测试手动导出 API
   - 测试状态查询 API
   - 测试权限验证

### 性能测试

1. **大量 Skills 导出测试**
   - 测试 100+ Skills 的导出性能
   - 测试并发导出的性能

2. **缓存效果测试**
   - 测试缓存命中情况
   - 测试缓存过期逻辑

## 风险和缓解措施

### 风险 1：项目路径不存在

**影响**: 导出失败，评估可能中断  
**缓解措施**:
- 验证项目路径存在性
- 导出失败不阻塞评估流程
- 记录详细错误日志

### 风险 2：权限不足

**影响**: 无法创建目录或写入文件  
**缓解措施**:
- 检查文件系统权限
- 提供清晰的错误提示
- 建议用户检查权限设置

### 风险 3：并发导出冲突

**影响**: 多个评估同时导出可能导致文件冲突  
**缓解措施**:
- 使用文件锁机制
- 实现幂等的导出操作
- 使用缓存减少重复导出

### 风险 4：Skills 数量过多

**影响**: 导出性能下降，占用磁盘空间  
**缓解措施**:
- 实现增量同步
- 使用并发导出
- 定期清理过期 Skills

## 未来扩展

### 1. 双向同步

支持从 `.claude/skills/` 目录导入 Skills 到数据库：
- 用于 Skills 的迁移和备份
- 支持用户手动编辑 SKILL.md 文件
- 提供冲突解决机制

### 2. Skills 模板

支持从模板创建 Skills：
- 提供预定义的 Skills 模板
- 用户可以基于模板快速创建 Skills
- 支持社区分享 Skills 模板

### 3. Skills 市场

建立 Skills 共享平台：
- 用户可以发布和分享 Skills
- 支持 Skills 的评分和评论
- 提供 Skills 的搜索和推荐

### 4. Skills 统计

增强 Skills 使用统计：
- 跟踪 Skills 的使用频率
- 分析 Skills 的有效性
- 提供 Skills 优化建议

## 参考资料

1. [Claude Skills 官方文档](https://docs.anthropic.com/claude/docs/skills)
2. [SecHPS 测试平台架构文档](../../../README.md)
3. [Prisma Schema 文档](../../../prisma/schema.prisma)
4. [Skills 服务实现](../../../src/services/skills.ts)

## 附录

### A. YAML Front Matter 示例

```yaml
---
name: sql-injection
description: 检测代码中的 SQL 注入漏洞
allowed-tools:
  - Read
  - Grep
  - Bash(grep *)
version: 3
exportedAt: 2026-04-06T10:00:00Z
paths:
  - "**/*.java"
  - "**/*.py"
agent: security-scanner
model: claude-opus-4-20250514
effort: high
shell: bash
---
```

### B. 完整的 SKILL.md 示例

```markdown
---
name: sql-injection
description: 检测代码中的 SQL 注入漏洞，包括直接拼接、不安全的动态查询等常见模式
allowed-tools:
  - Read
  - Grep
  - Bash(grep *)
version: 3
exportedAt: 2026-04-06T10:00:00Z
paths:
  - "**/*.java"
  - "**/*.py"
  - "**/*.php"
  - "**/*.js"
---

# SQL 注入检测专家

你是一个专业的 SQL 注入检测专家。请全面检查代码中的 SQL 注入漏洞。

## 检测范围

### 1. 用户输入识别
- HTTP 请求参数（GET、POST、Cookie、Headers）
- 文件上传内容
- 数据库查询结果（二次注入）
- 外部 API 响应

### 2. SQL 查询构建方式
- 字符串直接拼接
- 格式化字符串（String.format、f-string）
- 动态表名/列名
- ORDER BY、LIMIT 等子句注入

### 3. 数据访问层检查
- 原生 SQL 查询
- ORM 框架使用（Hibernate、MyBatis、Entity Framework、Django ORM）
- 存储过程调用
- NoSQL 注入（MongoDB、Redis）

### 4. 防御机制验证
- 参数化查询
- 白名单验证
- 输入过滤和转义
- 最小权限原则

## 输出格式

对每个发现的潜在漏洞，请按以下格式输出：

### 漏洞 #[序号]

**文件**: [文件路径]  
**行号**: [起始行-结束行]  
**类型**: [直接拼接/动态查询/ORM注入/存储过程注入]  
**严重程度**: [Critical/High/Medium/Low]  
**代码片段**:
```
[漏洞代码片段]
```

**分析**:
[详细分析为什么这段代码存在 SQL 注入风险]

**修复建议**:
[具体的修复代码示例]

**参考**:
- CWE-89: SQL Injection
- OWASP Top 10: A03:2021 – Injection

## 检测策略

1. **静态分析**: 搜索常见的 SQL 注入模式
2. **数据流追踪**: 跟踪用户输入到 SQL 查询的数据流
3. **上下文分析**: 分析 SQL 查询的上下文环境
4. **框架识别**: 识别使用的数据库访问框架并针对性检测

## 注意事项

- 区分真正的漏洞和安全的动态查询
- 考虑框架的自动转义机制
- 关注二次注入的可能性
- 检查配置文件中的连接字符串是否安全
```

### C. API 使用示例

```typescript
// 手动导出 Skills
const response = await fetch('/api/skills/export-to-project', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    projectId: 'proj_abc123',
    options: {
      overwrite: true,
      cleanup: true,
    },
  }),
});

const result = await response.json();
console.log('导出结果:', result);

// 查询导出状态
const statusResponse = await fetch('/api/skills/export-status?projectId=proj_abc123', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});

const status = await statusResponse.json();
console.log('导出状态:', status);
```

---

**文档版本历史**:
- v1.0 (2026-04-06): 初始设计文档
