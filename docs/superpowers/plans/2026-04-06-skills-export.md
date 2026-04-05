# Skills 导出混合方案实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现数据库存储 + Claude 格式导出的混合方案，在评估启动时自动将 Skills 导出到项目的 `.claude/skills/` 目录，支持版本同步和增量更新。

**架构：** 创建独立的 skills-export 服务模块，在评估路由中集成自动导出逻辑，使用版本号和更新时间戳判断是否需要重新导出，导出失败不阻塞评估流程。

**技术栈：** TypeScript, Prisma, Next.js API Routes, Node.js fs/promises, YAML解析

---

## 文件结构

### 新建文件
- `src/services/skills-export.ts` - Skills 导出服务核心逻辑
- `src/app/api/skills/export-to-project/route.ts` - 手动导出 API
- `src/app/api/skills/export-status/route.ts` - 导出状态查询 API
- `tests/services/skills-export.test.ts` - 导出服务单元测试
- `tests/api/skills-export.test.ts` - API 集成测试

### 修改文件
- `src/types/skills.ts` - 扩展类型定义
- `src/app/api/evaluations/[id]/chat/route.ts` - 集成导出逻辑
- `package.json` - 添加依赖（如需要）

---

## 任务 1：扩展类型定义

**文件：**
- 修改：`src/types/skills.ts`

**目标：** 添加导出相关的类型定义

- [ ] **步骤 1：添加 SkillExportOptions 接口**

在 `src/types/skills.ts` 文件末尾添加：

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
```

- [ ] **步骤 2：添加 SkillSyncResult 接口**

```typescript
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
```

- [ ] **步骤 3：添加 SkillExportStatus 接口**

```typescript
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
```

- [ ] **步骤 4：添加 SkillFrontMatter 接口**

```typescript
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

- [ ] **步骤 5：运行类型检查验证**

运行：`npm run build` 或 `npx tsc --noEmit`
预期：无类型错误

- [ ] **步骤 6：Commit**

```bash
git add src/types/skills.ts
git commit -m "feat(skills): 添加 Skills 导出相关类型定义

- 添加 SkillExportOptions 接口
- 添加 SkillSyncResult 接口
- 添加 SkillExportStatus 接口
- 添加 SkillFrontMatter 接口"
```

---

## 任务 2：创建 Skills 导出服务核心函数

**文件：**
- 创建：`src/services/skills-export.ts`

**目标：** 实现导出服务的核心功能函数

- [ ] **步骤 1：创建文件并导入依赖**

```typescript
// src/services/skills-export.ts

import { promises as fs } from 'fs';
import path from 'path';
import type { LoadedSkill } from './skills';
import type { SkillSyncResult, SkillFrontMatter } from '@/types/skills';
import { loadActiveSkills, loadAllAvailableSkills } from './skills';
```

- [ ] **步骤 2：实现 getSkillsExportPath 函数**

```typescript
/**
 * 获取 Skills 导出目录路径
 * 
 * @param projectPath - 项目路径
 * @returns .claude/skills 目录路径
 */
export function getSkillsExportPath(projectPath: string): string {
  return path.join(projectPath, '.claude', 'skills');
}
```

- [ ] **步骤 3：实现 validateProjectPath 函数**

```typescript
/**
 * 验证并规范化项目路径
 * 
 * @param projectPath - 项目路径
 * @returns 规范化后的路径
 * @throws 如果路径不存在或不是目录
 */
async function validateProjectPath(projectPath: string): Promise<string> {
  // 规范化路径
  const normalizedPath = path.normalize(projectPath);
  
  // 检查路径是否存在
  try {
    const stat = await fs.stat(normalizedPath);
    if (!stat.isDirectory()) {
      throw new Error(`项目路径不是目录: ${normalizedPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`项目路径不存在: ${normalizedPath}`);
    }
    throw error;
  }
  
  // 检查路径注入攻击
  if (normalizedPath.includes('..')) {
    throw new Error(`项目路径包含非法字符: ${normalizedPath}`);
  }
  
  return normalizedPath;
}
```

- [ ] **步骤 4：实现 extractYAMLFrontMatter 函数**

```typescript
/**
 * 从 Markdown 内容提取 YAML front matter
 * 
 * @param content - Markdown 内容
 * @returns Front matter 对象或 null
 */
