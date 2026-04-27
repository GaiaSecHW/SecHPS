/**
 * FSM 工作流节点执行器
 * 
 * 实现 4-Gate 协议：READ → ANALYZE → SYNTHESIZE → WRITE
 * 支持 Ralph Loop：验证失败后重试机制
 */

import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import type { WorkflowNode, WorkflowExecution, EvaluationSession } from '@prisma/client';
import type { ExecutionContext, StepResult } from '@/types/workflow';

// 4-Gate 状态
export type FSMGateState = 'READ' | 'ANALYZE' | 'SYNTHESIZE' | 'WRITE' | 'VALIDATE';

// 阶段输出数据
export interface PhaseOutputData {
  phaseNumber: number;
  phaseName: string;
  phases: string[];
  outputYaml: string;
  outputPath: string;
}

// FSM 执行上下文
export interface FSMExecutionContext extends ExecutionContext {
  sessionId: string;
  projectId: string;
  workspacePath: string;
  claudePath: string;
  fsmPhase: number;
  fsmState: FSMGateState;
  phaseOutputs: Map<number, PhaseOutputData>;
  maxIterations: number;
  currentIteration: number;
}

/**
 * FSM 节点执行器
 */
export class FSMNodeExecutor {
  private workspacePath: string;
  private outputsPath: string;  // 使用 outputs 替代 .claude

  constructor(workspacePath: string, outputsPath: string = 'outputs') {
    this.workspacePath = workspacePath;
    this.outputsPath = outputsPath;
  }

