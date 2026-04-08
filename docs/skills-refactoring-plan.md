# Skills 改造方案 - � Claude 官方标准集成

## 📋 概述

本文档说明如何将现有的 Skills 系统改造为符合 Claude 官方标准，实现"启动评估时自动导出 Skills 到项目目录"的功能。

## 🎯 核心设计理念

### 当前问题
- Skills 存储在数据库中，需要通过提示词传递给 Claude
- 无法利用 Claude 的自动发现机制
- 项目无法覆盖或自定义 Skills

### 改造方案
- **数据库扩展**：添加 Claude 官方标准字段
- **文件导出**：启动评估时将 Skills 导出到 `.claude/skills/` 目录
- **自动发现**：Claude 自动加载和使用项目中的 Skills
- **双向兼容**：支持从数据库和文件系统导入/导出

## 📊 数据库 Schema 变更

### 新增字段

```prisma
model Skill {
  // ... 现有字段 ...
  
  // ========== Claude 官方标准字段 ==========
  disableModelInvocation Boolean  @default(false)  // 阻止 Claude 自动调用
  userInvocable        Boolean  @default(true)       // 是否显示在 `/` 菜单
  context              String?                        // 'inline' | 'fork'
  agent               String?                        // 子代理类型
  argumentHint        String?                        // 参数提示
  model               String?                        // 指定模型
  effort              String?                        // 'low' | 'medium' | 'high' | 'max'
  paths              String?                        // JSON: Glob 模式数组
  shell              String?                        // 'bash' | 'powershell'
  hooks              String?                        // JSON: Hooks 配置
}
```

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|--------|------|----------|------|
| `disableModelInvocation` | Boolean | false | 阻止 Claude 自动调用此 Skill |
| `userInvocable` | Boolean | true | 是否在 `/` 菜单中显示此 Skill |
| `context` | String | null | 执行上下文：`inline` 或 `fork` |
| `agent` | String | null | 子代理类型（如 `Explore`、`Plan`） |
| `argumentHint` | String | null | 参数提示，如 `[filename] [format]` |
| `model` | String | null | 指定使用的模型 |
| `effort` | String | null | 努力级别：`low`、`medium`、`high`、`max` |
| `paths` | String | null | Glob 模式数组，限制 Skill 激活时机 |
| `shell` | String | null | Shell 类型：`bash` 或 `powershell` |
| `hooks` | String | null | Hooks 配置（JSON 格式） |

## 🔧 代码实现

### 1. TypeScript 类型扩展

**文件**：`src/services/skills.ts`

```typescript
export interface LoadedSkill {
  // ... 现有字段 ...
  
  // Claude 官方标准字段
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  context?: 'inline' | 'fork';
  agent?: string;
  argumentHint?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  paths?: string[];
  shell?: 'bash' | 'powershell';
  hooks?: Record<string, unknown>;
}
```

### 2. Skills 导出功能

#### 2.1 生成 SKILL.md 文件

```typescript
/**
 * 生成符合 Claude 官方格式的 SKILL.md 内容
 */
function generateSkillMarkdown(skill: LoadedSkill): string {
  let markdown = '---\n';
  
  // 必需字段
  markdown += `name: ${skill.name}\n`;
  markdown += `description: ${skill.description}\n`;
  
  // 可选字段
  if (skill.disableModelInvocation) {
    markdown += `disable-model-invocation: true\n`;
  }
  
  if (skill.userInvocable === false) {
    markdown += `user-invocable: false\n`;
  }
  
  if (skill.tools && skill.tools.length > 0) {
    const toolNames = skill.tools.map(t => t.name).join(' ');
    markdown += `allowed-tools: ${toolNames}\n`;
  }
  
  if (skill.context) {
    markdown += `context: ${skill.context}\n`;
  }
  
  if (skill.agent) {
    markdown += `agent: ${skill.agent}\n`;
  }
  
  if (skill.argumentHint) {
    markdown += `argument-hint: ${skill.argumentHint}\n`;
  }
  
  if (skill.model) {
    markdown += `model: ${skill.model}\n`;
  }
  
  if (skill.effort) {
    markdown += `effort: ${skill.effort}\n`;
  }
  
  if (skill.paths && skill.paths.length > 0) {
    markdown += `paths: ${skill.paths.join(', ')}\n`;
  }
  
  if (skill.shell) {
    markdown += `shell: ${skill.shell}\n`;
  }
  
  if (skill.hooks) {
    const hooksJson = typeof skill.hooks === 'string' 
      ? skill.hooks 
      : JSON.stringify(skill.hooks, null, 2);
    markdown += `hooks: ${hooksJson}\n`;
  }
  
  // 结束 frontmatter
  markdown += '---\n\n';
  
  // 添加内容
  markdown += skill.systemPrompt;
  
  // 如果有用户提示词，添加到末尾
  if (skill.userPrompt && skill.userPrompt !== skill.systemPrompt) {
    markdown += '\n\n---\n\n';
    markdown += '## 用户提示词\n\n';
    markdown += skill.userPrompt;
  }
  
  return markdown;
}
```