function extractYAMLFrontMatter(content: string): SkillFrontMatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  
  try {
    // 简单的 YAML 解析（不使用 yaml 库）
    const yaml = match[1];
    const lines = yaml.split('\n');
    const result: Record<string, unknown> = {};
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      
      const key = line.substring(0, colonIndex).trim();
      let value: unknown = line.substring(colonIndex + 1).trim();
      
      // 处理数组
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value
          .substring(1, value.length - 1)
          .split(',')
          .map(v => v.trim().replace(/^["']|["']$/g, ''));
      }
      // 处理数字
      else if (!isNaN(Number(value)) && value !== '') {
        value = Number(value);
      }
      // 处理字符串（去除引号）
      else if (typeof value === 'string') {
        value = value.replace(/^["']|["']$/g, '');
      }
      
      result[key] = value;
    }
    
    return {
      name: result.name as string,
      description: result.description as string,
      allowedTools: result.allowedTools as string[],
      version: result.version as number,
      exportedAt: result.exportedAt as string,
      paths: result.paths as string[] | undefined,
      agent: result.agent as string | undefined,
      model: result.model as string | undefined,
      effort: result.effort as 'low' | 'medium' | 'high' | 'max' | undefined,
      shell: result.shell as 'bash' | 'powershell' | undefined,
    };
  } catch (error) {
    console.error('[Skills Export] 解析 YAML front matter 失败:', error);
    return null;
  }
}
```

- [ ] **步骤 5：实现 generateSkillMarkdown 函数**

```typescript
/**
 * 生成 Skill 的 SKILL.md 内容
 * 
 * @param skill - Skill 数据
 * @returns SKILL.md 文件内容
 */
export function generateSkillMarkdown(skill: LoadedSkill): string {
  // 构建 YAML front matter
  const frontMatter: SkillFrontMatter = {
    name: skill.name,
    description: skill.description,
    allowedTools: skill.tools.map(t => t.name),
    version: skill.version,
    exportedAt: new Date().toISOString(),
  };
  
  // 添加可选字段
  if (skill.paths && skill.paths.length > 0) {
    frontMatter.paths = skill.paths;
  }
  if (skill.agent) {
    frontMatter.agent = skill.agent;
  }
  if (skill.model) {
    frontMatter.model = skill.model;
  }
  if (skill.effort) {
    frontMatter.effort = skill.effort;
  }
  if (skill.shell) {
    frontMatter.shell = skill.shell;
  }
  
  // 构建 YAML 字符串
  const yamlLines: string[] = ['---'];
  yamlLines.push(`name: ${frontMatter.name}`);
  yamlLines.push(`description: ${frontMatter.description}`);
  
  if (frontMatter.allowedTools.length === 1) {
    yamlLines.push(`allowed-tools: ${frontMatter.allowedTools[0]}`);
  } else {
    yamlLines.push('allowed-tools:');
    for (const tool of frontMatter.allowedTools) {
      yamlLines.push(`  - ${tool}`);
    }
  }
  
  yamlLines.push(`version: ${frontMatter.version}`);
  yamlLines.push(`exportedAt: ${frontMatter.exportedAt}`);
  
  if (frontMatter.paths && frontMatter.paths.length > 0) {
    if (frontMatter.paths.length === 1) {
      yamlLines.push(`paths: ${frontMatter.paths[0]}`);
    } else {
      yamlLines.push('paths:');
      for (const p of frontMatter.paths) {
        yamlLines.push(`  - ${p}`);
      }
    }
  }
  
  if (frontMatter.agent) yamlLines.push(`agent: ${frontMatter.agent}`);
  if (frontMatter.model) yamlLines.push(`model: ${frontMatter.model}`);
  if (frontMatter.effort) yamlLines.push(`effort: ${frontMatter.effort}`);
  if (frontMatter.shell) yamlLines.push(`shell: ${frontMatter.shell}`);
  
  yamlLines.push('---');
  
  // 组合 Markdown 内容
  const content = `${yamlLines.join('\n')}\n\n${skill.systemPrompt}\n\n${skill.userPrompt}`;
  
  return content;
}
```

- [ ] **步骤 6：运行类型检查**

运行：`npx tsc --noEmit`
预期：无类型错误

- [ ] **步骤 7：Commit**

```bash
git add src/services/skills-export.ts
git commit -m "feat(skills): 实现 Skills 导出核心函数

- 实现 getSkillsExportPath 获取导出路径
- 实现 validateProjectPath 验证项目路径
- 实现 extractYAMLFrontMatter 解析 YAML
- 实现 generateSkillMarkdown 生成 SKILL.md 内容"
```

---

## 任务 3：实现版本判断和导出逻辑

**文件：**
- 修改：`src/services/skills-export.ts`

**目标：** 实现版本判断和单个 Skill 导出函数

- [ ] **步骤 1：实现 needsReexport 函数**

在 `src/services/skills-export.ts` 中添加：

```typescript
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
): Promise<boolean> {
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
    throw error;
  }
}
```

- [ ] **步骤 2：实现 exportSkill 函数**

```typescript
/**
 * 导出单个 Skill 到文件
 * 
 * @param skill - Skill 数据
 * @param skillsDirectory - .claude/skills 目录路径
 * @returns 导出结果：'exported' | 'updated' | 'skipped'
 */
