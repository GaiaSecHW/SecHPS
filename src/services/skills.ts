// src/services/skills.ts

import { prisma } from '@/lib/prisma';
import type { Skill } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Skill 分类
 */
export type SkillCategory =
  | 'code-audit'    // 代码审计
  | 'auth'          // 认证鉴权
  | 'sensitive'     // 敏感信息
  | 'api'           // API 安全
  | 'config'        // 配置安全
  | 'crypto'        // 加密解密
  | 'web'           // Web 安全
  | 'business'      // 业务逻辑
  | 'client'        // 客户端安全
  | 'cloud';        // 云安全

/**
 * 严重程度
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Skill 工具定义
 */
export interface SkillTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/**
 * Skill 参数定义
 */
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: unknown;
}

/**
 * 加载后的 Skill 数据
 */
export interface LoadedSkill {
  id: string;
  userId: string | null;  // null = 公共，有值 = 私有
  name: string;
  displayName: string;
  description: string;
  category: SkillCategory;
  severity: Severity;
  cwe?: string | null;
  systemPrompt: string;
  userPrompt: string;
  tools: SkillTool[];
  parameters: SkillParameter[];
  version: number;
  parentId?: string | null;
  isLatest: boolean;
  successRate?: number | null;
  avgDuration?: number | null;
  execCount: number;
  
  // 官方标准字段
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

/**
 * Skills 提示词上下文
 */
export interface SkillsPromptContext {
  projectPath?: string;
  environmentUrl?: string;
  targetFiles?: string[];
  customVariables?: Record<string, string>;
}

/**
 * 进化变更类型
 */
export type EvolutionChangeType =
  | 'prompt-update'
  | 'parameter-tune'
  | 'tool-add'
  | 'tool-remove';

/**
 * 进化原因
 */
export type EvolutionReason =
  | '手动调整'
  | '自动优化'
  | '误报反馈'
  | '漏报反馈';

/**
 * 从数据库加载所有激活的公共 Skills
 */
export async function loadActiveSkills(): Promise<LoadedSkill[]> {
  try {
    const skills = await prisma.skill.findMany({
      where: { 
        isActive: true,
        userId: null,  // 只加载公共 Skills
        isLatest: true,  // 只加载最新版本
      },
      orderBy: [
        { severity: 'desc' },  // 按严重程度排序：critical > high > medium > low > info
        { successRate: 'desc' }, // 然后按成功率排序
      ],
    });

    return skills.map(skill => parseSkill(skill));
  } catch (error) {
    console.error('[SkillsService] 加载 Skills 失败:', error);
    return [];
  }
}

/**
 * 加载用户可用的所有 Skills（公共 + 用户私有）
 */
export async function loadAllAvailableSkills(userId: string | null): Promise<LoadedSkill[]> {
  try {
    const whereClause: { isActive: boolean; isLatest: boolean; OR?: Array<{ userId: string | null }> } = {
      isActive: true,
      isLatest: true,
    };

    if (userId) {
      // 用户可以访问公共 Skills 和自己的私有 Skills
      whereClause.OR = [
        { userId: null },      // 公共 Skills
        { userId: userId },    // 用户私有 Skills
      ];
    } else {
      // 未登录用户只能访问公共 Skills
      whereClause.userId = null;
    }

    const skills = await prisma.skill.findMany({
      where: whereClause,
      orderBy: [
        { severity: 'desc' },
        { successRate: 'desc' },
      ],
    });

    return skills.map(skill => parseSkill(skill));
  } catch (error) {
    console.error('[SkillsService] 加载可用 Skills 失败:', error);
    return [];
  }
}

/**
 * 加载公共 Skills
 */
export async function loadPublicSkills(): Promise<LoadedSkill[]> {
  try {
    const skills = await prisma.skill.findMany({
      where: { 
        isActive: true,
        userId: null,
        isLatest: true,
      },
      orderBy: [
        { severity: 'desc' },
        { successRate: 'desc' },
      ],
    });

    return skills.map(skill => parseSkill(skill));
  } catch (error) {
    console.error('[SkillsService] 加载公共 Skills 失败:', error);
    return [];
  }
}

/**
 * 加载用户私有的 Skills
 */
export async function loadUserSkills(userId: string): Promise<LoadedSkill[]> {
  try {
    const skills = await prisma.skill.findMany({
      where: { 
        userId: userId,
        isLatest: true,
      },
      orderBy: [
        { severity: 'desc' },
        { successRate: 'desc' },
      ],
    });

    return skills.map(skill => parseSkill(skill));
  } catch (error) {
    console.error('[SkillsService] 加载用户 Skills 失败:', error);
    return [];
  }
}

/**
 * 创建新的 Skill
 */
export async function createSkill(
  data: {
    name: string;
    displayName: string;
    description: string;
    category: string;
    cwe?: string | null;
    severity: string;
    systemPrompt: string;
    userPrompt: string;
    tools: SkillTool[];
    parameters: SkillParameter[];
    userId?: string | null;  // null = 公共，有值 = 私有
    isBuiltin?: boolean;
  }
): Promise<LoadedSkill | null> {
  try {
    // 检查名称是否已存在（同一作用域内）
    const existing = await prisma.skill.findFirst({
      where: {
        name: data.name,
        userId: data.userId ?? null,
      },
    });

    if (existing) {
      throw new Error(`Skill 名称 "${data.name}" 在当前作用域内已存在`);
    }

    const skill = await prisma.skill.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        category: data.category,
        cwe: data.cwe,
        severity: data.severity,
        systemPrompt: data.systemPrompt,
        userPrompt: data.userPrompt,
        tools: JSON.stringify(data.tools),
        parameters: JSON.stringify(data.parameters),
        userId: data.userId ?? null,
        isBuiltin: data.isBuiltin ?? false,
        version: 1,
        isLatest: true,
      },
    });

    return parseSkill(skill);
  } catch (error) {
    console.error('[SkillsService] 创建 Skill 失败:', error);
    throw error;
  }
}