#### 2.2 批量导出 Skills

```typescript
/**
 * 批量导出 Skills 到项目目录
 */
export async function exportSkillsToProject(
  skills: LoadedSkill[],
  projectPath: string
): Promise<{ success: string[]; failed: Array<{ name: string; error: string }> }> {
  const skillsDir = path.join(projectPath, '.claude', 'skills');
  const result = {
    success: [] as string[],
    failed: [] as Array<{ name: string; error: string }>,
  };
  
  // 确保 .claude/skills 目录存在
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
  
  // 导出每个 Skill
  for (const skill of skills) {
    try {
      const skillFile = exportSkillToFile(skill, skillsDir);
      result.success.push(skillFile);
      console.log(`[Skills] 导出成功: ${skill.name} -> ${skillFile}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      result.failed.push({ name: skill.name, error: errorMsg });
      console.error(`[Skills] 导出失败: ${skill.name}`, error);
    }
  }
  
  return result;
}

/**
 * 清理项目中的 Skills 目录
 */
export function cleanupProjectSkills(projectPath: string): void {
  const skillsDir = path.join(projectPath, '.claude', 'skills');
  
  if (fs.existsSync(skillsDir)) {
    // 删除整个目录
    fs.rmSync(skillsDir, { recursive: true, force: true });
    console.log(`[Skills] 清理目录: ${skillsDir}`);
  }
}
```

### 3. 评估启动集成

#### 3.1 更新启动评估 API

**文件**：`src/app/api/projects/[id]/start/route.ts`

```typescript
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id:: string }> }
) {
  // ... 现有代码 ...
  
  // 同步 Skills 到项目目录
  if (project.projectPath) {
    try {
      console.log('[启动评估] 开始同步 Skills 到项目目录');
      
      // 加载激活的 Skills
      const skills = await loadActiveSkills();
      console.log(`[启动评估] 加载了 ${skills.length} 个激活的 Skills`);
      
      // 清理旧的 Skills
      cleanupProjectSkills(project.projectPath);
      
      // 导出新的 Skills
      const exportResult = await exportSkillsToProject(skills, project.projectPath);
      
      console.log(`[启动评估] Skills 同步完成:`);
      console.log(`  - 成功: ${exportResult.success.length}`);
      console.log(`  - 失败: ${exportResult.failed.length}`);
      
      if (exportResult.failed.length > 0) {
        exportResult.failed.forEach(f => {
          console.error(`    - ${f.name}: ${f.error}`);
        });
      }
    } catch (error) {
      console.error('[启动评估] Skills 同步失败:', error);
      // 继续执行，不阻止评估启动
    }
  }
  
  // ... 继续评估 ...
}
```

#### 3.2 更新系统提示词

**文件**：`src/services/evaluation/prompt.ts`

```typescript
export class PromptBuilder {
  buildSystemPrompt(context?: PromptContext): string {
    let systemPrompt = `你是一个专业的代码评估专家。你的任务是对项目进行全面评估，包括：

1. 分析项目结构和代码质量
2. 识别潜在的安全漏洞
3. 评估代码的可维护性和可扩展性
4. 提供改进建议
5. 给项目整体评分（1-10 分）

请使用专业的语气，提供具体、可操作的建议。如果用户有后续问题，请基于之前的评估内容进行回答。`;

    // 如果有项目路径，提示 Claude 会自动发现 Skills
    if (context?.projectPath) {
      systemPrompt += '\n\n';
      systemPrompt += `项目路径: ${context.projectPath}\n`;
      systemPrompt += '\n';
      systemPrompt += `注意：该项目目录下可能包含自定义 Skills（.claude/skills/），`;
      systemPrompt += `请根据评估需求自动加载和使用这些 Skills。`;
      systemPrompt += `你可以在评估过程中根据需要调用特定的 Skill，例如：`;
      systemPrompt += `- /sql-injection - 检测 SQL 注入漏洞`;
      systemPrompt += `- /xss-detection - 检测 XSS 漏洞`;
      systemPrompt += `- /auth-bypass - 检测认证绕过漏洞`;
      systemPrompt += `- /hardcoded-secrets - 检测硬编码密钥`;
      systemPrompt += `\n`;
      systemPrompt += `Skills 会根据其 description 字段自动匹配你的评估需求。`;
    }

    return systemPrompt;
  }
}
```

### 4. 新增 API 端点

**文件**：`src/app/api/sync/skills/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { loadActiveSkills, exportSkillsToProject, cleanupProjectSkills } from '@/services/skills';

