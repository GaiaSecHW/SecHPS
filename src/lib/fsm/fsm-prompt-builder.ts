/**
 * FSM Prompt Builder
 * 
 * 为 Agent 区生成提示词，告知用户已完成的工作和产出文件
 */
import type { PhaseData } from './phase-io';

/**
 * 构建 Agent 区提示词
 */
export function buildAgentZonePrompt(
  phaseOutputs: Record<string, PhaseData>
): string {
  const sections: string[] = [];

  // 提取各阶段摘要
  const phase1Summary = extractPhase1Summary(phaseOutputs['P1'] || phaseOutputs['Phase1']);
  const phase2Summary = extractPhase2Summary(phaseOutputs['P2'] || phaseOutputs['Phase2']);
  const phase3Summary = extractPhase3Summary(phaseOutputs['P3'] || phaseOutputs['Phase3']);

sections.push(`
至此，威胁建模分析已完成以下阶段：

✅ **Node 1 系统理解** - 已完成
   产出文件：
   - outputs/phases/1-system-understanding/P1_project_context.yaml
     - 项目类型: ${phase1Summary.projectType}
     - 技术栈: ${phase1Summary.techStack}
     - 模块数量: ${phase1Summary.moduleCount}
     - 入口点数量: ${phase1Summary.entryPointCount}
   
   - outputs/phases/1-system-understanding/P2_dfd_elements.yaml
     - DFD 元素数量: ${phase1Summary.dfdElementCount}
     - 数据流数量: ${phase1Summary.dataFlowCount}
     - 覆盖率: ${phase1Summary.coveragePercentage}%
`);

  sections.push(`
✅ **Node 2 安全评估** - 已完成
   产出文件：
   - outputs/phases/2-security-assessment/P3_boundary_context.yaml
     - 信任边界数量: ${phase2Summary.boundaryCount}
   
   - outputs/phases/2-security-assessment/P4_security_gaps.yaml
     - 安全缺口数量: ${phase2Summary.gapCount}
     - 高危缺口: ${phase2Summary.highGaps}
     - 严重缺口: ${phase2Summary.criticalGaps}
`);

  sections.push(`
✅ **Node 3 娏胁分析** - 已完成
   产出文件：
   - outputs/phases/3-threat-analysis/P5_threat_inventory.yaml
     - 娏胁总数: ${phase3Summary.threatCount}
     - STRIDE 分布: ${formatStrideDistribution(phase3Summary.strideDistribution)}
   
   - outputs/phases/3-threat-analysis/P6_validated_risks.yaml
     - 已验证风险: ${phase3Summary.verifiedRisks}
     - 理论风险: ${phase3Summary.theoreticalRisks}
     - POC 数量: ${phase3Summary.pocCount}
`);

  sections.push(`
✅ **Node 2 安全评估** - 已完成
   产出文件：
   - .claude/phases/2-security-assessment/P3_boundary_context.yaml
     - 信任边界数量: ${phase2Summary.boundaryCount}
   
   - .claude/phases/2-security-assessment/P4_security_gaps.yaml
     - 安全缺口数量: ${phase2Summary.gapCount}
     - 高危缺口: ${phase2Summary.highGaps}
     - 严重缺口: ${phase2Summary.criticalGaps}
`);

  sections.push(`
✅ **Node 3 威胁分析** - 已完成
   产出文件：
   - .claude/phases/3-threat-analysis/P5_threat_inventory.yaml
     - 威胁总数: ${phase3Summary.threatCount}
     - STRIDE 分布: ${formatStrideDistribution(phase3Summary.strideDistribution)}
   
   - .claude/phases/3-threat-analysis/P6_validated_risks.yaml
     - 已验证风险: ${phase3Summary.verifiedRisks}
     - 理论风险: ${phase3Summary.theoreticalRisks}
     - POC 数量: ${phase3Summary.pocCount}
`);

  sections.push(`
---

现在进入 **Agent 扫描阶段**，您可以选择：

1. **SAST 扫描** - 静态代码分析
   - 请提供：要扫描的目录/文件路径
   - 示例："扫描 src/api/ 目录"

2. **Secret 扫描** - 密钥泄露检测
   - 请提供：扫描范围（默认整个项目）
   - 示例："检查整个项目的密钥泄露"

3. **Dependency 扫描** - 依赖漏洞检查
   - 请提供：package.json 或其他依赖文件路径
   - 示例："扫描 package.json 的依赖漏洞"

4. **自定义扫描** - 使用其他工具
   - 请提供：工具名称和参数

**注意**：扫描报告将输出到项目的 \`vulnerabilities/\` 目录下。
`);

  return sections.join('\n');
}

/**
 * 提取 Phase 1 摘要
 */