/**
 * 创建 Skill 新版本
 */
export async function createSkillVersion(
  skillId: string,
  updates: {
    displayName?: string;
    description?: string;
    category?: string;
    cwe?: string | null;
    severity?: string;
    systemPrompt?: string;
    userPrompt?: string;
    tools?: SkillTool[];
    parameters?: SkillParameter[];
  },
  evolutionData: {
    changeType: EvolutionChangeType;
    changeDesc: string;
    reason: EvolutionReason;
  }
): Promise<LoadedSkill | null> {
  try {
    // 获取当前 Skill
    const currentSkill = await prisma.skill.findUnique({
      where: { id: skillId },
    });

    if (!currentSkill) {
      throw new Error('Skill 不存在');
    }

    // 将当前版本标记为非最新
    await prisma.skill.update({
      where: { id: skillId },
      data: { isLatest: false },
    });

    // 创建新版本
    const newSkill = await prisma.skill.create({
      data: {
        name: currentSkill.name,
        displayName: updates.displayName ?? currentSkill.displayName,
        description: updates.description ?? currentSkill.description,
        category: updates.category ?? currentSkill.category,
        cwe: updates.cwe ?? currentSkill.cwe,
        severity: updates.severity ?? currentSkill.severity,
        systemPrompt: updates.systemPrompt ?? currentSkill.systemPrompt,
        userPrompt: updates.userPrompt ?? currentSkill.userPrompt,
        tools: updates.tools ? JSON.stringify(updates.tools) : currentSkill.tools,
        parameters: updates.parameters ? JSON.stringify(updates.parameters) : currentSkill.parameters,
        userId: currentSkill.userId,
        isBuiltin: currentSkill.isBuiltin,
        isActive: currentSkill.isActive,
        version: currentSkill.version + 1,
        parentId: currentSkill.id,
        isLatest: true,
        successRate: currentSkill.successRate,
        avgDuration: currentSkill.avgDuration,
        execCount: currentSkill.execCount,
      },
    });

    // 记录进化历史
    const beforeData = {
      displayName: currentSkill.displayName,
      description: currentSkill.description,
      systemPrompt: currentSkill.systemPrompt,
      userPrompt: currentSkill.userPrompt,
      tools: JSON.parse(currentSkill.tools),
      parameters: JSON.parse(currentSkill.parameters),
    };

    const afterData = {
      displayName: newSkill.displayName,
      description: newSkill.description,
      systemPrompt: newSkill.systemPrompt,
      userPrompt: newSkill.userPrompt,
      tools: JSON.parse(newSkill.tools),
      parameters: JSON.parse(newSkill.parameters),
    };

    await prisma.skillEvolution.create({
      data: {
        skillId: newSkill.id,
        fromVersion: currentSkill.version,
        toVersion: newSkill.version,
        changeType: evolutionData.changeType,
        changeDesc: evolutionData.changeDesc,
        beforeData: JSON.stringify(beforeData),
        afterData: JSON.stringify(afterData),
        reason: evolutionData.reason,
        beforeRate: currentSkill.successRate,
        afterRate: newSkill.successRate,
      },
    });

    return parseSkill(newSkill);
  } catch (error) {
    console.error('[SkillsService] 创建 Skill 版本失败:', error);
    throw error;
  }
}

