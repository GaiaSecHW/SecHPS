/**
 * FSM 报告生成器
 * 
 * 聚合所有 FSM 阶段输出和 Agent Zone 结果，
 * 生成完整的威胁建模报告（8 个 Markdown 文件）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { prisma } from '@/lib/prisma';
import { scanWorkspaceReports, WorkspaceVulnerability } from '@/lib/workspace/report-scanner';

// 报告类型定义
export interface FSMReportData {
  sessionId: string;
  projectId: string;
  projectName: string;
  workflowType: 'fsm';
  fsmTemplate: string;
  generatedAt: Date;
  
  // Phase 输出摘要
  phaseOutputs: {
    P1?: Phase1Output;
    P2?: Phase2Output;
    P3?: Phase3Output;
    P4?: Phase4Output;
    P5?: Phase5Output;
    P6?: Phase6Output;
    P7?: Phase7Output;
  };
  
  // Agent Zone 结果
  agentResults: AgentZoneResult[];
  
  // Workspace 报告扫描结果
  workspaceVulnerabilities: WorkspaceVulnerability[];
  
  // 统计摘要
  summary: FSMReportSummary;
}

interface Phase1Output {
  projectContext: any;
  moduleInventory: any[];
  entryPointInventory: any[];
  techStack: string[];
}

interface Phase2Output {
  dfdElements: {
    externalInteractors: any[];
    processes: any[];
    dataStores: any[];
    dataFlows: any[];
  };
  elementMapping: any[];
  l1Coverage: number;
}

interface Phase3Output {
  boundaries: any[];
  zones: any[];
  elementZoneMapping: any[];
}

interface Phase4Output {
  designMatrix: Record<string, any>;
  gaps: any[];
  securityScore: number;
}

interface Phase5Output {
  threats: any[];
  threatSummary: {
    byStride: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  elementCoverage: number;
}

interface Phase6Output {
  riskDetails: any[];
  pocDetails: any[];
  riskSummary: {
    verified: number;
    theoretical: number;
    pending: number;
    excluded: number;
  };
}

interface Phase7Output {
  mitigations: any[];
  coverageVerification: number;
  implementationOrder: {
    priority_sequence?: any[];
    quick_wins?: any[];
    major_efforts?: any[];
    deferred_items?: any[];
  };
}

interface AgentZoneResult {
  agentId: string;
  agentName: string;
  tool: string;
  outputPath: string;
  findings: any[];
  status: 'completed' | 'failed' | 'pending';
}

interface FSMReportSummary {
  totalThreats: number;
  verifiedRisks: number;
  mitigations: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  agentFindings: number;
  workspaceFindings: number;
}

// 报告文件名
const REPORT_FILES = [
  'RISK-ASSESSMENT-REPORT.md',
  'RISK-INVENTORY.md',
  'MITIGATION-MEASURES.md',
  'PENETRATION-TEST-PLAN.md',
  'ARCHITECTURE-ANALYSIS.md',
  'DFD-DIAGRAM.md',
  'COMPLIANCE-REPORT.md',
  'ATTACK-PATH-VALIDATION.md',
];

/**
 * 生成 FSM 报告
 */
export async function generateFSMReport(
  sessionId: string,
  workspacePath: string
): Promise<FSMReportData> {
  // 1. 获取评估会话信息
  const session = await prisma.evaluationSession.findUnique({
    where: { id: sessionId },
    include: {
      Project: { select: { id: true, name: true, displayName: true } },
    },
  });

  if (!session) {
    throw new Error(`Evaluation session ${sessionId} not found`);
  }

  // 获取关联的 Workflow（如果有）
  let workflow = null;
  if (session.workflowId) {
    workflow = await prisma.workflow.findUnique({
      where: { id: session.workflowId },
      include: { FSMTemplate: true },
    });
  }

  // 2. 读取 Phase 输出
  const phaseOutputs = await readPhaseOutputs(workspacePath);

  // 3. 读取 Agent Zone 结果
  const agentResults = await readAgentZoneResults(workspacePath);

  // 4. 扫描 Workspace 报告
  const workspaceScanResult = await scanWorkspaceReports(workspacePath);

  // 5. 计算摘要
  const summary = calculateSummary(phaseOutputs, agentResults, workspaceScanResult.vulnerabilities);

  // 6. 构建报告数据
  const reportData: FSMReportData = {
    sessionId,
    projectId: session.projectId,
    projectName: session.Project?.displayName || session.Project?.name || 'Unknown',
    workflowType: 'fsm',
    fsmTemplate: workflow?.FSMTemplate?.name || 'threat-modeling',
    generatedAt: new Date(),
    phaseOutputs,
    agentResults,
    workspaceVulnerabilities: workspaceScanResult.vulnerabilities,
    summary,
  };

  // 7. 生成 Markdown 报告文件
  await generateReportFiles(reportData, workspacePath);

  // 8. 保存到数据库
  await saveReportToDatabase(reportData, workspacePath);

  return reportData;
}