  /**
   * 执行 FSM 节点
   */
  async execute(
    node: WorkflowNode,
    context: FSMExecutionContext
  ): Promise<StepResult> {
    const nodeData = this.parseNodeData(node.data);
    const fsmPhase = nodeData.fsmPhase || node.fsmPhase || 1;
    const phases = nodeData.phases || [];
    const skillPath = nodeData.skillPath || node.skillPath;

    const startTime = new Date();

    try {
      // 更新状态为 running
      await this.updateNodeStatus(context.executionId, node.id, 'running');

      // 执行 4-Gate 协议
      const result = await this.executeFourGateProtocol(
        fsmPhase,
        phases,
        skillPath,
        context
      );

      // 验证输出
      const validationResult = await this.validatePhaseOutput(fsmPhase, result.outputYaml);

      if (!validationResult.valid) {
        // Ralph Loop: 重试
        const retryResult = await this.retryWithFeedback(
          fsmPhase,
          phases,
          skillPath,
          context,
          validationResult.errors
        );

        if (!retryResult.success) {
          return this.createFailedResult(node.id, startTime, retryResult.error || 'Validation failed after retries');
        }

        result.outputYaml = retryResult.outputYaml!;
      }

      // 写入阶段输出
      const outputPath = await this.writePhaseOutput(
        context.sessionId,
        fsmPhase,
        result.outputYaml,
        result.phaseName
      );

      // 保存到数据库
      await this.savePhaseOutputToDB(
        context.sessionId,
        context.executionId,
        node.id,
        fsmPhase,
        result.phaseName,
        phases,
        result.outputYaml,
        outputPath
      );

      // 更新状态为 completed
      await this.updateNodeStatus(context.executionId, node.id, 'completed');

      return this.createSuccessResult(
        node.id,
        startTime,
        { outputYaml: result.outputYaml, outputPath }
      );

    } catch (error) {
      console.error('[fsm/fsm-node-executor] 操作失败:', error instanceof Error ? error.message : String(error));
      await this.updateNodeStatus(context.executionId, node.id, 'failed');
      return this.createFailedResult(
        node.id,
        startTime,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * 4-Gate 协议执行
   */
  private async executeFourGateProtocol(
    fsmPhase: number,
    phases: string[],
    skillPath: string | undefined,
    context: FSMExecutionContext
  ): Promise<{ outputYaml: string; phaseName: string }> {
    const phaseName = this.getPhaseName(fsmPhase);

    // Gate 1: READ - 读取前序阶段输出
    const upstreamData = await this.readUpstreamData(fsmPhase, context);

    // Gate 2: ANALYZE - 读取 Skill 内容并执行分析
    const skillContent = await this.readSkillContent(skillPath, phases);
    
    // 这里实际的分析由 Agent 执行，我们只提供结构和数据
    // Gate 3: SYNTHESIZE - 合并分析结果（由 Agent 完成）
    // Gate 4: WRITE - 写入输出（由 Agent 完成）

    // 返回预期的输出结构（实际内容由 Agent 生成）
    const outputYaml = this.generateOutputTemplate(fsmPhase, phases, upstreamData);

    return { outputYaml, phaseName };
  }

  /**
   * 读取前序阶段数据
   */
  private async readUpstreamData(
    currentPhase: number,
    context: FSMExecutionContext
  ): Promise<Record<string, string>> {
    const upstreamData: Record<string, string> = {};

    // 读取所有前序阶段的输出
    for (let phase = 1; phase < currentPhase; phase++) {
      const phaseOutputs = await prisma.phaseOutput.findMany({
        where: {
          sessionId: context.sessionId,
          phaseNumber: phase,
          status: 'validated'
        },
        orderBy: { createdAt: 'desc' }
      });

      for (const output of phaseOutputs) {
        upstreamData[`P${phase}`] = output.outputYaml;
      }
    }

    return upstreamData;
  }

  /**
   * 读取 Skill 内容
   */
  private async readSkillContent(
    skillPath: string | undefined,
    phases: string[]
  ): Promise<string> {
    if (!skillPath) return '';

    // Skill 内容会在 Agent 执行时加载
    // 这里返回提示，告知 Agent 需要读取哪些文件
    const phaseFiles = phases.map(p => `${skillPath}/${p}.md`).join('\n');
    return `请读取以下 Skill 文件:\n${phaseFiles}`;
  }

  /**
   * 获取阶段名称
   */
  private getPhaseName(fsmPhase: number): string {
    const phaseNames: Record<number, string> = {
      1: 'system-understanding',
      2: 'security-assessment',
      3: 'threat-analysis',
      4: 'report-generation'
    };
    return phaseNames[fsmPhase] || `phase-${fsmPhase}`;
  }

  /**
   * 生成输出模板
   */
  private generateOutputTemplate(
    fsmPhase: number,
    phases: string[],
    upstreamData: Record<string, string>
  ): string {
    // 根据阶段生成 YAML 模板结构
    const templates: Record<number, string> = {
      1: this.generatePhase1Template(phases),
      2: this.generatePhase2Template(phases),
      3: this.generatePhase3Template(phases),
      4: this.generatePhase4Template(phases, upstreamData)
    };

    return templates[fsmPhase] || '';
  }

  private generatePhase1Template(phases: string[]): string {
    if (phases.includes('P1') && phases.includes('P2')) {
      return `
# P1: Project Understanding
project_context:
  project_type: ""
  tech_stack: []

module_inventory:
  modules: []

entry_point_inventory:
  entry_points: []

discovery_checklist:
  checklist: {}

# P2: DFD Analysis
dfd_elements:
  external_interactors: []
  processes: []
  data_stores: []
  data_flows: []

l1_coverage:
  coverage_percentage: 100
`;
    }
    return '';
  }

  private generatePhase2Template(phases: string[]): string {
    if (phases.includes('P3') && phases.includes('P4')) {
      return `
# P3: Trust Boundary
boundaries: []
cross_boundary_flows: []

# P4: Security Design Review
gaps: []
design_matrix: {}
`;
    }
    return '';
  }

  private generatePhase3Template(phases: string[]): string {
    if (phases.includes('P5') && phases.includes('P6')) {
      return `
# P5: STRIDE Analysis
threats: []
summary:
  by_stride: {}
  by_priority: {}

# P6: Risk Validation
risk_summary:
  verified: 0
  theoretical: 0
  pending: 0
  excluded: 0

risk_details: []
poc_details: []
`;
    }
    return '';
  }

  private generatePhase4Template(phases: string[], upstreamData: Record<string, string>): string {
    if (phases.includes('P7') && phases.includes('P8')) {
      return `
# P7: Mitigation Planning
mitigations: []
roadmap:
  immediate: []
  short_term: []
  medium_term: []
  long_term: []
`;
    }
    return '';
  }

  /**
   * 验证阶段输出
   */
  private async validatePhaseOutput(
    fsmPhase: number,
    outputYaml: string
  ): Promise<{ valid: boolean; errors: string[] }> {
    // 导入对应的验证器
    const validators: Record<number, () => { valid: boolean; errors: string[] }> = {
      1: () => this.validatePhase1(outputYaml),
      2: () => this.validatePhase2(outputYaml),
      3: () => this.validatePhase3(outputYaml),
      4: () => this.validatePhase4(outputYaml)
    };

    const validator = validators[fsmPhase];
    if (!validator) {
      return { valid: true, errors: [] };
    }

    return validator();
  }

  // 各阶段验证器（简化版本）
  private validatePhase1(outputYaml: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!outputYaml.includes('project_context:')) {
      errors.push('Missing project_context section');
    }
    if (!outputYaml.includes('module_inventory:')) {
      errors.push('Missing module_inventory section');
    }
    if (!outputYaml.includes('entry_point_inventory:')) {
      errors.push('Missing entry_point_inventory section');
    }
    if (!outputYaml.includes('dfd_elements:')) {
      errors.push('Missing dfd_elements section');
    }

    return { valid: errors.length === 0, errors };
  }

  private validatePhase2(outputYaml: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!outputYaml.includes('boundaries:')) {
      errors.push('Missing boundaries section');
    }
    if (!outputYaml.includes('gaps:')) {
      errors.push('Missing gaps section');
    }

    return { valid: errors.length === 0, errors };
  }

  private validatePhase3(outputYaml: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!outputYaml.includes('threats:')) {
      errors.push('Missing threats section');
    }
    if (!outputYaml.includes('risk_summary:')) {
      errors.push('Missing risk_summary section');
    }

    return { valid: errors.length === 0, errors };
  }