/**
 * 回滚 Skill 到指定版本
 */
export async function rollbackSkillVersion(
  targetSkillId: string,
  reason: string
): Promise<LoadedSkill | null> {
  try {
    // 获取目标版本
    const targetSkill = await prisma.skill.findUnique({
      where: { id: targetSkillId },
    });

    if (!targetSkill) {
      throw new Error('目标 Skill 版本不存在');
    }

    // 获取当前最新版本
    const currentLatest = await prisma.skill.findFirst({
      where: {
        name: targetSkill.name,
        userId: targetSkill.userId,
        isLatest: true,
      },
    });

    if (!currentLatest) {
      throw new Error('当前最新版本不存在');
    }

    // 将当前最新版本标记为非最新
    await prisma.skill.update({
      where: { id: currentLatest.id },
      data: { isLatest: false },
    });

    // 创建新版本（基于目标版本）
    const newSkill = await prisma.skill.create({
      data: {
        name: targetSkill.name,
        displayName: targetSkill.displayName,
        description: targetSkill.description,
        category: targetSkill.category,
        cwe: targetSkill.cwe,
        severity: targetSkill.severity,
        systemPrompt: targetSkill.systemPrompt,
        userPrompt: targetSkill.userPrompt,
        tools: targetSkill.tools,
        parameters: targetSkill.parameters,
        userId: targetSkill.userId,
        isBuiltin: targetSkill.isBuiltin,
        isActive: targetSkill.isActive,
        version: currentLatest.version + 1,
        parentId: currentLatest.id,
        isLatest: true,
        successRate: targetSkill.successRate,
        avgDuration: targetSkill.avgDuration,
        execCount: targetSkill.execCount,
      },
    });

    // 记录进化历史
    await prisma.skillEvolution.create({
      data: {
        skillId: newSkill.id,
        fromVersion: currentLatest.version,
        toVersion: newSkill.version,
        changeType: 'prompt-update',
        changeDesc: `回滚到版本 ${targetSkill.version}`,
        beforeData: JSON.stringify({
          displayName: currentLatest.displayName,
          description: currentLatest.description,
          systemPrompt: currentLatest.systemPrompt,
          userPrompt: currentLatest.userPrompt,
        }),
        afterData: JSON.stringify({
          displayName: targetSkill.displayName,
          description: targetSkill.description,
          systemPrompt: targetSkill.systemPrompt,
          userPrompt: targetSkill.userPrompt,
        }),
        reason: `回滚: ${reason}`,
        beforeRate: currentLatest.successRate,
        afterRate: targetSkill.successRate,
      },
    });

    return parseSkill(newSkill);
  } catch (error) {
    console.error('[SkillsService] 回滚 Skill 版本失败:', error);
    throw error;
  }
}

/**
 * 获取 Skill 的所有版本
 */
