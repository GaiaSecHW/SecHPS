/**
 * Phase IO 模块
 * 
 * 读取和写入阶段输出 YAML 文件
 * 注意：使用 outputs/ 目录替代 .claude/ 目录，因为大模型不允许操作 .claude 目录
 */
import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml'; // 需要安装: npm install yaml
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// 使用 outputs/phases 替代 .claude/phases
const OUTPUTS_PHASES_PATH = path.join(process.cwd(), 'outputs', 'phases');

export interface PhaseData {
  phaseNumber: number;
  phaseName: string;
  data: Record<string, any>;
  rawYaml: string;
}

/**
 * 读取阶段输出
 */
export async function readPhaseOutput(
  sessionId: string,
  phaseNumber: number
): Promise<PhaseData | null> {
  try {
    // 从数据库读取
    const dbOutput = await prisma.phaseOutput.findFirst({
      where: {
        sessionId,
        phaseNumber,
        status: 'validated'
      },
      orderBy: { createdAt: 'desc' }
    });

    if (dbOutput) {
      const data = yaml.parse(dbOutput.outputYaml);
      return {
        phaseNumber: dbOutput.phaseNumber,
        phaseName: dbOutput.phaseName,
        data,
        rawYaml: dbOutput.outputYaml
      };
    }

    // 从文件读取 - 使用 outputs/phases 替代 .claude/phases
    const phaseName = getPhaseName(phaseNumber);
    const phaseDir = path.join(OUTPUTS_PHASES_PATH, `${phaseNumber}-${phaseName}`);
    const yamlFile = path.join(phaseDir, `P${phaseNumber}_output.yaml`);

    const rawYaml = await fs.readFile(yamlFile, 'utf-8');
    const data = yaml.parse(rawYaml);

    return {
      phaseNumber,
      phaseName,
      data,
      rawYaml
    };

  } catch (error) {
    logger.error(LOG_MODULES.FSM, '操作失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return null;
  }
}

/**
 * 写入阶段输出
 */
export async function writePhaseOutput(
  sessionId: string,
  phaseNumber: number,
  data: Record<string, any>,
  executionId?: string,
  nodeId?: string
): Promise<string> {
  const phaseName = getPhaseName(phaseNumber);
  
  // 转换为 YAML
  const rawYaml = yaml.stringify(data);
  
  // 写入文件 - 使用 outputs/phases 替代 .claude/phases
  const phaseDir = path.join(OUTPUTS_PHASES_PATH, `${phaseNumber}-${phaseName}`);
  await fs.mkdir(phaseDir, { recursive: true });
  
  const outputPath = path.join(phaseDir, `P${phaseNumber}_output.yaml`);
  await fs.writeFile(outputPath, rawYaml, 'utf-8');
  
  // 写入数据库
  await prisma.phaseOutput.create({
    data: {
      id: generateId('phase'),
      sessionId,
      executionId,
      nodeId,
      phaseNumber,
      phaseName,
      phases: JSON.stringify(getPhaseLabels(phaseNumber)),
      outputYaml: rawYaml,
      outputPath,
      status: 'pending', // 等待验证
      updatedAt: new Date()
    }
  });

  return outputPath;
}

/**
 * 更新阶段输出状态
 */
export async function updatePhaseOutputStatus(
  sessionId: string,
  phaseNumber: number,
  status: 'pending' | 'validated' | 'failed',
  errorMessage?: string
): Promise<void> {
  await prisma.phaseOutput.updateMany({
    where: {
      sessionId,
      phaseNumber
    },
    data: {
      status,
      validatedAt: status === 'validated' ? new Date() : undefined,
      errorMessage: status === 'failed' ? errorMessage : undefined
    }
  });
}

/**
 * 读取所有前序阶段输出
 */
export async function readUpstreamPhaseOutputs(
  sessionId: string,
  currentPhase: number
): Promise<Record<string, PhaseData>> {
  const outputs: Record<string, PhaseData> = {};

  for (let phase = 1; phase < currentPhase; phase++) {
    const output = await readPhaseOutput(sessionId, phase);
    if (output) {
      outputs[`P${phase}`] = output;
    }
  }

  return outputs;
}

/**
 * 获取阶段名称
 */
function getPhaseName(phaseNumber: number): string {
  const phaseNames: Record<number, string> = {
    1: 'system-understanding',
    2: 'security-assessment',
    3: 'threat-analysis',
    4: 'report-generation'
  };
  return phaseNames[phaseNumber] || `phase-${phaseNumber}`;
}

/**
 * 获取阶段标签
 */
function getPhaseLabels(phaseNumber: number): string[] {
  const phaseLabels: Record<number, string[]> = {
    1: ['P1', 'P2'],
    2: ['P3', 'P4'],
    3: ['P5', 'P6'],
    4: ['P7', 'P8']
  };
  return phaseLabels[phaseNumber] || [];
}

/**
 * 构建阶段聚合数据
 */
export async function aggregatePhaseOutputs(sessionId: string): Promise<{
  phaseOutputs: Record<string, PhaseData>;
  statistics: {
    totalPhases: number;
    validatedPhases: number;
    findingsCounts: Record<number, number>;
  };
}> {
  const phaseOutputs: Record<string, PhaseData> = {};
  const findingsCounts: Record<number, number> = {};

  for (let phase = 1; phase <= 4; phase++) {
    const output = await readPhaseOutput(sessionId, phase);
    if (output) {
      phaseOutputs[`Phase${phase}`] = output;
      
      // 计算 findings 数量
      findingsCounts[phase] = countFindings(output.data);
    }
  }

  const validatedPhases = Object.keys(phaseOutputs).length;

  return {
    phaseOutputs,
    statistics: {
      totalPhases: 4,
      validatedPhases,
      findingsCounts
    }
  };
}

/**
 * 计算 findings 数量
 */
function countFindings(data: Record<string, any>): number {
  // 根据 phase 数据结构计算
  if (data.P1?.module_inventory?.modules) {
    return data.P1.module_inventory.modules.length;
  }
  if (data.P2?.dfd_elements) {
    return Object.values(data.P2.dfd_elements)
      .reduce((sum: number, arr: any) => sum + (arr?.length || 0), 0);
  }
  if (data.P3?.boundaries) {
    return data.P3.boundaries.length;
  }
  if (data.P4?.gaps) {
    return data.P4.gaps.length;
  }
  if (data.P5?.threats) {
    return data.P5.threats.length;
  }
  if (data.P6?.risk_details) {
    return data.P6.risk_details.length;
  }
  return 0;
}

export default {
  readPhaseOutput,
  writePhaseOutput,
  updatePhaseOutputStatus,
  readUpstreamPhaseOutputs,
  aggregatePhaseOutputs,
};