function extractPhase1Summary(phaseData: PhaseData | null | undefined): {
  projectType: string;
  techStack: string;
  moduleCount: number;
  entryPointCount: number;
  dfdElementCount: number;
  dataFlowCount: number;
  coveragePercentage: number;
} {
  if (!phaseData?.data) {
    return {
      projectType: '未知',
      techStack: '未知',
      moduleCount: 0,
      entryPointCount: 0,
      dfdElementCount: 0,
      dataFlowCount: 0,
      coveragePercentage: 0
    };
  }

  const data = phaseData.data;
  const p1 = data.P1 || data;
  const p2 = data.P2 || data;

  return {
    projectType: p1.project_context?.project_type || '未知',
    techStack: (p1.project_context?.tech_stack || []).join(', ') || '未知',
    moduleCount: p1.module_inventory?.modules?.length || 0,
    entryPointCount: p1.entry_point_inventory?.entry_points?.length || 0,
    dfdElementCount: countDFDElements(p2.dfd_elements),
    dataFlowCount: p2.data_flow_traces?.data_flows?.length || p2.dfd_elements?.data_flows?.length || 0,
    coveragePercentage: p2.l1_coverage?.coverage_percentage || 0
  };
}

/**
 * 提取 Phase 2 摘要
 */
function extractPhase2Summary(phaseData: PhaseData | null | undefined): {
  boundaryCount: number;
  gapCount: number;
  highGaps: number;
  criticalGaps: number;
} {
  if (!phaseData?.data) {
    return {
      boundaryCount: 0,
      gapCount: 0,
      highGaps: 0,
      criticalGaps: 0
    };
  }

  const data = phaseData.data;
  const p3 = data.P3 || data;
  const p4 = data.P4 || data;

  return {
    boundaryCount: p3.boundaries?.length || 0,
    gapCount: p4.gaps?.length || 0,
    highGaps: p4.summary?.by_severity?.high || 0,
    criticalGaps: p4.summary?.by_severity?.critical || 0
  };
}

/**
 * 提取 Phase 3 摘要
 */
function extractPhase3Summary(phaseData: PhaseData | null | undefined): {
  threatCount: number;
  strideDistribution: Record<string, number>;
  verifiedRisks: number;
  theoreticalRisks: number;
  pocCount: number;
} {
  if (!phaseData?.data) {
    return {
      threatCount: 0,
      strideDistribution: { S: 0, T: 0, R: 0, I: 0, D: 0, E: 0 },
      verifiedRisks: 0,
      theoreticalRisks: 0,
      pocCount: 0
    };
  }

  const data = phaseData.data;
  const p5 = data.P5 || data;
  const p6 = data.P6 || data;

  return {
    threatCount: p5.summary?.total || p5.threats?.length || 0,
    strideDistribution: p5.summary?.by_stride || { S: 0, T: 0, R: 0, I: 0, D: 0, E: 0 },
    verifiedRisks: p6.risk_summary?.verified || 0,
    theoreticalRisks: p6.risk_summary?.theoretical || 0,
    pocCount: p6.poc_details?.length || 0
  };
}

/**
 * 格式化 STRIDE 分布
 */
function formatStrideDistribution(dist: Record<string, number>): string {
  return Object.entries(dist)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');
}

/**
 * 计算 DFD 元素总数
 */
function countDFDElements(dfdElements: any): number {
  if (!dfdElements) return 0;
  
  let count = 0;
  count += dfdElements.external_interactors?.length || 0;
  count += dfdElements.processes?.length || 0;
  count += dfdElements.data_stores?.length || 0;
  count += dfdElements.data_flows?.length || 0;
  
  return count;
}

/**
 * 构建节点执行提示词
 */
export function buildNodeExecutionPrompt(
  phaseNumber: number,
  phases: string[],
  upstreamData: Record<string, string>,
  skillPath: string
): string {
  const phaseName = getPhaseName(phaseNumber);

  return `
# Phase ${phaseNumber}: ${phaseName}

## 包含阶段
${phases.map(p => `- ${p}`).join('\n')}

## Skill 文件路径
${skillPath}

## 前序阶段输出
${Object.entries(upstreamData)
  .map(([key, yaml]) => `### ${key}\n\`\`\`yaml\n${yaml.substring(0, 500)}...\n\`\`\`\n`)
  .join('\n')}

## 执行要求
请按照 Skill 文件中的指导执行分析，并输出符合数据契约的 YAML 结果。

## 输出格式
请将结果写入:
outputs/phases/${phaseNumber}-${phaseName}/P${phaseNumber}_output.yaml
`;
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

export default {
  buildAgentZonePrompt,
  buildNodeExecutionPrompt,
};