export async function getSkillVersions(skillId: string): Promise<Array<{
  id: string;
  version: number;
  isLatest: boolean;
  createdAt: Date;
  changeDesc?: string;
}>> {
  try {
    // 获取当前 Skill
    const skill = await prisma.skill.findUnique({
      where: { id: skillId },
    });

    if (!skill) {
      return [];
    }

    // 查找所有版本（通过名称和用户ID）
    const versions = await prisma.skill.findMany({
      where: {
        name: skill.name,
        userId: skill.userId,
      },
      orderBy: { version: 'desc' },
    });

    // 获取进化记录
    const evolutions = await prisma.skillEvolution.findMany({
      where: {
        skillId: { in: versions.map(v => v.id) },
      },
    });

    const evolutionMap = new Map(
      evolutions.map(e => [e.skillId, e.changeDesc])
    );

    return versions.map(v => ({
      id: v.id,
      version: v.version,
      isLatest: v.isLatest,
      createdAt: v.createdAt,
      changeDesc: evolutionMap.get(v.id),
    }));
  } catch (error) {
    console.error('[SkillsService] 获取 Skill 版本失败:', error);
    return [];
  }
}

/**
 * 根据 ID 列表加载 Skills
 */
export async function loadSkillsByIds(ids: string[]): Promise<LoadedSkill[]> {
  if (ids.length === 0) {
    return [];
  }

  try {
    const skills = await prisma.skill.findMany({
      where: {
        id: { in: ids },
        isActive: true,
        isLatest: true,
      },
    });

    return skills.map(skill => parseSkill(skill));
  } catch (error) {
    console.error('[SkillsService] 加载指定 Skills 失败:', error);
    return [];
  }
}

/**
 * 根据名称加载 Skills
 */
export async function loadSkillsByNames(names: string[]): Promise<LoadedSkill[]> {
  if (names.length === 0) {
    return [];
  }

  try {
    const skills = await prisma.skill.findMany({
      where: {
        name: { in: names },
        isActive: true,
        isLatest: true,
      },
    });

    return skills.map(skill => parseSkill(skill));
  } catch (error) {
    console.error('[SkillsService] 加载指定 Skills 失败:', error);
    return [];
  }
}

/**
 * 按分类筛选 Skills
 */
export function filterSkillsByCategory(
  skills: LoadedSkill[],
  categories: SkillCategory[]
): LoadedSkill[] {
  return skills.filter(skill => categories.includes(skill.category));
}

/**
 * 按严重程度筛选 Skills
 */
export function filterSkillsBySeverity(
  skills: LoadedSkill[],
  severities: Severity[]
): LoadedSkill[] {
  return skills.filter(skill => severities.includes(skill.severity));
}

/**
 * 解析 Skill 数据
 */
function parseSkill(skill: Skill): LoadedSkill {
  let tools: SkillTool[] = [];
  let parameters: SkillParameter[] = [];

  try {
    if (skill.tools) {
      tools = JSON.parse(skill.tools);
    }
  } catch (error) {
    console.warn(`[SkillsService] 解析 Skill ${skill.name} 的 tools 失败:`, error);
  }

  try {
    if (skill.parameters) {
      parameters = JSON.parse(skill.parameters);
    }
  } catch (error) {
    console.warn(`[SkillsService] 解析 Skill ${skill.name} 的 parameters 失败:`, error);
  }

  return {
    id: skill.id,
    userId: skill.userId,
    name: skill.name,
    displayName: skill.displayName,
    description: skill.description,
    category: skill.category as SkillCategory,
    severity: skill.severity as Severity,
    cwe: skill.cwe,
    systemPrompt: skill.systemPrompt,
    userPrompt: skill.userPrompt,
    tools,
    parameters,
    version: skill.version,
    parentId: skill.parentId,
    isLatest: skill.isLatest,
    successRate: skill.successRate,
    avgDuration: skill.avgDuration,
    execCount: skill.execCount,
  };
}

/**
 * 将 Skills 转换为系统提示词
 */
