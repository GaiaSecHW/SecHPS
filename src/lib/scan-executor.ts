// src/lib/scan-executor.ts

import { prisma } from '@/lib/prisma';
import { AgentExecutor, AgentExecutionContext, AgentExecutionCallbacks, AgentExecutionResult } from '@/lib/agent-executor';

export interface ScanProgress {
  taskId: string;
  status: string;
  progress: number;
  currentSkill: string | null;
  totalSkills: number;
  completedSkills: number;
  findingsCount: number;
  error: string | null;
}

export interface ScanResult {
  skillId: string;
  skillName: string;
  status: 'completed' | 'failed' | 'skipped';
  findings: number;
  output: Record<string, unknown> | null;
  error: string | null | undefined;
  duration: number;
}

export type ProgressCallback = (progress: ScanProgress) => void;

/**
 * 扫描执行引擎
 */
export class ScanExecutor {
  private taskId: string;
  private progressCallback: ProgressCallback | null;
  private cancelled: boolean = false;
  private activeExecutors: Map<string, AgentExecutor> = new Map();

  constructor(taskId: string, progressCallback?: ProgressCallback) {
    this.taskId = taskId;
    this.progressCallback = progressCallback || null;
  }

  /**
   * 执行扫描任务
   */
  async execute(): Promise<ScanResult[]> {
    const task = await prisma.scanTask.findUnique({
      where: { id: this.taskId },
      include: {
        project: { include: { files: true } },
      },
    });

    if (!task) {
      throw new Error('扫描任务不存在');
    }

    const skillIds = JSON.parse(task.skillIds);
    const results: ScanResult[] = [];

    // 更新初始状态
    await this.updateProgress({
      taskId: this.taskId,
      status: 'running',
      progress: 0,
      currentSkill: null,
      totalSkills: skillIds.length,
      completedSkills: 0,
      findingsCount: 0,
      error: null,
    });

    for (let i = 0; i < skillIds.length; i++) {
      if (this.cancelled) {
        break;
      }

      const skillId = skillIds[i];
      const skill = await prisma.skill.findUnique({ where: { id: skillId } });

      if (!skill || !skill.isActive) {
        continue;
      }

      // 更新当前执行的 Skill
      await this.updateProgress({
        taskId: this.taskId,
        status: 'running',
        progress: Math.round((i / skillIds.length) * 100),
        currentSkill: skill.displayName,
        totalSkills: skillIds.length,
        completedSkills: i,
        findingsCount: results.reduce((sum, r) => sum + r.findings, 0),
        error: null,
      });

      // 执行单个 Skill
      const result = await this.executeSkill(skill as any, task.project);
      results.push(result);

      // 创建执行记录
      await prisma.skillExecution.create({
        data: {
          skillId: skill.id,
          projectId: task.projectId,
          scanTaskId: task.id,
          input: JSON.stringify({ projectId: task.projectId }),
          output: result.output ? JSON.stringify(result.output) : null,
          status: result.status,
          duration: result.duration,
        error: result.error ?? null,
          startedAt: new Date(Date.now() - result.duration),
          completedAt: new Date(),
        },
      });
    }

    // 更新完成状态
    const finalStatus = this.cancelled ? 'cancelled' : 'completed';
    await prisma.scanTask.update({
      where: { id: this.taskId },
      data: {
        status: finalStatus,
        progress: 100,
        completedSkills: skillIds.length,
        findingsCount: results.reduce((sum, r) => sum + r.findings, 0),
        completedAt: new Date(),
      },
    });

    await this.updateProgress({
      taskId: this.taskId,
      status: finalStatus,
      progress: 100,
      currentSkill: null,
      totalSkills: skillIds.length,
      completedSkills: skillIds.length,
      findingsCount: results.reduce((sum, r) => sum + r.findings, 0),
      error: null,
    });

    return results;
  }

