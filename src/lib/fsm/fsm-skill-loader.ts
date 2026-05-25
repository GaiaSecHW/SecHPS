/**
 * FSM Skill 加载器
 *
 * 在 FSM 工作流启动时，将 Skill 目录复制到项目 outputs/skills/ 目录
 * 注意：使用 outputs/ 目录替代 .claude/ 目录，因为大模型不允许操作 .claude 目录
 */
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

const DATA_SKILLS_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), 'data', 'skills');
// 使用 outputs/ 替代 .claude/
const OUTPUTS_SKILLS_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), 'outputs', 'skills');
const OUTPUTS_PHASES_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), 'outputs', 'phases');

export interface LoadResult {
  success: boolean;
  skillPath: string;
  phaseDirs: string[];
  error?: string;
}

/**
 * 加载 FSM Skill 到项目目录
 */
export async function loadFSMSkill(
  templateName: string,
  sessionId: string,
  workspacePath?: string
): Promise<LoadResult> {
  try {
    // 1. 查询 FSM Template
    const template = await prisma.fSMTemplate.findUnique({
      where: { name: templateName }
    });

    if (!template) {
      return {
        success: false,
        skillPath: '',
        phaseDirs: [],
        error: `FSM Template "${templateName}" not found`
      };
    }

    // 2. 源路径
    // skillPath 格式: "skills/threat-modeling"
    // 直接拼接 process.cwd()
    const sourcePath = template.skillPath 
      ? path.join(/*turbopackIgnore: true*/ process.cwd(), template.skillPath)
      : DATA_SKILLS_PATH;
    
    logger.info(LOG_MODULES.FSM, `skillPath from DB: ${template.skillPath}`);
    logger.info(LOG_MODULES.FSM, `resolved sourcePath: ${sourcePath}`);

    // 3. 检查源目录是否存在
    const sourceExists = await fs.stat(sourcePath).catch(() => null);
    if (!sourceExists) {
      // 如果源目录不存在，创建目录结构
      await fs.mkdir(sourcePath, { recursive: true });
      await createSkillTemplate(sourcePath, templateName);
    }

    // 4. 目标路径 - 使用 outputs/skills 替代 .claude/skills
    const targetPath = path.join(OUTPUTS_SKILLS_PATH, templateName);

    // 5. 复制 Skill 目录
    await copyDirectory(sourcePath, targetPath);

    // 6. 创建阶段输出目录 - 使用 outputs/phases 替代 .claude/phases
    const phaseDirs: string[] = [];
    const nodes = JSON.parse(template.nodes);
    
    for (const node of nodes) {
      const phaseDir = path.join(
        OUTPUTS_PHASES_PATH,
        `${node.fsmPhase}-${getPhaseName(node.fsmPhase)}`
      );
      await fs.mkdir(phaseDir, { recursive: true });
      phaseDirs.push(phaseDir);
    }

    // 7. 创建 session 子目录 (如果提供了 sessionId)
    if (sessionId) {
      const sessionPhasesPath = path.join(OUTPUTS_PHASES_PATH, sessionId);
      await fs.mkdir(sessionPhasesPath, { recursive: true });
    }

    // 8. 记录到数据库（可选，不阻塞主流程）
    // 注意：skillExecution 需要有效的 skillId（指向 Skill 表的外键）
    // 对于 FSM 流程，我们暂时跳过这个记录，因为 templateName 不是 Skill 表的 ID
    // 如果需要记录，应该在 FSM 执行完成后统一记录
    /*
    try {
      await prisma.skillExecution.create({
        data: {
          id: generateId('skexec'),
          skillId: templateName,
          projectId: workspacePath || '',
          status: 'loaded',
          duration: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          input: '',
          findingsCount: 0,
        }
      });
    } catch (dbError) {
      logger.warn(LOG_MODULES.FSM, '记录 skillExecution 失败，继续执行', { details: { error: dbError instanceof Error ? dbError.message : String(dbError) } });
    }
    */

    return {
      success: true,
      skillPath: targetPath,
      phaseDirs
    };

  } catch (error) {
    logger.error(LOG_MODULES.FSM, '操作失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return {
      success: false,
      skillPath: '',
      phaseDirs: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * 复制目录
 */
async function copyDirectory(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  
  const entries = await fs.readdir(source, { withFileTypes: true });
  
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

/**
 * 创建 Skill 模板
 */
async function createSkillTemplate(skillPath: string, templateName: string): Promise<void> {
  // 创建基础目录结构
  await fs.mkdir(path.join(skillPath, 'phases'), { recursive: true });
  await fs.mkdir(path.join(skillPath, 'knowledge'), { recursive: true });

  // 创建 SKILL.md
  const skillContent = `# ${templateName} Skill

## Overview

This skill provides FSM workflow capabilities for security analysis.

## Usage

This skill is automatically loaded when creating an FSM workflow.

## Structure

- phases/ - Phase definition files
- knowledge/ - Knowledge base files
`;

  await fs.writeFile(path.join(skillPath, 'SKILL.md'), skillContent);

  // 创建 WORKFLOW.md
  const workflowContent = `# Workflow Definition

## FSM Phases

This workflow uses a fixed FSM structure with predefined phases.

## Nodes

See the FSM Template configuration for node details.
`;

  await fs.writeFile(path.join(skillPath, 'WORKFLOW.md'), workflowContent);
}

/**
 * 获取阶段名称
 */
function getPhaseName(fsmPhase: number): string {
  const phaseNames: Record<number, string> = {
    1: 'system-understanding',
    2: 'security-assessment',
    3: 'threat-analysis',
    4: 'report-generation'
  };
  return phaseNames[fsmPhase] || `phase-${fsmPhase}`;
}

/**
 * 读取 Skill 阶段内容
 */
export async function readPhaseContent(
  skillName: string,
  phases: string[]
): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  
  const skillPath = path.join(DATA_SKILLS_PATH, skillName, 'phases');
  
  for (const phase of phases) {
    const phaseFile = path.join(skillPath, `${phase}.md`);
    
    try {
      const content = await fs.readFile(phaseFile, 'utf-8');
      contents[phase] = content;
    } catch {
      // 文件不存在，使用模板
      contents[phase] = generatePhaseTemplate(phase);
    }
  }
  
  return contents;
}

/**
 * 生成阶段模板
 */
function generatePhaseTemplate(phase: string): string {
  return `# Phase ${phase}

This phase is part of the FSM workflow.

## Instructions

[Phase-specific instructions would be provided here]

## Output

Expected output structure will be defined by the phase schema.
`;
}

export default {
  loadFSMSkill,
  readPhaseContent,
};