export function buildSkillsSystemPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) {
    return '';
  }

  let prompt = '\n\n## 可用技能\n\n';
  prompt += '你可以使用以下技能来增强评估能力：\n\n';

  for (const skill of skills) {
    prompt += `### ${skill.displayName} (${skill.name})\n`;
    prompt += `- **分类**: ${getCategoryLabel(skill.category)}\n`;
    prompt += `- **严重程度**: ${getSeverityLabel(skill.severity)}\n`;
    if (skill.cwe) {
      prompt += `- **CWE**: ${skill.cwe}\n`;
    }
    prompt += `- **描述**: ${skill.description}\n`;

    if (skill.tools.length > 0) {
      prompt += `- **所需工具**: ${skill.tools.map(t => t.name).join(', ')}\n`;
    }

    if (skill.successRate !== null && skill.successRate !== undefined) {
      prompt += `- **成功率**: ${(skill.successRate * 100).toFixed(1)}%\n`;
    }

    prompt += '\n';
  }

  prompt += '**使用说明**：\n';
  prompt += '1. 根据项目特点，选择合适的技能进行评估\n';
  prompt += '2. 在评估报告中标注使用的技能名称\n';
  prompt += '3. 每个技能的发现结果应包含技能标识\n\n';

  return prompt;
}

/**
 * 构建 Skill 的用户提示词（带变量替换）
 */
export function buildSkillUserPrompt(
  skill: LoadedSkill,
  context: SkillsPromptContext
): string {
  let prompt = skill.userPrompt;

  // 替换内置变量
  prompt = prompt.replace(/\{\{projectPath\}\}/g, context.projectPath || '当前目录');
  prompt = prompt.replace(/\{\{environmentUrl\}\}/g, context.environmentUrl || '未配置');

  if (context.targetFiles && context.targetFiles.length > 0) {
    prompt = prompt.replace(/\{\{targetFiles\}\}/g, context.targetFiles.join(', '));
  } else {
    prompt = prompt.replace(/\{\{targetFiles\}\}/g, '全部文件');
  }

  // 替换自定义变量
  if (context.customVariables) {
    for (const [key, value] of Object.entries(context.customVariables)) {
      prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
  }

  return prompt;
}

/**
 * 获取分类标签
 */
function getCategoryLabel(category: SkillCategory): string {
  const labels: Record<SkillCategory, string> = {
    'code-audit': '代码审计',
    'auth': '认证鉴权',
    'sensitive': '敏感信息',
    'api': 'API 安全',
    'config': '配置安全',
    'crypto': '加密解密',
    'web': 'Web 安全',
    'business': '业务逻辑',
    'client': '客户端安全',
    'cloud': '云安全',
  };
  return labels[category] || category;
}

/**
 * 获取严重程度标签
 */
function getSeverityLabel(severity: Severity): string {
  const labels: Record<Severity, string> = {
    critical: '严重',
    high: '高危',
    medium: '中危',
    low: '低危',
    info: '信息',
  };
  return labels[severity] || severity;
}

/**
 * 获取 Skill 工具列表（用于 AI SDK 配置）
 */
export function getSkillTools(skills: LoadedSkill[]): SkillTool[] {
  const toolMap = new Map<string, SkillTool>();

  for (const skill of skills) {
    for (const tool of skill.tools) {
      // 避免重复
      if (!toolMap.has(tool.name)) {
        toolMap.set(tool.name, tool);
      }
    }
  }

  return Array.from(toolMap.values());
}

/**
 * 获取 Skill 参数默认值
 */
export function getSkillParameterDefaults(skill: LoadedSkill): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  
  for (const param of skill.parameters) {
    if (param.default !== undefined) {
      defaults[param.name] = param.default;
    }
  }
  
  return defaults;
}

/**
 * 将 Skills 导出到 SKILL.md 文件
 */