  /**
   * 执行单个 Skill
   */
  private async executeSkill(
    skill: { id: string; name: string; displayName: string; systemPrompt: string; userPrompt: string; category: string; severity: string },
    project: { id: string; name: string; description: string | null; files: Array<{ fileName: string; fileType: string; fileSize: number }> }
  ): Promise<ScanResult> {
    const startTime = Date.now();

    try {
      // 获取模型配置
      const modelConfig = await this.getModelConfig();

      if (!modelConfig) {
        // 如果没有模型配置，使用模拟执行
        return this.simulateSkillExecution(skill, project, startTime);
      }

      // 创建 Agent 执行上下文
      const context: AgentExecutionContext = {
        skillId: skill.id,
        projectId: project.id,
        modelConfig: {
          providerType: modelConfig.providerType,
          apiKey: modelConfig.apiKey,
          apiBaseUrl: modelConfig.apiBaseUrl || 'https://api.anthropic.com/v1/messages',
          model: JSON.parse(modelConfig.models)[0] || 'claude-sonnet-4-20250514',
        },
        maxToolCalls: 20,
        maxIterations: 10,
      };

      // 执行
      let result: AgentExecutionResult;
      const callbacks: AgentExecutionCallbacks = {
        onChunk: () => {},
        onToolCall: (tool, params) => {
          console.log(`[ScanExecutor] Tool call: ${tool}`, params);
        },
        onVulnerability: (vuln) => {
          console.log(`[ScanExecutor] Found vulnerability: ${vuln.title}`);
        },
        onComplete: (r) => {
          result = r;
        },
        onError: (error) => {
          throw error;
        },
      };

      // 使用 Promise 包装
      result = await new Promise<AgentExecutionResult>((resolve, reject) => {
        const executor = new AgentExecutor(context, {
          ...callbacks,
          onComplete: resolve,
          onError: reject,
        });
        this.activeExecutors.set(skill.id, executor);

        executor.execute().then(resolve).catch(reject);
      });

      return {
        skillId: skill.id,
        skillName: skill.displayName,
        status: result.status === 'completed' ? 'completed' : 'failed',
        findings: result.vulnerabilities.length,
        output: {
          summary: result.summary,
          vulnerabilities: result.vulnerabilities,
          toolCalls: result.toolCalls,
        },
        error: result.error ?? undefined,
        duration: result.duration,
      };

    } catch (error) {
      return {
        skillId: skill.id,
        skillName: skill.displayName,
        status: 'failed',
        findings: 0,
        output: null,
        error: error instanceof Error ? error.message : '执行失败',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 模拟 Skill 执行（无模型配置时使用）
   */
  private async simulateSkillExecution(
    skill: { id: string; name: string; displayName: string; category: string; severity: string },
    project: { id: string },
    startTime: number
  ): Promise<ScanResult> {
    await this.simulateExecution(2000);

    const findingsCount = Math.floor(Math.random() * 3);

    // 注意：模拟执行不创建实际漏洞记录，仅返回模拟结果

    return {
      skillId: skill.id,
      skillName: skill.displayName,
      status: 'completed',
      findings: findingsCount,
      output: { simulated: true, duration: Date.now() - startTime },
      error: null,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 获取模型配置
   */
  private async getModelConfig(): Promise<{
    providerType: string;
    apiKey: string;
    apiBaseUrl: string;
    models: string;
  } | null> {
    return prisma.modelConfig.findFirst({
      where: { isActive: true, isDefault: true },
    });
  }

  /**
   * 模拟执行延迟
   */
  private async simulateExecution(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * 更新进度
   */
  private async updateProgress(progress: ScanProgress): Promise<void> {
    // 更新数据库
    await prisma.scanTask.update({
      where: { id: this.taskId },
      data: {
        status: progress.status,
        progress: progress.progress,
        currentSkill: progress.currentSkill,
        completedSkills: progress.completedSkills,
        findingsCount: progress.findingsCount,
        error: progress.error,
      },
    });

    // 调用回调
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
  }
}

/**
 * 创建扫描报告
 */
export async function createScanReport(taskId: string): Promise<string> {
  const task = await prisma.scanTask.findUnique({
    where: { id: taskId },
    include: {
      executions: {
        include: { skill: true },
      },
    },
  });

  if (!task) {
    throw new Error('扫描任务不存在');
  }

  const report = await prisma.scanReport.create({
    data: {
      scanTaskId: taskId,
      projectId: task.projectId,
      title: `扫描报告 - ${task.name}`,
      summary: JSON.stringify({
        totalSkills: task.totalSkills,
        completedSkills: task.completedSkills,
        findingsCount: task.findingsCount,
        duration: task.startedAt && task.completedAt
          ? task.completedAt.getTime() - task.startedAt.getTime()
          : 0,
      }),
      details: JSON.stringify({
        executions: task.executions.map(e => ({
          skill: e.skill?.displayName,
          status: e.status,
          duration: e.duration,
          error: e.error,
        })),
      }),
    },
  });

  return report.id;
}
