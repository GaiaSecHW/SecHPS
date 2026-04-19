// src/services/skill-execution-log.ts
/**
 * Skill 执行记录文件服务
 * 
 * 用于读写 workspace/skill-execution-log.json 文件
 */

import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';

export interface SkillExecutionLogEntry {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  findingsCount: number;
}

export interface SkillExecutionLog {
  evaluationId: string;
  projectId: string;
  startedAt: string;
  skills: SkillExecutionLogEntry[];
}

/**
 * 更新 Skill 执行日志文件
 * @param projectPath 项目路径
 * @param skillId Skill ID
 * @param status 状态
 * @param findingsCount 发现数量（可选）
 */
export async function updateSkillExecutionLog(
  projectPath: string,
  skillId: string,
  status: 'running' | 'completed' | 'failed',
  findingsCount?: number
): Promise<void> {
  const logPath = join(projectPath, 'workspace', 'skill-execution-log.json');
  
  try {
    // 检查文件是否存在
    await access(logPath);
    
    // 读取现有日志
    const content = await readFile(logPath, 'utf-8');
    const log: SkillExecutionLog = JSON.parse(content);
    
    // 找到对应的 Skill 并更新
    const skill = log.skills.find(s => s.id === skillId);
    if (skill) {
      skill.status = status;
      
      if (status === 'running') {
        skill.startedAt = new Date().toISOString();
      } else if (status === 'completed' || status === 'failed') {
        skill.completedAt = new Date().toISOString();
        if (findingsCount !== undefined) {
          skill.findingsCount = findingsCount;
        }
      }
      
      // 写回文件
      await writeFile(logPath, JSON.stringify(log, null, 2), 'utf-8');
      console.log(`[SkillExecutionLog] 已更新 Skill ${skillId} 状态为 ${status}`);
    } else {
      console.warn(`[SkillExecutionLog] 未找到 Skill ${skillId}`);
    }
  } catch (error) {
    console.error('[SkillExecutionLog] 更新失败:', error);
  }
}

/**
 * 检查所有必须执行的 Skills 是否都已完成
 * @param projectPath 项目路径
 * @returns 未完成的 Skill 数量，0 表示全部完成
 */
export async function checkAllSkillsCompleted(projectPath: string): Promise<number> {
  const logPath = join(projectPath, 'workspace', 'skill-execution-log.json');
  
  try {
    await access(logPath);
    const content = await readFile(logPath, 'utf-8');
    const log: SkillExecutionLog = JSON.parse(content);
    
    const pendingCount = log.skills.filter(s => s.status === 'pending').length;
    const runningCount = log.skills.filter(s => s.status === 'running').length;
    
    return pendingCount + runningCount;
  } catch {
    return 0; // 文件不存在，跳过检查
  }
}

/**
 * 获取 Skill 执行日志
 * @param projectPath 项目路径
 */
export async function getSkillExecutionLog(projectPath: string): Promise<SkillExecutionLog | null> {
  const logPath = join(projectPath, 'workspace', 'skill-execution-log.json');
  
  try {
    await access(logPath);
    const content = await readFile(logPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