export function exportSkillToFile(skill: LoadedSkill, targetDir: string): string {
  const skillDir = path.join(targetDir, skill.name);
  const skillFile = path.join(skillDir, `SKILL-v${skill.version}.md`);
  
  // 创建 Skill 目录
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }
  
  // 生成 Markdown 内容
  const markdown = generateSkillMarkdown(skill);
  
  // 写入文件
  fs.writeFileSync(skillFile, markdown, 'utf-8');
  
  return skillFile;
}

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
      console.log(`[Skills] 导出成功: ${skill.name} (v${skill.version}) -> ${skillFile}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      result.failed.push({ name: skill.name, error: errorMsg });
      console.error(`[Skills] 导出失败: ${skill.name} (v${skill.version})`, error);
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

/**
 * 从官方格式的 SKILL.md 导入 Skill
 */
export async function importSkillFromMarkdown(
  markdown: string,
  userId?: string | null
): Promise<LoadedSkill> {
  // 解析 YAML frontmatter
  const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  
  if (!frontmatterMatch) {
    throw new Error('无效的 SKILL.md 格式：缺少 YAML frontmatter');
  }
  
  const frontmatterText = frontmatterMatch[1] || '';
  const content = markdown.slice(frontmatterMatch[0].length);
  
  // 简单解析 frontmatter（实际项目应使用 YAML 解析库）
  const frontmatter: Record<string, any> = {};
  const lines = frontmatterText.split('\n');
  
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      
      // 处理布尔值
      if (value === 'true') {
        frontmatter[key] = true;
      } else if (value === 'false') {
        frontmatter[key] = false;
      } else {
        frontmatter[key] = value;
      }
    }
  }
  
  return {
    name: frontmatter.name || 'unnamed',
    displayName: frontmatter.name || 'Unnamed',
    description: frontmatter.description || content.slice(0, 200),
    category: inferCategory(frontmatter.description || content),
    severity: 'medium',  // 默认值
    cwe: extractCWE(frontmatter.description || content),
    systemPrompt: content,
    userPrompt: content,
    tools: parseTools(frontmatter['allowed-tools']),
    parameters: [],
    userId,
    isBuiltin: false,
    isActive: true,
    version: 1,
    parentId: null,
    isLatest: true,
    successRate: null,
    avgDuration: null,
    execCount: 0,
    
    // 新增字段
    disableModelInvocation: frontmatter['disable-model-invocation'] || false,
    userInvocable: frontmatter['user-invocable'] !== false,
    context: frontmatter.context,
    agent: frontmatter.agent,
    argumentHint: frontmatter['argument-hint'],
    model: frontmatter.model,
    effort: frontmatter.effort,
    paths: parsePaths(frontmatter.paths),
    shell: frontmatter.shell,
    hooks: parseHooks(frontmatter.hooks),
  };
}

/**
 * 推断 Skill 分类
 */
function inferCategory(description: string): SkillCategory {
  const keywords: Record<string, string[]> = {
    'code-audit': ['代码审计', 'SQL 注入', 'XSS', '代码漏洞', '注入'],
    'auth': ['认证', '授权', '登录', '密码', 'JWT', 'OAuth', '鉴权'],
    'sensitive': ['敏感信息', '密钥', '密码', '泄露', '硬编码'],
    'api': ['API', 'REST', 'GraphQL', '接口', '端点'],
    'config': ['配置', '环境变量', '设置', '环境'],
    'crypto': ['加密', '解密', '哈希', '密钥管理', '密码学'],
    'web': ['Web', 'HTTP', 'CORS', 'CSRF', '跨站'],
    'business': ['业务逻辑', '订单', '支付', '交易'],
    'client': ['客户端', '前端', '浏览器', '移动端'],
    'cloud': ['云', 'AWS', 'Azure', 'GCP', '容器'],
  };
  
  for (const [category, words] of Object.entries(keywords)) {
    if (words.some(word => description.includes(word))) {
      return category as SkillCategory;
    }
  }
  
  return 'code-audit';  // 默认分类
}

/**
 * 从描述中提取 CWE
 */
function extractCWE(description: string): string | null {
  const match = description.match(/CWE-\d+/);
  return match ? match[0] : null;
}

/**
 * 解析工具列表
 */
function parseTools(allowedTools?: string): SkillTool[] {
  if (!allowedTools) return [];
  
  const tools = allowedTools.split(' ').filter(t => t.trim());
  
  return tools.map(name => ({
    name,
    description: '',
    parameters: {},
  }));
}

/**
 * 解析路径列表
 */
function parsePaths(paths?: string): string[] {
  if (!paths) return [];
  
  return paths.split(',').map(p => p.trim()).filter(p => p);
}

/**
 * 解析 Hooks 配置
 */
function parseHooks(hooks?: string): Record<string, unknown> {
  if (!hooks) return {};
  
  try {
    return JSON.parse(hooks);
  } catch {
    return {};
  }
}