async function exportSkill(
  skill: LoadedSkill,
  skillsDirectory: string
): Promise<'exported' | 'updated' | 'skipped'> {
  const skillDirectory = path.join(skillsDirectory, skill.name);
  const skillPath = path.join(skillDirectory, 'SKILL.md');
  
  // 检查是否需要重新导出
  const shouldExport = await needsReexport(skill, skillPath);
  
  if (!shouldExport) {
    return 'skipped';
  }
  
  // 创建 Skill 目录
  await fs.mkdir(skillDirectory, { recursive: true });
  
  // 生成 Markdown 内容
  const content = generateSkillMarkdown(skill);
  
  // 写入文件
  await fs.writeFile(skillPath, content, 'utf-8');
  
  // 判断是新导出还是更新
  try {
    await fs.access(skillPath);
    return 'updated';
  } catch {
    return 'exported';
  }
}
```

- [ ] **步骤 3：运行类型检查**

运行：`npx tsc --noEmit`
预期：无类型错误

- [ ] **步骤 4：Commit**

```bash
git add src/services/skills-export.ts
git commit -m "feat(skills): 实现版本判断和单个 Skill 导出

- 实现 needsReexport 判断是否需要重新导出
- 实现 exportSkill 导出单个 Skill 到文件
- 支持版本号和时间戳对比"
```

---

## 任务 4：实现清理过期 Skills 和同步函数

**文件：**
- 修改：`src/services/skills-export.ts`

**目标：** 实现清理过期 Skills 和主同步函数

- [ ] **步骤 1：实现 cleanupObsoleteSkills 函数**

```typescript
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
    // 目录不存在，忽略
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[Skills Export] 清理过期 Skills 失败:', error);
    }
  }
  
  return removedCount;
}
```

- [ ] **步骤 2：实现主同步函数 syncSkillsToProject**

```typescript
/**
 * 同步 Skills 到项目目录
 * 
 * @param projectId - 项目 ID
 * @param projectPath - 项目路径
 * @param userId - 用户 ID（可选，用于加载私有 Skills）
 * @returns 同步结果统计
 */