/**
 * 读取 Phase 输出文件
 * 注意：使用 outputs/skills 替代 .claude/skills
 */
async function readPhaseOutputs(workspacePath: string): Promise<FSMReportData['phaseOutputs']> {
  const outputsPath = path.join(workspacePath, 'outputs', 'skills', 'threat-modeling', 'outputs');
  const phaseOutputs: FSMReportData['phaseOutputs'] = {};

  const phaseFiles = [
    { phase: 'P1', file: 'P1_project_context.yaml' },
    { phase: 'P2', file: 'P2_dfd_elements.yaml' },
    { phase: 'P3', file: 'P3_boundary_context.yaml' },
    { phase: 'P4', file: 'P4_security_gaps.yaml' },
    { phase: 'P5', file: 'P5_threat_inventory.yaml' },
    { phase: 'P6', file: 'P6_validated_risks.yaml' },
    { phase: 'P7', file: 'P7_mitigation_plan.yaml' },
  ];

  for (const { phase, file } of phaseFiles) {
    const filePath = path.join(outputsPath, file);
    
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = parseYaml(content);
        
        switch (phase) {
          case 'P1':
            phaseOutputs.P1 = {
              projectContext: data.P1_project_context?.project_context || data.project_context,
              moduleInventory: data.P1_project_context?.module_inventory?.modules || data.module_inventory?.modules || [],
              entryPointInventory: data.P1_project_context?.entry_point_inventory?.entry_points || data.entry_point_inventory?.entry_points || [],
              techStack: data.P1_project_context?.project_context?.tech_stack || [],
            };
            break;
          case 'P2':
            phaseOutputs.P2 = {
              dfdElements: data.P2_dfd_elements?.dfd_elements || data.dfd_elements || {},
              elementMapping: data.P2_dfd_elements?.element_mapping || [],
              l1Coverage: data.P2_dfd_elements?.l1_coverage?.coverage_percentage || data.l1_coverage?.coverage_percentage || 0,
            };
            break;
          case 'P3':
            phaseOutputs.P3 = {
              boundaries: data.P3_boundary_context?.boundaries || data.boundaries || [],
              zones: data.P3_boundary_context?.zones || data.zones || [],
              elementZoneMapping: data.P3_boundary_context?.element_zone_mapping || [],
            };
            break;
          case 'P4':
            phaseOutputs.P4 = {
              designMatrix: data.P4_security_gaps?.design_matrix || data.design_matrix || {},
              gaps: data.P4_security_gaps?.gaps || data.gaps || [],
              securityScore: data.P4_security_gaps?.security_score?.overall_score || data.security_score?.overall_score || 0,
            };
            break;
          case 'P5':
            phaseOutputs.P5 = {
              threats: data.P5_threat_inventory?.threats || data.threats || [],
              threatSummary: data.P5_threat_inventory?.threat_summary || data.threat_summary || {},
              elementCoverage: data.P5_threat_inventory?.element_coverage_verification?.coverage_percentage || 0,
            };
            break;
          case 'P6':
            phaseOutputs.P6 = {
              riskDetails: data.P6_validated_risks?.risk_details || data.risk_details || [],
              pocDetails: data.P6_validated_risks?.poc_details || data.poc_details || [],
              riskSummary: data.P6_validated_risks?.risk_summary || data.risk_summary || {},
            };
            break;
          case 'P7':
            phaseOutputs.P7 = {
              mitigations: data.P7_mitigation_plan?.mitigations || data.mitigations || [],
              coverageVerification: data.P7_mitigation_plan?.coverage_verification?.coverage_percentage || 0,
              implementationOrder: data.P7_mitigation_plan?.implementation_order?.priority_sequence || [],
            };
            break;
        }
      }
    } catch (err) {
      // 文件读取失败，继续处理其他文件
      console.warn(`Failed to read ${phase} output: ${err}`);
    }
  }

  return phaseOutputs;
}

/**
 * 读取 Agent Zone 结果
 */
async function readAgentZoneResults(workspacePath: string): Promise<AgentZoneResult[]> {
  const agentResults: AgentZoneResult[] = [];
  const vulnerabilitiesPath = path.join(workspacePath, 'vulnerabilities');

  if (!fs.existsSync(vulnerabilitiesPath)) {
    return agentResults;
  }

  const files = fs.readdirSync(vulnerabilitiesPath);

  for (const file of files) {
    if (file.endsWith('.json')) {
      const filePath = path.join(vulnerabilitiesPath, file);
      
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        // 提取 findings
        let findings: any[] = [];
        if (Array.isArray(data)) {
          findings = data;
        } else if (data.findings) {
          findings = data.findings;
        } else if (data.vulnerabilities) {
          findings = data.vulnerabilities;
        } else if (data.results) {
          findings = data.results;
        } else if (data.issues) {
          findings = data.issues;
        }

        agentResults.push({
          agentId: file.replace('.json', ''),
          agentName: extractAgentName(file),
          tool: extractToolName(file),
          outputPath: filePath,
          findings,
          status: 'completed',
        });
      } catch (err) {
        agentResults.push({
          agentId: file.replace('.json', ''),
          agentName: extractAgentName(file),
          tool: extractToolName(file),
          outputPath: filePath,
          findings: [],
          status: 'failed',
        });
      }
    }
  }

  return agentResults;
}