  private validatePhase4(outputYaml: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!outputYaml.includes('mitigations:')) {
      errors.push('Missing mitigations section');
    }
    if (!outputYaml.includes('roadmap:')) {
      errors.push('Missing roadmap section');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Ralph Loop: 重试机制
   */
  private async retryWithFeedback(
    fsmPhase: number,
    phases: string[],
    skillPath: string | undefined,
    context: FSMExecutionContext,
    errors: string[]
  ): Promise<{ success: boolean; outputYaml?: string; error?: string }> {
    const maxRetries = context.maxIterations || 3;

    for (let iteration = 1; iteration <= maxRetries; iteration++) {
      // 注入错误反馈
      const feedbackPrompt = this.generateRetryPrompt(fsmPhase, errors, iteration);

      // 重新执行（实际由 Agent 执行）
      // 这里我们返回失败，让调用者处理
      // 实际实现中会调用 Agent API
    }

    return { success: false, error: `Failed after ${maxRetries} retries` };
  }

  private generateRetryPrompt(fsmPhase: number, errors: string[], iteration: number): string {
    return `
验证失败 (第 ${iteration} 次重试):
阶段: Phase ${fsmPhase}
错误:
${errors.map(e => `- ${e}`).join('\n')}

请修正输出并确保包含所有必需字段。
`;
  }

  /**
   * 写入阶段输出文件
   */
  private async writePhaseOutput(
    sessionId: string,
    fsmPhase: number,
    outputYaml: string,
    phaseName: string
  ): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');

    // 使用 outputs/phases 替代 .claude/phases
    const phaseDir = path.join(
      this.workspacePath,
      this.outputsPath,
      'phases',
      `${fsmPhase}-${phaseName}`
    );

    // 创建目录
    await fs.mkdir(phaseDir, { recursive: true });

    // 写入 YAML 文件
    const outputPath = path.join(phaseDir, `P${fsmPhase}_output.yaml`);
    await fs.writeFile(outputPath, outputYaml, 'utf-8');

    return outputPath;
  }

  /**
   * 保存阶段输出到数据库
   */
  private async savePhaseOutputToDB(
    sessionId: string,
    executionId: string,
    nodeId: string,
    fsmPhase: number,
    phaseName: string,
    phases: string[],
    outputYaml: string,
    outputPath: string
  ): Promise<void> {
    await prisma.phaseOutput.create({
      data: {
        id: generateId('phase'),
        sessionId,
        executionId,
        nodeId,
        phaseNumber: fsmPhase,
        phaseName,
        phases: JSON.stringify(phases),
        outputYaml,
        outputPath,
        status: 'validated',
        validatedAt: new Date(),
        updatedAt: new Date()
      }
    });
  }

  /**
   * 更新节点状态
   */
  private async updateNodeStatus(
    executionId: string,
    nodeId: string,
    status: string
  ): Promise<void> {
    await prisma.workflowExecutionStep.updateMany({
      where: {
        executionId,
        nodeId
      },
      data: {
        status,
        startedAt: status === 'running' ? new Date() : undefined,
        completedAt: status === 'completed' ? new Date() : undefined
      }
    });
  }

  /**
   * 解析节点数据
   */
  private parseNodeData(dataString: string): Record<string, any> {
    try {
      return JSON.parse(dataString);
    } catch {
      return {};
    }
  }

  /**
   * 创建成功结果
   */
  private createSuccessResult(
    nodeId: string,
    startTime: Date,
    output: any
  ): StepResult {
    return {
      nodeId,
      status: 'completed',
      input: null,
      output,
      error: null,
      startedAt: startTime,
      completedAt: new Date()
    };
  }

  /**
   * 创建失败结果
   */
  private createFailedResult(
    nodeId: string,
    startTime: Date,
    errorMessage: string
  ): StepResult {
    return {
      nodeId,
      status: 'failed',
      input: null,
      output: null,
      error: errorMessage,
      startedAt: startTime,
      completedAt: new Date()
    };
  }
}

export default FSMNodeExecutor;