interface SyncRequest {
  projectId: string;
}

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

    const body: SyncRequest = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json({ error: '缺少项目 ID' }, { status: 400 });
    }

    // 获取项目
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    if (!project.projectPath) {
      return NextResponse.json({ error: '项目路径未配置' }, { status: 400 });
    }

    // 加载激活的 Skills
    const skills = await loadActiveSkills();

    // 清理旧的 Skills
    cleanupProjectSkills(project.projectPath);

    // 导出新的 Skills
    const result = await exportSkillsToProject(skills, project.projectPath);

    return NextResponse.json({
      message: 'Skills 同步成功',
      total: skills.length,
      success: result.success.length,
      failed: result.failed.length,
      details: result,
    });
  } catch (error) {
    console.error('[SyncSkills] 同步失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
```

## 📁 生成的文件结构

```
project-root/
├── .claude/
│   └── skills/
│       ├── sql-injection/
│       │   └── SKILL.md
│       ├── xss-detection/
│       │   └── SKILL.md
│       ├── auth-bypass/
│       │   └── SKILL.md
│       ├── hardcoded-secrets/
│       │   └── SKILL.md
│       └── ...
└── src/
    └── ...
```

## 📄 SKILL.md 示例

### 示例 1：SQL 注入检测

```yaml
---
name: sql-injection
description: 检测代码中的 SQL 注入漏洞，包括字符串拼接、不安全的参数传递等
allowed-tools: Read Grep Bash(grep *)
---

你是一个专业的安全代码审计专家，专注于检测 SQL 注入漏洞。

你的任务是分析代码中的 SQL 注入风险，包括但不限于：
1. 字符串串接构建 SQL 语句
2. 用户输入直接拼接到 SQL 中
3. 使用不安全的数据库操作方法
4. 动态表名、列名构造

请仔细分析每一段代码，找出潜在的 SQL 注入点，并提供修复建议。
```

### 示例 2：认证绕过检测（禁止自动调用）

```yaml
---
name: auth-bypass
description: 检测身份认证和授权绕过漏洞
disable-model-invocation: true
---

检测身份认证和授权绕过漏洞，包括：
1. 认证逻辑缺陷
2. 会话管理漏洞
3. 权限检查缺失
4. 越权访问风险

注意：此 Skill 需要手动调用，不会自动激活。
```

### 示例 3：代码审计（使用子代理）

```yaml
---
name: deep-code-audit
description: 深度代码审计，使用 Explore 子代理进行全面的代码分析
context: fork
agent: Explore
---

对项目进行深度代码审计，包括：
1. 分析代码结构和模式
2. 识别潜在的安全问题
3. 评估代码质量
4. 提供改进建议

使用 Explore 代理进行只读分析。
```

## 🚀 迁移步骤

### 阶段 1：数据库迁移

```bash
# 1. 创建迁移文件
npx prisma migrate dev --name add_claude_official_skill_fields

# 2. 更新数据库
npx prisma migrate deploy

# 3. 重新生成 Prisma 客户端
npx prisma generate
```

### 阶段 2：实现新功能

1. ✅ 更新 `src/services/skills.ts`
   - 添加导出功能
   - 添加导入功能
   - 添加清理功能

2. ✅ 创建 `src/app/api/sync/skills/route.ts`
   - 手动同步 Skills API

3. ✅ 更新 `src/app/api/projects/[id]/start/route.ts`
   - 集成 Skills 同步

4. ✅ 更新 `src/services/evaluation/prompt.ts`
   - 提示 Claude 自动发现 Skills

### 阶段 3：测试验证

```bash
# 1. 启动开发服务器
npm run dev

# 2. 创建测试项目
# 3. 启动评估，观察 Skills 是否正确导出
# 4. 检查 .claude/skills/ 目录结构
```

## ✨ 优势

### 1. 符合官方标准
- ✅ 完全遵循 Claude Skills 的文件系统约定
- ✅ 支持所有官方功能（frontmatter、变量替换等）
- ✅ 与 Claude Code 兼容

### 2. 自动发现
- ✅ Claude 自动加载 `.claude/skills/` 目录
- ✅ 根据描述自动选择合适的 Skills
- ✅ 无需手动在提示词中列出 Skills

### 3. 灵活覆盖
- ✅ 项目可以有自己的 Skills，覆盖数据库中的
- ✅ 支持本地编辑和测试
- ✅ Git 可以追踪 Skills 变更

### 4. 简化代码
- ✅ 不需要复杂的提示词构建逻辑
- ✅ Skills 信息通过文件系统传递
- ✅ 减少提示词长度，节省 token

### 5. 企业级管理
- ✅ 保留数据库存储和版本控制
- ✅ 支持公共和私有 Skills
- ✅ 记录执行历史和性能指标
- ✅ 支持基于反馈的进化

## 🔧 使用示例

### 前端：启动评估（自动同步 Skills）

```typescript
const response = await fetch(`/api/projects/${projectId}/start`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
});

// Skills 会自动同步到项目目录
// Claude 会自动发现并使用这些 Skills
```

### 前端：手动同步 Skills

```typescript
const response = await fetch('/api/sync/skills', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    projectId: 'project-id',
  }),
});