/**
 * 计算报告摘要
 */
function calculateSummary(
  phaseOutputs: FSMReportData['phaseOutputs'],
  agentResults: AgentZoneResult[],
  workspaceVulnerabilities: WorkspaceVulnerability[]
): FSMReportSummary {
  const threats = phaseOutputs.P5?.threats || [];
  const riskDetails = phaseOutputs.P6?.riskDetails || [];
  const mitigations = phaseOutputs.P7?.mitigations || [];

  // 统计严重性
  const criticalCount = threats.filter(t => t.severity === 'CRITICAL').length +
    workspaceVulnerabilities.filter(v => v.severity === 'critical').length;
  const highCount = threats.filter(t => t.severity === 'HIGH').length +
    workspaceVulnerabilities.filter(v => v.severity === 'high').length;
  const mediumCount = threats.filter(t => t.severity === 'MEDIUM').length +
    workspaceVulnerabilities.filter(v => v.severity === 'medium').length;
  const lowCount = threats.filter(t => t.severity === 'LOW').length +
    workspaceVulnerabilities.filter(v => v.severity === 'low').length;

  return {
    totalThreats: threats.length,
    verifiedRisks: riskDetails.filter(r => r.status === 'verified').length,
    mitigations: mitigations.length,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    agentFindings: agentResults.reduce((sum, r) => sum + r.findings.length, 0),
    workspaceFindings: workspaceVulnerabilities.length,
  };
}

/**
 * 生成报告文件
 * 注意：使用 outputs/skills 替代 .claude/skills
 */