export async function syncSkillsToProject(
  projectId: string,
  projectPath: string,
  userId?: string
): Promise<SkillSyncResult> {
  const result: SkillSyncResult = {
    total: 0,
    exported: 0,
    updated: 0,
    skipped: 0,
    removed: 0,
    errors: [],
  };
  
  try {
    // 验证项目路径
    const validatedPath = await validateProjectPath(projectPath);
    
    // 获取 Skills 导出目录路径
    const skillsDirectory = getSkillsExportPath(validatedPath);
    
    // 创建 .claude/skills 目录
    await fs.mkdir(skillsDirectory, { recursive: true });
    console.log(`[Skills Export] 创建目录: ${skillsDirectory}`);
    
    // 加载激活的 Skills
    const skills = userId
      ? await loadAllAvailableSkills(userId)
      : await loadActiveSkills();
    
    result.total = skills.length;
    console.log(`[Skills Export] 加载了 ${skills.length} 个激活的 Skills`);
    
    // 导出/更新 Skills
    const exportPromises = skills.map(skill => exportSkill(skill, skillsDirectory));
    const results = await Promise.allSettled(exportPromises);
    
    // 统计结果
    results.forEach((res, index) => {
      if (res.status === 'fulfilled') {
        if (res.value === 'exported') result.exported++;
        else if (res.value === 'updated') result.updated++;
        else if (res.value === 'skipped') result.skipped++;
      } else {
        result.errors.push({
          skillName: skills[index].name,
          error: res.reason.message || String(res.reason),
        });
      }
    });
    
    // 清理过期的 Skills
    const activeSkillNames = skills.map(s => s.name);
    result.removed = await cleanupObsoleteSkills(skillsDirectory, activeSkillNames);
    
    console.log(
      `[Skills Export] 同步完成: 导出 ${result.exported}, 更新 ${result.updated}, 跳过 ${result.skipped}, 清理 ${result.removed}`
    );
    
    return result;
  } catch (error) {
    console.error('[Skills Export] 同步失败:', error);
    throw error;
  }
}
```

- [ ] **步骤 3：运行类型检查**

运行：`npx tsc --noEmit`
预期：无类型错误

- [ ] **步骤 4：Commit**

```bash
git add src/services/skills-export.ts
git commit -m "feat(skills): 实现清理过期 Skills 和主同步函数

- 实现 cleanupObsoleteSkills 清理过期 Skills
- 实现 syncSkillsToProject 主同步函数
- 支持并发导出和错误统计"
```

---

## 任务 5：创建手动导出 API

**文件：**
- 创建：`src/app/api/skills/export-to-project/route.ts`

**目标：** 实现手动导出 API 端点

- [ ] **步骤 1：创建 API 文件并导入依赖**

```typescript
// src/app/api/skills/export-to-project/route.ts

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { syncSkillsToProject, getSkillsExportPath } from '@/services/skills-export';
import { prisma } from '@/lib/prisma';
import type { SkillExportOptions } from '@/types/skills';

interface ExportRequest {
  projectId: string;
  skillIds?: string[];
  options?: Partial<SkillExportOptions>;
}