const { message, total, success, failed } = await response.json();

console.log(`同步完成: ${success}/${total} 成功`);
```

### 项目：本地编辑 Skills

```bash
# 1. 进入项目目录
cd /path/to/project

# 2. 编辑 Skill
vim .claude/skills/sql-injection/SKILL.md

# 3. 重新启动评估
# Claude 会使用更新后的 Skill
```

## 📊 API 端点

### POST /api/sync/skills

手动同步 Skills 到项目目录。

**请求体**：
```json
{
  "projectId": "string"
}
```

**响应**：
```json
{
  "message": "Skills 同步成功",
  "total": 10,
  "success": 10,
  "failed": 0,
  "details": {
    "success": ["/path/to/.claude/skills/sql-injection/SKILL.md"],
    "failed": []
  }
}
```

## ⚠️ 注意事项

### 1. 文件系统权限
- 确保服务器有权限写入项目目录
- Windows 路径使用 `\\` 或 `path.join()`
- 处理路径中的特殊字符

### 2. 错误处理
- Skills 导出失败不应阻止评估启动
- 记录详细的错误日志
- 提供失败详情给用户

### 3. 性能优化
- 批量导出时使用异步操作
- 避免重复的文件系统操作
- 缓存已导出的 Skills

### 4. 版本控制
- 数据库中的 Skills 保留版本历史
- 文件系统中的 Skills 可以被 Git 追踪
- 支持回滚到历史版本

## 🎯 总结

这个改造方案实现了：

1. ✅ **数据库扩展**：添加 Claude 官方标准字段
2. ✅ **文件导出**：启动评估时自动导出 Skills
3. ✅ **自动发现**：Claude 自动加载和使用 Skills
4. ✅ **双向兼容**：支持数据库和文件系统
5. ✅ **手动同步**：提供手动同步 API
6. ✅ **灵活覆盖**：项目可以自定义 Skills

这种设计既保持了 Claude Skills 的灵活性，又增加了企业级的管理能力，非常适合在评估系统中使用。