async function generateReportFiles(reportData: FSMReportData, workspacePath: string): Promise<void> {
  const reportsPath = path.join(workspacePath, 'outputs', 'skills', 'threat-modeling', 'reports');
  
  // 创建报告目录
  if (!fs.existsSync(reportsPath)) {
    fs.mkdirSync(reportsPath, { recursive: true });
  }

  // 生成 8 个报告文件
  const reportGenerators: Record<string, () => string> = {
    'RISK-ASSESSMENT-REPORT.md': () => generateRiskAssessmentReport(reportData),
    'RISK-INVENTORY.md': () => generateRiskInventoryReport(reportData),
    'MITIGATION-MEASURES.md': () => generateMitigationReport(reportData),
    'PENETRATION-TEST-PLAN.md': () => generatePenTestPlan(reportData),
    'ARCHITECTURE-ANALYSIS.md': () => generateArchitectureAnalysis(reportData),
    'DFD-DIAGRAM.md': () => generateDfdDiagram(reportData),
    'COMPLIANCE-REPORT.md': () => generateComplianceReport(reportData),
    'ATTACK-PATH-VALIDATION.md': () => generateAttackPathValidation(reportData),
  };

  for (const [filename, generator] of Object.entries(reportGenerators)) {
    const filePath = path.join(reportsPath, filename);
    const content = generator();
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

/**
 * 生成主报告：风险评估报告
 */
function generateRiskAssessmentReport(data: FSMReportData): string {
  return `# Risk Assessment Report

## Executive Summary

**Project**: ${data.projectName}
**Analysis Type**: FSM Threat Modeling (${data.fsmTemplate})
**Generated**: ${data.generatedAt.toISOString()}

### Risk Overview

| Metric | Count |
|--------|-------|
| Total Threats Identified | ${data.summary.totalThreats} |
| Verified Risks | ${data.summary.verifiedRisks} |
| Mitigations Planned | ${data.summary.mitigations} |
| Critical | ${data.summary.criticalCount} |
| High | ${data.summary.highCount} |
| Medium | ${data.summary.mediumCount} |
| Low | ${data.summary.lowCount} |

### Overall Risk Level: ${calculateOverallRiskLevel(data.summary)}

---

## Key Findings

### Threat Analysis Summary (Phase 5-6)

${generateThreatSummaryTable(data.phaseOutputs.P5)}

### Security Design Gaps (Phase 4)

${generateGapsSummary(data.phaseOutputs.P4)}

---

## Agent Zone Results

${generateAgentResultsSection(data.agentResults)}

---

## External Tool Findings

${generateWorkspaceFindingsSection(data.workspaceVulnerabilities)}

---

## Recommendations

### Immediate Actions (P0/P1)

${generatePriorityActions(data.phaseOutputs.P6, data.phaseOutputs.P7)}

### Quick Wins

${generateQuickWins(data.phaseOutputs.P7)}

---

## Conclusion

This report summarizes the threat modeling analysis conducted for ${data.projectName}.
${generateConclusionText(data)}

---

*Generated by FSM Threat Modeling Workflow*
`;
}

/**
 * 生成风险清单报告
 */
function generateRiskInventoryReport(data: FSMReportData): string {
  const risks = data.phaseOutputs.P6?.riskDetails || [];
  
  return `# Risk Inventory

**Project**: ${data.projectName}
**Generated**: ${data.generatedAt.toISOString()}

---

## Verified Risks

| ID | Threat Ref | CVSS | Priority | Status |
|-----|-----------|------|----------|--------|
${risks.filter(r => r.status === 'verified').map(r => 
  `| ${r.id} | ${r.threat_ref || 'N/A'} | ${r.cvss_score || 'N/A'} | ${r.priority || 'N/A'} | ${r.status} |`
).join('\n')}

---

## Theoretical Risks

| ID | Threat Ref | Description | CVSS |
|-----|-----------|-------------|------|
${risks.filter(r => r.status === 'theoretical').map(r => 
  `| ${r.id} | ${r.threat_ref || 'N/A'} | ${r.description || r.title || 'N/A'} | ${r.cvss_score || 'N/A'} |`
).join('\n')}

---

## Pending Validation

${risks.filter(r => r.status === 'pending').map(r => 
  `- **${r.id}**: ${r.description || r.title || 'Pending validation'}`
).join('\n') || 'No pending risks'}

---

## Excluded Risks

${risks.filter(r => r.status === 'excluded').map(r => 
  `- **${r.id}**: ${r.description || r.title || 'Excluded'} (Reason: not applicable or mitigated)`
).join('\n') || 'No excluded risks'}

---

*Generated by FSM Threat Modeling Workflow*
`;
}

/**
 * 生成缓解措施报告
 */
function generateMitigationReport(data: FSMReportData): string {
  const mitigations = data.phaseOutputs.P7?.mitigations || [];
  
  return `# Mitigation Measures

**Project**: ${data.projectName}
**Generated**: ${data.generatedAt.toISOString()}

---

## Mitigation Summary

| ID | Risk Ref | Type | Effectiveness | Complexity |
|------|----------|------|---------------|------------|
${mitigations.map(m => 
  `| ${m.id} | ${m.risk_ref || 'N/A'} | ${m.mitigation_type || 'N/A'} | ${m.effectiveness || 'N/A'} | ${m.complexity || 'N/A'} |`
).join('\n')}

---

## Implementation Details

${mitigations.map(m => `
### ${m.id}: ${m.title || m.id}

**Risk Reference**: ${m.risk_ref || 'N/A'}
**Type**: ${m.mitigation_type || 'N/A'}

**Description**: 
${m.description || 'No description provided'}

**Implementation**:
${m.implementation?.details || 'Implementation details pending'}

**Testing**:
${m.testing?.test_cases?.map((tc: any) => `- ${tc.description}`).join('\n') || 'Test cases pending'}

---
`).join('\n')}

---

## Implementation Priority

${generateImplementationOrder(data.phaseOutputs.P7)}

---

*Generated by FSM Threat Modeling Workflow*
`;
}

/**
 * 生成渗透测试计划
 */
function generatePenTestPlan(data: FSMReportData): string {
  const pocs = data.phaseOutputs.P6?.pocDetails || [];
  
  return `# Penetration Test Plan

**Project**: ${data.projectName}
**Generated**: ${data.generatedAt.toISOString()}

---

## POC Details

${pocs.map(poc => `
### ${poc.id}: ${poc.title || poc.id}

**Risk Reference**: ${poc.risk_ref || 'N/A'}

**Description**:
${poc.description || 'No description'}

**POC Type**: ${poc.poc_type || 'N/A'}

**Steps**:
${poc.poc_steps?.map((s: any) => `${s.step}. ${s.action} (Expected: ${s.expected_result})`).join('\n') || 'Steps pending'}

**Prerequisites**:
${poc.prerequisites?.map((p: any) => `- ${p}`).join('\n') || 'None'}

**Tools Required**:
${poc.tools_required?.map((t: any) => `- ${t}`).join('\n') || 'Standard tools'}

---
`).join('\n') || 'No POCs available'}

---

## Test Sequence

1. **Authentication Testing** - Test authentication mechanisms
2. **Authorization Testing** - Test access control
3. **Input Validation Testing** - Test injection vulnerabilities
4. **Session Management Testing** - Test session handling
5. **Data Protection Testing** - Test data exposure

---

*Generated by FSM Threat Modeling Workflow*
`;
}

/**
 * 生成架构分析报告
 */
function generateArchitectureAnalysis(data: FSMReportData): string {
  const p1 = data.phaseOutputs.P1;
  const p2 = data.phaseOutputs.P2;
  const p3 = data.phaseOutputs.P3;
  const p4 = data.phaseOutputs.P4;
  
  return `# Architecture Analysis

**Project**: ${data.projectName}
**Generated**: ${data.generatedAt.toISOString()}

---

## System Overview

### Project Context
- **Project Type**: ${p1?.projectContext?.project_type || 'N/A'}
- **Tech Stack**: ${p1?.techStack?.join(', ') || 'N/A'}

### Module Inventory

| Module ID | Name | Security Level |
|-----------|------|----------------|
${p1?.moduleInventory?.map(m => `| ${m.id} | ${m.name} | ${m.security_level || 'N/A'} |`).join('\n') || 'No modules identified'}

---

## Entry Points Analysis

| Entry Point ID | Type | Auth Required | Security Sensitive |
|----------------|------|---------------|-------------------|
${p1?.entryPointInventory?.map(ep => `| ${ep.id} | ${ep.type} | ${ep.auth_required ? 'Yes' : 'No'} | ${ep.security_sensitive ? 'Yes' : 'No'} |`).join('\n') || 'No entry points identified'}

---

## Trust Boundaries

| Boundary ID | Type | Source Zone | Destination Zone |
|-------------|------|-------------|------------------|
${p3?.boundaries?.map(b => `| ${b.id} | ${b.type} | ${b.source_zone || 'N/A'} | ${b.destination_zone || 'N/A'} |`).join('\n') || 'No boundaries identified'}

---

## Security Design Review

### Design Matrix Score: ${p4?.securityScore || 0}/100

### Security Gaps Identified

${p4?.gaps?.map(g => `- **${g.id}** (${g.severity}): ${g.title} - ${g.domain}`).join('\n') || 'No gaps identified'}

---

*Generated by FSM Threat Modeling Workflow*
`;
}

/**
 * 生成 DFD 图表报告
 */
function generateDfdDiagram(data: FSMReportData): string {
  const p2 = data.phaseOutputs.P2;
  const p3 = data.phaseOutputs.P3;
  
  return `# Data Flow Diagram

**Project**: ${data.projectName}
**Generated**: ${data.generatedAt.toISOString()}

---

## DFD Elements

### External Interactors

| ID | Name | Type |
|----|------|------|
${p2?.dfdElements?.externalInteractors?.map(e => `| ${e.id} | ${e.name} | ${e.type} |`).join('\n') || 'None'}

### Processes

| ID | Name | Security Level |
|----|------|----------------|
${p2?.dfdElements?.processes?.map(p => `| ${p.id} | ${p.name} | ${p.security_level || 'N/A'} |`).join('\n') || 'None'}

### Data Stores

| ID | Name | Sensitivity | Encryption |
|----|------|-------------|------------|
${p2?.dfdElements?.dataStores?.map(d => `| ${d.id} | ${d.name} | ${d.sensitivity || 'N/A'} | ${d.encryption ? 'Yes' : 'No'} |`).join('\n') || 'None'}

### Data Flows

| ID | Name | Source | Destination | Protocol |
|----|------|--------|-------------|----------|
${p2?.dfdElements?.dataFlows?.map(f => `| ${f.id} | ${f.name} | ${f.source} | ${f.destination} | ${f.protocol || 'N/A'} |`).join('\n') || 'None'}

---

## Trust Boundary Zones

### Zone Map

${p3?.zones?.map(z => `
#### ${z.id}: ${z.name}
- **Trust Level**: ${z.trust_level}
- **Elements**: ${z.elements?.length || 0}
`).join('\n') || 'No zones defined'}

---

## Mermaid Diagram

\`\`\`mermaid
graph TD
    ${generateMermaidNodes(p2?.dfdElements)}
\`\`\`

---

*Generated by FSM Threat Modeling Workflow*
`;
}

/**
 * 生成合规报告
 */
function generateComplianceReport(data: FSMReportData): string {
  const threats = data.phaseOutputs.P5?.threats || [];
  const gaps = data.phaseOutputs.P4?.gaps || [];
  
  // 统计 OWASP Top 10 覆盖
  const owaspMapping: Record<string, number> = {};
  for (const threat of threats) {
    const owasp = threat.owasp_ref || 'A99';
    owaspMapping[owasp] = (owaspMapping[owasp] || 0) + 1;
  }
  
  return `# Compliance Report

**Project**: ${data.projectName}
**Generated**: ${data.generatedAt.toISOString()}

---

## OWASP Top 10 Coverage

| OWASP Category | Findings | Status |
|----------------|----------|--------|
| A01: Broken Access Control | ${owaspMapping['A01'] || 0} | ${owaspMapping['A01'] ? 'Issues Found' : 'Passed'} |
| A02: Cryptographic Failures | ${owaspMapping['A02'] || 0} | ${owaspMapping['A02'] ? 'Issues Found' : 'Passed'} |
| A03: Injection | ${owaspMapping['A03'] || 0} | ${owaspMapping['A03'] ? 'Issues Found' : 'Passed'} |
| A04: Insecure Design | ${owaspMapping['A04'] || 0} | ${owaspMapping['A04'] ? 'Issues Found' : 'Passed'} |
| A05: Security Misconfiguration | ${owaspMapping['A05'] || 0} | ${owaspMapping['A05'] ? 'Issues Found' : 'Passed'} |
| A06: Vulnerable Components | ${owaspMapping['A06'] || 0} | ${owaspMapping['A06'] ? 'Issues Found' : 'Passed'} |
| A07: Auth Failures | ${owaspMapping['A07'] || 0} | ${owaspMapping['A07'] ? 'Issues Found' : 'Passed'} |
| A08: Software Integrity | ${owaspMapping['A08'] || 0} | ${owaspMapping['A08'] ? 'Issues Found' : 'Passed'} |
| A09: Logging Failures | ${owaspMapping['A09'] || 0} | ${owaspMapping['A09'] ? 'Issues Found' : 'Passed'} |
| A10: SSRF | ${owaspMapping['A10'] || 0} | ${owaspMapping['A10'] ? 'Issues Found' : 'Passed'} |

---

## CWE Coverage

| CWE | Count | Description |
|-----|-------|-------------|
${generateCweTable(threats)}

---

## Security Domains Assessment

| Domain | Score | Gaps |
|--------|-------|------|
${generateDomainAssessment(data.phaseOutputs.P4)}

---

*Generated by FSM Threat Modeling Workflow*
`;
}

/**
 * 生成攻击路径验证报告
 */
function generateAttackPathValidation(data: FSMReportData): string {
  const verifiedRisks = data.phaseOutputs.P6?.riskDetails?.filter(r => r.status === 'verified') || [];
  
  return `# Attack Path Validation

**Project**: ${data.projectName}
**Generated**: ${data.generatedAt.toISOString()}

---

## Validated Attack Paths

${verifiedRisks.map(r => `
### ${r.id}

**Attack Path**: ${r.attack_path || 'N/A'}
**CVSS Score**: ${r.cvss_score || 'N/A'}
**Priority**: ${r.priority || 'N/A'}

**Affected Components**: 
${r.affected_components?.map((c: any) => `- ${c}`).join('\n') || 'Not specified'}

**Existing Mitigations**:
${r.existing_mitigations?.map((m: any) => `- ${m.measure} (Effectiveness: ${m.effectiveness})`).join('\n') || 'None identified'}

---
`).join('\n') || 'No validated attack paths'}

---

## Unverified Paths (Theoretical)

${data.phaseOutputs.P6?.riskDetails?.filter((r: any) => r.status === 'theoretical').map((r: any) => 
  `- **${r.id}**: ${r.attack_path || r.description || 'Theoretical path'}`
).join('\n') || 'No theoretical paths'}

---

## Validation Coverage

- **Verified**: ${data.phaseOutputs.P6?.riskSummary?.verified || 0}
- **Theoretical**: ${data.phaseOutputs.P6?.riskSummary?.theoretical || 0}
- **Pending**: ${data.phaseOutputs.P6?.riskSummary?.pending || 0}
- **Excluded**: ${data.phaseOutputs.P6?.riskSummary?.excluded || 0}

---

*Generated by FSM Threat Modeling Workflow*
`;
}

// ============ 辅助生成函数 ============

function extractAgentName(file: string): string {
  const name = file.replace('-report.json', '').replace('.json', '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function extractToolName(file: string): string {
  if (file.includes('sast')) return 'Semgrep';
  if (file.includes('secrets')) return 'TruffleHog';
  if (file.includes('dependency')) return 'Snyk';
  return 'Custom';
}

function calculateOverallRiskLevel(summary: FSMReportSummary): string {
  if (summary.criticalCount > 0) return 'CRITICAL';
  if (summary.highCount > 3) return 'HIGH';
  if (summary.highCount > 0 || summary.mediumCount > 5) return 'MEDIUM';
  return 'LOW';
}

function generateThreatSummaryTable(p5: Phase5Output | undefined): string {
  if (!p5?.threatSummary) return 'No threat summary available';
  
  const byStride = p5.threatSummary.byStride || {};
  return `
| STRIDE Category | Count |
|-----------------|-------|
| Spoofing (S) | ${byStride['S'] || 0} |
| Tampering (T) | ${byStride['T'] || 0} |
| Repudiation (R) | ${byStride['R'] || 0} |
| Information Disclosure (I) | ${byStride['I'] || 0} |
| Denial of Service (D) | ${byStride['D'] || 0} |
| Elevation of Privilege (E) | ${byStride['E'] || 0} |
`;
}

function generateGapsSummary(p4: Phase4Output | undefined): string {
  if (!p4?.gaps || p4.gaps.length === 0) return 'No significant gaps identified';
  
  return p4.gaps.slice(0, 10).map(g => 
    `- **${g.severity}**: ${g.title} (${g.domain})`
  ).join('\n');
}

function generateAgentResultsSection(agentResults: AgentZoneResult[]): string {
  if (agentResults.length === 0) return 'No agent scan results available';
  
  return agentResults.map(r => `
### ${r.agentName} (${r.tool})
- **Status**: ${r.status}
- **Findings**: ${r.findings.length}
`).join('\n');
}

function generateWorkspaceFindingsSection(vulns: WorkspaceVulnerability[]): string {
  if (vulns.length === 0) return 'No external tool findings detected';
  
  const byTool: Record<string, number> = {};
  for (const v of vulns) {
    byTool[v.sourceTool] = (byTool[v.sourceTool] || 0) + 1;
  }
  
  return Object.entries(byTool).map(([tool, count]) => 
    `- **${tool}**: ${count} findings`
  ).join('\n');
}

function generatePriorityActions(p6: Phase6Output | undefined, p7: Phase7Output | undefined): string {
  const p0Risks = p6?.riskDetails?.filter(r => r.priority === 'P0') || [];
  const p1Risks = p6?.riskDetails?.filter(r => r.priority === 'P1') || [];
  
  return `
#### P0 (Immediate)
${p0Risks.map(r => `- ${r.id}: ${r.attack_path || r.description}`).join('\n') || 'None'}

#### P1 (High Priority)
${p1Risks.map(r => `- ${r.id}: ${r.attack_path || r.description}`).join('\n') || 'None'}
`;
}

function generateQuickWins(p7: Phase7Output | undefined): string {
  const quickWins = p7?.implementationOrder?.quick_wins || [];
  if (quickWins.length === 0) return 'No quick wins identified';
  
  return quickWins.map(q => `- ${q}`).join('\n');
}

function generateImplementationOrder(p7: Phase7Output | undefined): string {
  if (!p7?.implementationOrder) return 'Implementation order pending';
  
  return `
1. **Quick Wins** - Low complexity, high effectiveness
2. **Major Efforts** - High complexity, high effectiveness
3. **Deferred Items** - Low priority or high complexity
`;
}

function generateConclusionText(data: FSMReportData): string {
  const level = calculateOverallRiskLevel(data.summary);
  const mitigationCoverage = data.phaseOutputs.P7?.coverageVerification || 0;
  
  if (level === 'CRITICAL') {
    return 'Critical security issues were identified. Immediate remediation is required before production deployment.';
  } else if (level === 'HIGH') {
    return 'High-risk vulnerabilities require prioritized attention. A remediation plan has been developed.';
  } else if (mitigationCoverage < 50) {
    return 'Several security concerns were identified. Consider implementing the recommended mitigations.';
  } else {
    return 'The system has a reasonable security posture. Continue monitoring and periodic reassessment.';
  }
}

function generateCweTable(threats: any[]): string {
  const cweCounts: Record<string, number> = {};
  for (const t of threats) {
    if (t.cwe_ref) {
      cweCounts[t.cwe_ref] = (cweCounts[t.cwe_ref] || 0) + 1;
    }
  }
  
  return Object.entries(cweCounts).map(([cwe, count]) => 
    `| ${cwe} | ${count} | Security weakness |`
  ).join('\n') || '| N/A | 0 | No CWE references |';
}

function generateDomainAssessment(p4: Phase4Output | undefined): string {
  if (!p4?.designMatrix) return '| N/A | N/A | N/A |';
  
  return Object.entries(p4.designMatrix).slice(0, 8).map(([domain, data]) => 
    `| ${domain} | ${data.score || 'N/A'} | ${data.gaps?.length || 0} |`
  ).join('\n');
}

function generateMermaidNodes(dfdElements: any): string {
  if (!dfdElements) return 'No DFD elements';
  
  const nodes: string[] = [];
  
  // External Interactors
  for (const ei of dfdElements.externalInteractors || []) {
    nodes.push(`EI_${ei.id}[${ei.name}]`);
  }
  
  // Processes
  for (const p of dfdElements.processes || []) {
    nodes.push(`P_${p.id}(${p.name})`);
  }
  
  // Data Stores
  for (const ds of dfdElements.dataStores || []) {
    nodes.push(`DS_${ds.id}[(${ds.name})]`);
  }
  
  return nodes.join('\n    ');
}

/**
 * 保存报告到数据库
 * 注意：使用 outputs/skills 替代 .claude/skills
 */
async function saveReportToDatabase(reportData: FSMReportData, workspacePath: string): Promise<void> {
  const reportsPath = path.join(workspacePath, 'outputs', 'skills', 'threat-modeling', 'reports');
  
  // 读取主报告内容
  const mainReportPath = path.join(reportsPath, 'RISK-ASSESSMENT-REPORT.md');
  const mainReportContent = fs.existsSync(mainReportPath) 
    ? fs.readFileSync(mainReportPath, 'utf-8')
    : '';

  // 创建或更新 Report 记录
  await prisma.report.upsert({
    where: { sessionId: reportData.sessionId },
    create: {
      id: `report-${reportData.sessionId}`,
      sessionId: reportData.sessionId,
      projectId: reportData.projectId,
      reportType: 'fsm',
      workflowType: 'fsm',
      fsmTemplate: reportData.fsmTemplate,
      title: `Threat Modeling Report - ${reportData.projectName}`,
      description: `FSM Threat Modeling analysis for ${reportData.projectName}`,
      mainReportPath: mainReportPath,
      mainReportContent: mainReportContent,
      totalFindings: reportData.summary.totalThreats + reportData.summary.agentFindings + reportData.summary.workspaceFindings,
      criticalCount: reportData.summary.criticalCount,
      highCount: reportData.summary.highCount,
      mediumCount: reportData.summary.mediumCount,
      lowCount: reportData.summary.lowCount,
      dataSources: JSON.stringify({
        phaseOutputs: Object.keys(reportData.phaseOutputs),
        agentResults: reportData.agentResults.map(a => a.agentId),
        workspaceReports: reportData.workspaceVulnerabilities.length,
      }),
      integratedReports: JSON.stringify({
        riskInventory: `${reportsPath}/RISK-INVENTORY.md`,
        mitigationMeasures: `${reportsPath}/MITIGATION-MEASURES.md`,
        penTestPlan: `${reportsPath}/PENETRATION-TEST-PLAN.md`,
        architectureAnalysis: `${reportsPath}/ARCHITECTURE-ANALYSIS.md`,
        dfdDiagram: `${reportsPath}/DFD-DIAGRAM.md`,
        complianceReport: `${reportsPath}/COMPLIANCE-REPORT.md`,
        attackPathValidation: `${reportsPath}/ATTACK-PATH-VALIDATION.md`,
      }),
      status: 'generated',
      generatedAt: reportData.generatedAt,
      updatedAt: new Date(),
    },
    update: {
      mainReportPath: mainReportPath,
      mainReportContent: mainReportContent,
      totalFindings: reportData.summary.totalThreats + reportData.summary.agentFindings + reportData.summary.workspaceFindings,
      criticalCount: reportData.summary.criticalCount,
      highCount: reportData.summary.highCount,
      mediumCount: reportData.summary.mediumCount,
      lowCount: reportData.summary.lowCount,
      dataSources: JSON.stringify({
        phaseOutputs: Object.keys(reportData.phaseOutputs),
        agentResults: reportData.agentResults.map(a => a.agentId),
        workspaceReports: reportData.workspaceVulnerabilities.length,
      }),
      status: 'generated',
      generatedAt: reportData.generatedAt,
    },
  });
}

/**
 * FSMReportGenerator 类
 * 用于 FSMWorkflowExecutionService 调用
 */
export class FSMReportGenerator {
  private sessionId: string;
  private projectId: string;
  private workspacePath: string;

  constructor(sessionId: string, projectId: string, workspacePath: string) {
    this.sessionId = sessionId;
    this.projectId = projectId;
    this.workspacePath = workspacePath;
  }

  /**
   * 生成所有报告
   * @param phaseResults FSM 阶段执行结果
   * @param agentZoneResults Agent Zone 执行结果
   * @returns 生成的报告文件路径列表
   */
  async generateAllReports(
    phaseResults: Array<{
      phaseNumber: number;
      phaseName: string;
      outputYaml: string;
      outputPath: string;
    }>,
    agentZoneResults: Array<{
      agentName: string;
      agentType: string;
      outputPath: string;
      vulnerabilitiesFound: number;
    }>
  ): Promise<string[]> {
    const reports: string[] = [];

    // 使用 generateFSMReport 生成完整报告
    const reportData = await generateFSMReport(this.sessionId, this.workspacePath);

    // 收集生成的报告文件
    const reportsPath = path.join(this.workspacePath, '.claude', 'skills', 'threat-modeling', 'reports');
    
    if (fs.existsSync(reportsPath)) {
      for (const reportFile of REPORT_FILES) {
        const filePath = path.join(reportsPath, reportFile);
        if (fs.existsSync(filePath)) {
          reports.push(filePath);
        }
      }
    }

    return reports;
  }
}

export default {
  generateFSMReport,
  FSMReportGenerator,
};