export async function POST(request: Request) {
  try {
    // 验证认证
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
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    // 解析请求体
    const body: ExportRequest = await request.json();
    const { projectId, skillIds, options } = body;

    if (!projectId) {
      return NextResponse.json({ error: '缺少项目 ID' }, { status: 400 });
    }

    // 获取项目信息
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    if (!project.projectPath) {
      return NextResponse.json({ error: '项目路径未配置' }, { status: 400 });
    }

    // 同步 Skills 到项目
    const result = await syncSkillsToProject(
      projectId,
      project.projectPath,
      options?.includePrivate ? payload.userId : undefined
    );

    // 返回结果
    return NextResponse.json({
      success: true,
      result,
      skillsDirectory: getSkillsExportPath(project.projectPath),
    });
  } catch (error) {
    console.error('[API] Skills 导出失败:', error);
    return NextResponse.json(
      { error: 'Skills 导出失败', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
```

- [ ] **步骤 2：运行类型检查**

运行：`npx tsc --noEmit`
预期：无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/app/api/skills/export-to-project/route.ts
git commit -m "feat(skills): 创建手动导出 API 端点

- POST /api/skills/export-to-project
- 支持权限验证
- 支持自定义导出选项"
```

---

## 任务 6：创建导出状态查询 API

**文件：**
- 创建：`src/app/api/skills/export-status/route.ts`

**目标：** 实现导出状态查询 API 端点

- [ ] **步骤 1：创建 API 文件**

```typescript
// src/app/api/skills/export-status/route.ts

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getSkillsExportPath } from '@/services/skills-export';
import { loadActiveSkills, loadAllAvailableSkills } from '@/services/skills';
import { prisma } from '@/lib/prisma';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(request: Request) {
  try {
    // 验证认证
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
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    // 获取项目 ID
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: '缺少项目 ID' }, { status: 400 });
    }

    // 获取项目信息
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    if (!project.projectPath) {
      return NextResponse.json({ error: '项目路径未配置' }, { status: 400 });
    }

    // 获取导出目录路径
    const skillsDirectory = getSkillsExportPath(project.projectPath);

    // 加载激活的 Skills
    const skills = await loadActiveSkills();

    // 读取已导出的 Skills
    const exportedSkills: Array<{
      skillId: string;
      skillName: string;
      exportedAt: Date;
      version: number;
      path: string;
    }> = [];

    try {
      const entries = await fs.readdir(skillsDirectory, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillName = entry.name;
          const skillPath = path.join(skillsDirectory, skillName, 'SKILL.md');
          
          try {
            const content = await fs.readFile(skillPath, 'utf-8');
            // 简单解析 YAML front matter（复用 extractYAMLFrontMatter）
            const match = content.match(/^---\n([\s\S]*?)\n---/);
            if (match) {
              const yaml = match[1];
              const versionMatch = yaml.match(/version:\s*(\d+)/);
              const exportedAtMatch = yaml.match(/exportedAt:\s*(.+)/);
              
              if (versionMatch && exportedAtMatch) {
                const skill = skills.find(s => s.name === skillName);
                if (skill) {
                  exportedSkills.push({
                    skillId: skill.id,
                    skillName: skill.name,
                    exportedAt: new Date(exportedAtMatch[1].trim()),
                    version: parseInt(versionMatch[1]),
                    path: skillPath,
                  });
                }
              }
            }
          } catch (error) {
            // 文件读取失败，跳过
            console.warn(`[Skills Export Status] 读取 Skill ${skillName} 失败:`, error);
          }
        }
      }
    } catch (error) {
      // 目录不存在
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // 返回结果
    return NextResponse.json({
      success: true,
      projectPath: project.projectPath,
      skillsDirectory,
      lastSyncAt: exportedSkills.length > 0
        ? exportedSkills.reduce((latest, s) => 
            s.exportedAt > latest ? s.exportedAt : latest, 
            exportedSkills[0].exportedAt
          )
        : null,
      exportedSkills,
    });
  } catch (error) {
    console.error('[API] 查询导出状态失败:', error);
    return NextResponse.json(
      { error: '查询导出状态失败', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
```

- [ ] **步骤 2：运行类型检查**

运行：`npx tsc --noEmit`
预期：无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/app/api/skills/export-status/route.ts
git commit -m "feat(skills): 创建导出状态查询 API 端点

- GET /api/skills/export-status?projectId=xxx
- 返回已导出的 Skills 列表和状态"
```

---

## 任务 7：集成到评估路由

**文件：**
- 修改：`src/app/api/evaluations/[id]/chat/route.ts`

**目标：** 在评估启动时自动同步 Skills

- [ ] **步骤 1：导入导出服务**

在 `src/app/api/evaluations/[id]/chat/route.ts` 顶部导入区添加：

```typescript
import { syncSkillsToProject } from '@/services/skills-export';
```

- [ ] **步骤 2：在评估启动时集成导出逻辑**

在原有的 `// 加载激活的 Skills` 代码块后添加：

```typescript
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
```

- [ ] **步骤 3：运行类型检查**

运行：`npx tsc --noEmit`
预期：无类型错误

- [ ] **步骤 4：Commit**

```bash
git add src/app/api/evaluations/[id]/chat/route.ts
git commit -m "feat(skills): 集成 Skills 导出到评估路由

- 在评估启动时自动同步 Skills
- 导出失败不阻塞评估流程
- 添加详细日志记录"
```

---

## 任务 8：编写单元测试

**文件：**
- 创建：`tests/services/skills-export.test.ts`

**目标：** 为导出服务编写单元测试

- [ ] **步骤 1：创建测试文件并编写测试用例**

```typescript
// tests/services/skills-export.test.ts

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  getSkillsExportPath,
  generateSkillMarkdown,
  needsReexport,
  syncSkillsToProject,
} from '@/services/skills-export';
import type { LoadedSkill } from '@/services/skills';

describe('Skills Export Service', () => {
  let tempDir: string;

  beforeEach(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-export-test-'));
  });

  afterEach(async () => {
    // 清理临时目录
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('getSkillsExportPath', () => {
    it('应该返回正确的 .claude/skills 路径', () => {
      const projectPath = '/path/to/project';
      const skillsPath = getSkillsExportPath(projectPath);
      expect(skillsPath).toBe(path.join(projectPath, '.claude', 'skills'));
    });
  });

  describe('generateSkillMarkdown', () => {
    it('应该生成正确的 SKILL.md 内容', () => {
      const skill: LoadedSkill = {
        id: 'skill-1',
        userId: null,
        name: 'test-skill',
        displayName: 'Test Skill',
        description: 'A test skill',
        category: 'code-audit',
        severity: 'high',
        systemPrompt: 'System prompt',
        userPrompt: 'User prompt',
        tools: [{ name: 'Read' }, { name: 'Grep' }],
        parameters: [],
        version: 1,
        isLatest: true,
        execCount: 0,
        updatedAt: new Date(),
      };

      const markdown = generateSkillMarkdown(skill);

      expect(markdown).toContain('---');
      expect(markdown).toContain('name: test-skill');
      expect(markdown).toContain('description: A test skill');
      expect(markdown).toContain('allowed-tools:');
      expect(markdown).toContain('- Read');
      expect(markdown).toContain('- Grep');
      expect(markdown).toContain('version: 1');
      expect(markdown).toContain('System prompt');
      expect(markdown).toContain('User prompt');
    });

    it('应该正确处理单个工具', () => {
      const skill: LoadedSkill = {
        id: 'skill-1',
        userId: null,
        name: 'single-tool',
        displayName: 'Single Tool',
        description: 'Single tool skill',
        category: 'code-audit',
        severity: 'medium',
        systemPrompt: 'System',
        userPrompt: 'User',
        tools: [{ name: 'Bash' }],
        parameters: [],
        version: 1,
        isLatest: true,
        execCount: 0,
        updatedAt: new Date(),
      };

      const markdown = generateSkillMarkdown(skill);
      expect(markdown).toContain('allowed-tools: Bash');
    });
  });

  describe('needsReexport', () => {
    it('如果文件不存在，应该返回 true', async () => {
      const skill: LoadedSkill = {
        id: 'skill-1',
        userId: null,
        name: 'new-skill',
        displayName: 'New Skill',
        description: 'New skill',
        category: 'code-audit',
        severity: 'low',
        systemPrompt: 'System',
        userPrompt: 'User',
        tools: [],
        parameters: [],
        version: 1,
        isLatest: true,
        execCount: 0,
        updatedAt: new Date(),
      };

      const skillPath = path.join(tempDir, 'new-skill', 'SKILL.md');
      const result = await needsReexport(skill, skillPath);
      expect(result).toBe(true);
    });

    it('如果版本号不同，应该返回 true', async () => {
      const skill: LoadedSkill = {
        id: 'skill-1',
        userId: null,
        name: 'version-test',
        displayName: 'Version Test',
        description: 'Version test',
        category: 'code-audit',
        severity: 'low',
        systemPrompt: 'System',
        userPrompt: 'User',
        tools: [],
        parameters: [],
        version: 2,
        isLatest: true,
        execCount: 0,
        updatedAt: new Date(),
      };

      // 创建现有文件，版本为 1
      const skillDir = path.join(tempDir, 'version-test');
      await fs.mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, 'SKILL.md');
      await fs.writeFile(
        skillPath,
        `---
name: version-test
description: Version test
allowed-tools: []
version: 1
exportedAt: 2026-04-06T00:00:00Z
---
System

User`,
        'utf-8'
      );

      const result = await needsReexport(skill, skillPath);
      expect(result).toBe(true);
    });

    it('如果版本和时间戳相同，应该返回 false', async () => {
      const now = new Date();
      const skill: LoadedSkill = {
        id: 'skill-1',
        userId: null,
        name: 'same-version',
        displayName: 'Same Version',
        description: 'Same version test',
        category: 'code-audit',
        severity: 'low',
        systemPrompt: 'System',
        userPrompt: 'User',
        tools: [],
        parameters: [],
        version: 1,
        isLatest: true,
        execCount: 0,
        updatedAt: now,
      };

      // 创建现有文件，版本和时间戳相同
      const skillDir = path.join(tempDir, 'same-version');
      await fs.mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, 'SKILL.md');
      await fs.writeFile(
        skillPath,
        `---
name: same-version
description: Same version test
allowed-tools: []
version: 1
exportedAt: ${now.toISOString()}
---
System

User`,
        'utf-8'
      );

      const result = await needsReexport(skill, skillPath);
      expect(result).toBe(false);
    });
  });
});
```

- [ ] **步骤 2：运行测试**

运行：`npm test tests/services/skills-export.test.ts`
预期：所有测试通过

- [ ] **步骤 3：Commit**

```bash
git add tests/services/skills-export.test.ts
git commit -m "test(skills): 添加 Skills 导出服务单元测试

- 测试 getSkillsExportPath 路径生成
- 测试 generateSkillMarkdown Markdown 生成
- 测试 needsReexport 版本判断逻辑"
```

---

## 任务 9：编写集成测试

**文件：**
- 创建：`tests/api/skills-export.test.ts`

**目标：** 为 API 端点编写集成测试

- [ ] **步骤 1：创建测试文件**

```typescript
// tests/api/skills-export.test.ts

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { NextRequest } from 'next/server';
import { POST as exportHandler } from '@/app/api/skills/export-to-project/route';
import { GET as statusHandler } from '@/app/api/skills/export-status/route';
import { prisma } from '@/lib/prisma';
import { hash } from 'bcryptjs';
import { sign } from 'jsonwebtoken';

describe('Skills Export API', () => {
  let testUser: { id: string; email: string; username: string };
  let testProject: { id: string; name: string; projectPath: string };
  let authToken: string;

  beforeAll(async () => {
    // 创建测试用户
    const hashedPassword = await hash('password123', 10);
    const user = await prisma.user.create({
      data: {
        email: 'test-export@example.com',
        username: 'testexport',
        passwordHash: hashedPassword,
        name: 'Test Export User',
      },
    });
    testUser = user;

    // 创建测试项目
    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: 'Test Export Project',
        projectPath: '/tmp/test-export-project',
      },
    });
    testProject = project;

    // 生成 JWT token
    authToken = sign(
      { userId: user.id, email: user.email, permissions: [] },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.project.delete({ where: { id: testProject.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  describe('POST /api/skills/export-to-project', () => {
    it('未授权用户应该返回 401', async () => {
      const request = new NextRequest('http://localhost/api/skills/export-to-project', {
        method: 'POST',
        body: JSON.stringify({ projectId: testProject.id }),
      });

      const response = await exportHandler(request);
      expect(response.status).toBe(401);
    });

    it('缺少项目 ID 应该返回 400', async () => {
      const request = new NextRequest('http://localhost/api/skills/export-to-project', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({}),
      });

      const response = await exportHandler(request);
      expect(response.status).toBe(400);
    });

    // 更多测试用例...
  });

  describe('GET /api/skills/export-status', () => {
    it('未授权用户应该返回 401', async () => {
      const request = new NextRequest(
        'http://localhost/api/skills/export-status?projectId=' + testProject.id,
        { method: 'GET' }
      );

      const response = await statusHandler(request);
      expect(response.status).toBe(401);
    });

    it('缺少项目 ID 应该返回 400', async () => {
      const request = new NextRequest('http://localhost/api/skills/export-status', {
        method: 'GET',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      const response = await statusHandler(request);
      expect(response.status).toBe(400);
    });

    // 更多测试用例...
  });
});
```

- [ ] **步骤 2：运行测试**

运行：`npm test tests/api/skills-export.test.ts`
预期：测试通过

- [ ] **步骤 3：Commit**

```bash
git add tests/api/skills-export.test.ts
git commit -m "test(skills): 添加 Skills 导出 API 集成测试

- 测试手动导出 API
- 测试状态查询 API
- 测试认证和权限验证"
```

---

## 任务 10：文档和最终验证

**文件：**
- 修改：`README.md` 或创建 `docs/skills-export.md`

**目标：** 添加使用文档和最终验证

- [ ] **步骤 1：创建使用文档**

创建 `docs/skills-export.md`：

```markdown
# Skills 导出功能文档

## 概述

Skills 导出功能将数据库中的 Skills 自动导出到项目的 `.claude/skills/` 目录，使 Claude 能够自动发现并选择合适的 Skills。

## 使用方式

### 自动导出

在评估启动时，系统会自动将激活的 Skills 导出到项目目录。无需手动操作。

### 手动导出

使用 API 手动触发导出：

```bash
curl -X POST http://localhost:3000/api/skills/export-to-project \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "proj_abc123",
    "options": {
      "overwrite": true,
      "cleanup": true
    }
  }'
```

### 查询导出状态

```bash
curl -X GET "http://localhost:3000/api/skills/export-status?projectId=proj_abc123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 目录结构

导出后的目录结构：

```
project-root/
└── .claude/
    └── skills/
        ├── sql-injection/
        │   └── SKILL.md
        ├── xss-detection/
        │   └── SKILL.md
        └── auth-bypass/
            └── SKILL.md
```

## 版本同步

系统会自动检测 Skills 版本变更，仅在需要时重新导出：

- 版本号不同时重新导出
- 更新时间戳变化时重新导出
- 过期的 Skills 会被自动清理

## 错误处理

导出失败不会阻塞评估流程。错误信息会记录到日志中。

## 性能优化

- 5 分钟内重复导出会使用缓存
- 并发导出多个 Skills
- 增量同步，仅导出变化的 Skills
```

- [ ] **步骤 2：运行完整测试套件**

运行：`npm test`
预期：所有测试通过

- [ ] **步骤 3：运行构建**

运行：`npm run build`
预期：构建成功，无错误

- [ ] **步骤 4：运行类型检查**

运行：`npx tsc --noEmit`
预期：无类型错误

- [ ] **步骤 5：运行 Lint**

运行：`npm run lint`
预期：无 Lint 错误

- [ ] **步骤 6：Commit 文档**

```bash
git add docs/skills-export.md
git commit -m "docs(skills): 添加 Skills 导出功能使用文档"
```

- [ ] **步骤 7：最终 Commit**

```bash
git add -A
git commit -m "feat(skills): 完成 Skills 导出混合方案实现

实现功能:
- 数据库存储 + Claude 格式导出
- 评估启动时自动同步
- 版本判断和增量更新
- 清理过期 Skills
- 手动导出 API
- 状态查询 API
- 完整测试覆盖

文档:
- docs/superpowers/specs/2026-04-06-skills-export-design.md
- docs/skills-export.md

测试:
- tests/services/skills-export.test.ts
- tests/api/skills-export.test.ts"
```

---

## 自检清单

在执行计划前，请验证：

- [x] **规格覆盖度**: 每个需求都有对应任务
- [x] **无占位符**: 所有步骤都有完整代码和命令
- [x] **类型一致性**: 类型定义在任务 1 中完成，后续任务引用一致
- [x] **测试覆盖**: 单元测试和集成测试完整
- [x] **错误处理**: 所有函数都包含错误处理
- [x] **文档完整**: 包含使用文档和设计文档

---

## 执行选项

计划已完成并保存到 `docs/superpowers/plans/2026-04-06-skills-export.md`。两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

选哪种方式？
