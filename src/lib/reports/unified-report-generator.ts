/**
 * Unified Markdown Report Generator
 * 
 * Generates a unified Markdown report for both DAG and FSM workflows,
 * including vulnerability summary, execution process summary, loaded Skills,
 * Skill execution duration, and problem counts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '@/lib/prisma';
import { scanWorkspaceReports, WorkspaceVulnerability } from '@/lib/workspace/report-scanner';

// ============ Type Definitions ============

export interface UnifiedReportConfig {
  evaluationId: string;
  projectId: string;
  projectName: string;
  workflowType: 'dag' | 'fsm';
  workspacePath: string;
}

export interface NodeExecutionSummary {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  status: string;
  modelName?: string;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number; // milliseconds
  inputTokens?: number;
  outputTokens?: number;
}

export interface SkillStatistics {
  skillId: string;
  skillName: string;
  executionCount: number;
  totalDuration: number; // milliseconds
  avgDuration: number;
  findingsCount: number;
  confirmedCount: number;
  falsePositiveCount: number;
  successRate?: number;
}

export interface VulnerabilitySummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  byType: Record<string, number>;
  bySkill: Record<string, number>;
}

export interface VulnerabilityDetail {
  id: string;
  title: string;
  type: string;
  severity: string;
  cwe?: string;
  skill?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  description?: string;
  status: string;
  source: 'database' | 'workspace';
}

export interface UnifiedReportData {
  sessionId: string;
  projectId: string;
  projectName: string;
  workflowType: 'dag' | 'fsm';
  generatedAt: Date;
  
  // Execution summary
  nodeExecutions: NodeExecutionSummary[];
  totalDuration: number; // milliseconds
  totalInputTokens: number;
  totalOutputTokens: number;
  
  // Skill statistics
  skillStats: SkillStatistics[];
  
  // Vulnerability summary
  vulnerabilitySummary: VulnerabilitySummary;
  vulnerabilities: VulnerabilityDetail[];
  
  // Additional metadata
  fsmTemplate?: string;
  phaseOutputs?: string[];
  agentResults?: string[];
}

// ============ Main Functions ============

/**
 * Generate unified report data from evaluation session
 */
export async function generateUnifiedReport(
  config: UnifiedReportConfig
): Promise<UnifiedReportData> {
  const { evaluationId, projectId, projectName, workflowType, workspacePath } = config;
  
  // 1. Get evaluation session info
  const session = await prisma.evaluationSession.findUnique({
    where: { id: evaluationId },
    include: {
      Project: { select: { id: true, name: true, displayName: true } },
      Workflow: { include: { FSMTemplate: true } },
    },
  });
  
  if (!session) {
    throw new Error(`Evaluation session ${evaluationId} not found`);
  }
  
  // 2. Get NodeExecution records
  const nodeExecutions = await getNodeExecutionSummaries(evaluationId);
  
  // 3. Get SkillExecution records
  const skillStats = await getSkillStatistics(evaluationId, projectId);
  
  // 4. Get Vulnerability records from database
  const dbVulnerabilities = await getVulnerabilitiesFromDatabase(evaluationId, projectId);
  
  // 5. Scan workspace for vulnerabilities.json and other reports
  const workspaceVulnerabilities = await scanWorkspaceVulnerabilities(workspacePath);
  
  // 6. Merge vulnerabilities
  const allVulnerabilities = mergeVulnerabilities(dbVulnerabilities, workspaceVulnerabilities);
  
  // 7. Calculate vulnerability summary
  const vulnerabilitySummary = calculateVulnerabilitySummary(allVulnerabilities);
  
  // 8. Calculate totals
  const totalDuration = nodeExecutions.reduce((sum, n) => sum + (n.duration || 0), 0);
  const totalInputTokens = session.totalInputTokens || 
    nodeExecutions.reduce((sum, n) => sum + (n.inputTokens || 0), 0);
  const totalOutputTokens = session.totalOutputTokens ||
    skillStats.reduce((sum, s) => sum + (s.executionCount * (s.avgDuration || 0)), 0);
  
  // 9. Get FSM-specific data if applicable
  let fsmTemplate: string | undefined;
  let phaseOutputs: string[] | undefined;
  let agentResults: string[] | undefined;
  
  if (workflowType === 'fsm' && session.workflowId) {
    // Query Workflow separately since EvaluationSession doesn't have Workflow relation
    const workflow = await prisma.workflow.findUnique({
      where: { id: session.workflowId },
      include: { FSMTemplate: true },
    });
    fsmTemplate = workflow?.FSMTemplate?.name || 'threat-modeling';
    
    // Get PhaseOutput records
    const phases = await prisma.phaseOutput.findMany({
      where: { sessionId: evaluationId },
      select: { phaseName: true, outputPath: true },
    });
    phaseOutputs = phases.map(p => p.outputPath);
    
    // Read agent zone results from workspace
    agentResults = await readAgentZoneResultPaths(workspacePath);
  }
  
  // 10. Build report data
  const reportData: UnifiedReportData = {
    sessionId: evaluationId,
    projectId: projectId,
    projectName: projectName,
    workflowType: workflowType,
    generatedAt: new Date(),
    nodeExecutions,
    totalDuration,
    totalInputTokens,
    totalOutputTokens,
    skillStats,
    vulnerabilitySummary,
    vulnerabilities: allVulnerabilities,
    fsmTemplate,
    phaseOutputs,
    agentResults,
  };
  
  return reportData;
}

/**
 * Save unified report to workspace and database
 */
export async function saveUnifiedReport(
  reportData: UnifiedReportData,
  workspacePath: string
): Promise<string> {
  // 1. Generate Markdown content
  const markdownContent = generateMarkdownReport(reportData);
  
  // 2. Write to workspace - 使用 outputs/reports 替代 .claude/reports
  const reportsDir = path.join(workspacePath, 'outputs', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  const reportFilePath = path.join(reportsDir, 'EVALUATION-REPORT.md');
  fs.writeFileSync(reportFilePath, markdownContent, 'utf-8');
  
  // 3. Save to database Report model
  await saveReportToDatabase(reportData, reportFilePath, markdownContent);
  
  return reportFilePath;
}

// ============ Helper Functions ============

/**
 * Get NodeExecution summaries from database
 */
async function getNodeExecutionSummaries(evaluationId: string): Promise<NodeExecutionSummary[]> {
  const executions = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evaluationId },
    orderBy: { order: 'asc' },
    include: {
      ModelConfig: { select: { name: true } },
    },
  });
  
  return executions.map(exec => ({
    nodeId: exec.workflowNodeId,
    nodeLabel: exec.nodeLabel,
    nodeType: exec.nodeType,
    status: exec.status,
    modelName: exec.modelName || exec.ModelConfig?.name,
    startedAt: exec.startedAt ?? undefined,
    completedAt: exec.completedAt ?? undefined,
    duration: exec.startedAt && exec.completedAt
      ? exec.completedAt.getTime() - exec.startedAt.getTime()
      : undefined,
    inputTokens: undefined, // NodeExecution doesn't have token fields directly
    outputTokens: undefined,
  }));
}

/**
 * Get Skill statistics from database
 */
async function getSkillStatistics(
  evaluationId: string,
  projectId: string
): Promise<SkillStatistics[]> {
  const skillExecutions = await prisma.skillExecution.findMany({
    where: {
      evaluationId: evaluationId,
      projectId: projectId,
    },
    include: {
      Skill: { select: { id: true, name: true, displayName: true } },
    },
  });
  
  // Group by skill
  const skillMap = new Map<string, SkillStatistics>();
  
  for (const exec of skillExecutions) {
    const skillId = exec.skillId;
    const skillName = exec.Skill?.displayName || exec.Skill?.name || skillId;
    
    if (!skillMap.has(skillId)) {
      skillMap.set(skillId, {
        skillId,
        skillName,
        executionCount: 0,
        totalDuration: 0,
        avgDuration: 0,
        findingsCount: 0,
        confirmedCount: 0,
        falsePositiveCount: 0,
      });
    }
    
    const stats = skillMap.get(skillId)!;
    stats.executionCount++;
    stats.totalDuration += exec.duration || 0;
    stats.findingsCount += exec.findingsCount || 0;
    stats.confirmedCount += exec.confirmedCount || 0;
    stats.falsePositiveCount += exec.falsePositiveCount || 0;
  }
  
  // Calculate averages
  for (const stats of skillMap.values()) {
    stats.avgDuration = stats.executionCount > 0
      ? Math.round(stats.totalDuration / stats.executionCount)
      : 0;
    
    const totalClassified = stats.confirmedCount + stats.falsePositiveCount;
    stats.successRate = totalClassified > 0
      ? stats.confirmedCount / totalClassified
      : undefined;
  }
  
  return Array.from(skillMap.values());
}

/**
 * Get vulnerabilities from database
 */
async function getVulnerabilitiesFromDatabase(
  evaluationId: string,
  projectId: string
): Promise<VulnerabilityDetail[]> {
  const vulnerabilities = await prisma.vulnerability.findMany({
    where: {
      evaluationId: evaluationId,
      projectId: projectId,
    },
    orderBy: { createdAt: 'desc' },
  });
  
  return vulnerabilities.map(v => ({
    id: v.id,
    title: v.title,
    type: v.type,
    severity: v.severity,
    cwe: v.cwe ?? undefined,
    skill: v.skill ?? undefined,
    filePath: v.filePath ?? undefined,
    lineStart: v.lineStart ?? undefined,
    lineEnd: v.lineEnd ?? undefined,
    description: v.description,
    status: v.status,
    source: 'database',
  }));
}

/**
 * Scan workspace for vulnerabilities
 */
async function scanWorkspaceVulnerabilities(
  workspacePath: string
): Promise<VulnerabilityDetail[]> {
  // First, try to read vulnerabilities.json directly
  const vulnsJsonPath = path.join(workspacePath, 'vulnerabilities.json');
  const vulnerabilities: VulnerabilityDetail[] = [];
  
  if (fs.existsSync(vulnsJsonPath)) {
    try {
      const content = fs.readFileSync(vulnsJsonPath, 'utf-8');
      const data = JSON.parse(content);
      
      const items = Array.isArray(data) ? data :
        (data.vulnerabilities || data.findings || data.issues || []);
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (typeof item === 'object') {
          vulnerabilities.push({
            id: item.id || `ws-vuln-${i}`,
            title: item.title || item.name || 'Workspace Finding',
            type: item.type || 'Vulnerability',
            severity: normalizeSeverity(item.severity || item.risk || 'medium'),
            cwe: item.cwe || item.CWE,
            skill: item.skill || item.skillName,
            filePath: item.filePath || item.file || item.path,
            lineStart: item.lineStart || item.line,
            lineEnd: item.lineEnd || item.endLine,
            description: item.description || item.details,
            status: item.status || 'new',
            source: 'workspace',
          });
        }
      }
    } catch (err) {
      console.warn(`Failed to parse vulnerabilities.json: ${err}`);
    }
  }
  
  // Also scan for other report files
  const scanResult = await scanWorkspaceReports(workspacePath);
  
  for (const wsVuln of scanResult.vulnerabilities) {
    // Avoid duplicates
    const exists = vulnerabilities.some(v =>
      v.title === wsVuln.title && v.filePath === wsVuln.filePath
    );
    
    if (!exists) {
      vulnerabilities.push({
        id: wsVuln.id,
        title: wsVuln.title,
        type: wsVuln.type,
        severity: wsVuln.severity,
        cwe: wsVuln.cwe,
        skill: wsVuln.sourceTool,
        filePath: wsVuln.filePath,
        lineStart: wsVuln.lineStart,
        lineEnd: wsVuln.lineEnd,
        description: wsVuln.description,
        status: 'new',
        source: 'workspace',
      });
    }
  }
  
  return vulnerabilities;
}

/**
 * Merge vulnerabilities from different sources
 */
function mergeVulnerabilities(
  dbVulns: VulnerabilityDetail[],
  wsVulns: VulnerabilityDetail[]
): VulnerabilityDetail[] {
  // Start with database vulnerabilities
  const merged = [...dbVulns];
  
  // Add workspace vulnerabilities that don't exist in database
  for (const wsVuln of wsVulns) {
    const existsInDb = dbVulns.some(dbVuln =>
      dbVuln.title === wsVuln.title &&
      dbVuln.filePath === wsVuln.filePath &&
      dbVuln.lineStart === wsVuln.lineStart
    );
    
    if (!existsInDb) {
      merged.push(wsVuln);
    }
  }
  
  return merged;
}

/**
 * Calculate vulnerability summary
 */
function calculateVulnerabilitySummary(
  vulnerabilities: VulnerabilityDetail[]
): VulnerabilitySummary {
  const summary: VulnerabilitySummary = {
    total: vulnerabilities.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    byType: {},
    bySkill: {},
  };
  
  for (const vuln of vulnerabilities) {
    // Count by severity
    const sev = normalizeSeverity(vuln.severity);
    switch (sev) {
      case 'critical': summary.critical++; break;
      case 'high': summary.high++; break;
      case 'medium': summary.medium++; break;
      case 'low': summary.low++; break;
      case 'info': summary.info++; break;
    }
    
    // Count by type
    const type = vuln.type || 'Unknown';
    summary.byType[type] = (summary.byType[type] || 0) + 1;
    
    // Count by skill
    const skill = vuln.skill || 'Unknown';
    summary.bySkill[skill] = (summary.bySkill[skill] || 0) + 1;
  }
  
  return summary;
}

/**
 * Read agent zone result paths from workspace
 */
async function readAgentZoneResultPaths(workspacePath: string): Promise<string[]> {
  const results: string[] = [];
  const vulnerabilitiesPath = path.join(workspacePath, 'vulnerabilities');
  
  if (!fs.existsSync(vulnerabilitiesPath)) {
    return results;
  }
  
  try {
    const files = fs.readdirSync(vulnerabilitiesPath);
    for (const file of files) {
      if (file.endsWith('.json')) {
        results.push(path.join(vulnerabilitiesPath, file));
      }
    }
  } catch (err) {
    console.warn(`Failed to read agent zone results: ${err}`);
  }
  
  return results;
}

/**
 * Normalize severity string
 */
function normalizeSeverity(severity: string): string {
  const sev = severity?.toLowerCase() || 'medium';
  
  switch (sev) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low': return 'low';
    case 'info': return 'info';
    case 'information': return 'info';
    default: return 'medium';
  }
}

/**
 * Save report to database
 */
async function saveReportToDatabase(
  reportData: UnifiedReportData,
  reportFilePath: string,
  markdownContent: string
): Promise<void> {
  await prisma.report.upsert({
    where: { sessionId: reportData.sessionId },
    create: {
      id: `report-${reportData.sessionId}`,
      sessionId: reportData.sessionId,
      projectId: reportData.projectId,
      reportType: 'unified',
      workflowType: reportData.workflowType,
      fsmTemplate: reportData.fsmTemplate,
      title: `Evaluation Report - ${reportData.projectName}`,
      description: `Unified evaluation report for ${reportData.projectName} (${reportData.workflowType} workflow)`,
      mainReportPath: reportFilePath,
      mainReportContent: markdownContent,
      totalFindings: reportData.vulnerabilitySummary.total,
      criticalCount: reportData.vulnerabilitySummary.critical,
      highCount: reportData.vulnerabilitySummary.high,
      mediumCount: reportData.vulnerabilitySummary.medium,
      lowCount: reportData.vulnerabilitySummary.low,
      infoCount: reportData.vulnerabilitySummary.info,
      dataSources: JSON.stringify({
        nodeExecutions: reportData.nodeExecutions.length,
        skillStats: reportData.skillStats.length,
        phaseOutputs: reportData.phaseOutputs?.length || 0,
        agentResults: reportData.agentResults?.length || 0,
      }),
      skillsUsed: JSON.stringify(reportData.skillStats.map(s => ({
        skillId: s.skillId,
        skillName: s.skillName,
        executionCount: s.executionCount,
      }))),
      status: 'generated',
      generatedAt: reportData.generatedAt,
    },
    update: {
      mainReportPath: reportFilePath,
      mainReportContent: markdownContent,
      totalFindings: reportData.vulnerabilitySummary.total,
      criticalCount: reportData.vulnerabilitySummary.critical,
      highCount: reportData.vulnerabilitySummary.high,
      mediumCount: reportData.vulnerabilitySummary.medium,
      lowCount: reportData.vulnerabilitySummary.low,
      infoCount: reportData.vulnerabilitySummary.info,
      dataSources: JSON.stringify({
        nodeExecutions: reportData.nodeExecutions.length,
        skillStats: reportData.skillStats.length,
        phaseOutputs: reportData.phaseOutputs?.length || 0,
        agentResults: reportData.agentResults?.length || 0,
      }),
      skillsUsed: JSON.stringify(reportData.skillStats.map(s => ({
        skillId: s.skillId,
        skillName: s.skillName,
        executionCount: s.executionCount,
      }))),
      status: 'generated',
      generatedAt: reportData.generatedAt,
    },
  });
}

// ============ Markdown Generation ============

/**
 * Generate Markdown report content
 */
function generateMarkdownReport(data: UnifiedReportData): string {
  const sections: string[] = [];
  
  // Header
  sections.push(generateHeaderSection(data));
  
  // Executive Summary
  sections.push(generateExecutiveSummarySection(data));
  
  // Node Execution Summary
  sections.push(generateNodeExecutionSection(data));
  
  // Skill Execution Statistics
  sections.push(generateSkillStatisticsSection(data));
  
  // Vulnerability Summary
  sections.push(generateVulnerabilitySummarySection(data));
  
  // Vulnerability Details
  sections.push(generateVulnerabilityDetailsSection(data));
  
  // FSM-specific sections (if applicable)
  if (data.workflowType === 'fsm') {
    sections.push(generateFSMSpecificSection(data));
  }
  
  // Footer
  sections.push(generateFooterSection(data));
  
  return sections.join('\n\n');
}

/**
 * Generate header section
 */
function generateHeaderSection(data: UnifiedReportData): string {
  return `# Evaluation Report

**Project**: ${data.projectName}
**Workflow Type**: ${data.workflowType.toUpperCase()}
${data.fsmTemplate ? `**FSM Template**: ${data.fsmTemplate}` : ''}
**Generated**: ${data.generatedAt.toISOString()}
**Session ID**: ${data.sessionId}

---`;
}

/**
 * Generate executive summary section
 */
function generateExecutiveSummarySection(data: UnifiedReportData): string {
  const overallRisk = calculateOverallRisk(data.vulnerabilitySummary);
  const durationStr = formatDuration(data.totalDuration);
  const totalTokens = data.totalInputTokens + data.totalOutputTokens;
  
  return `## Executive Summary

### Risk Overview

| Metric | Value |
|--------|-------|
| **Overall Risk Level** | ${overallRisk} |
| **Total Vulnerabilities** | ${data.vulnerabilitySummary.total} |
| **Critical** | ${data.vulnerabilitySummary.critical} |
| **High** | ${data.vulnerabilitySummary.high} |
| **Medium** | ${data.vulnerabilitySummary.medium} |
| **Low** | ${data.vulnerabilitySummary.low} |
| **Info** | ${data.vulnerabilitySummary.info} |

### Execution Statistics

| Metric | Value |
|--------|-------|
| **Total Duration** | ${durationStr} |
| **Total Input Tokens** | ${data.totalInputTokens.toLocaleString()} |
| **Total Output Tokens** | ${data.totalOutputTokens.toLocaleString()} |
| **Total Tokens** | ${totalTokens.toLocaleString()} |
| **Nodes Executed** | ${data.nodeExecutions.length} |
| **Skills Used** | ${data.skillStats.length} |

---`;
}

/**
 * Generate node execution section
 */
function generateNodeExecutionSection(data: UnifiedReportData): string {
  if (data.nodeExecutions.length === 0) {
    return `## Node Execution Summary

No node execution records found.

---`;
  }
  
  const tableRows = data.nodeExecutions.map(node => {
    const duration = node.duration ? formatDuration(node.duration) : 'N/A';
    const statusIcon = getStatusIcon(node.status);
    
    return `| ${node.nodeLabel} | ${statusIcon} ${node.status} | ${node.modelName || 'N/A'} | ${duration} |`;
  }).join('\n');
  
  return `## Node Execution Summary

| Node | Status | Model | Duration |
|------|--------|-------|----------|
${tableRows}

**Execution Order**: Nodes executed in sequence based on workflow definition.

---`;
}

/**
 * Generate skill statistics section
 */
function generateSkillStatisticsSection(data: UnifiedReportData): string {
  if (data.skillStats.length === 0) {
    return `## Skill Execution Statistics

No skill execution records found.

---`;
  }
  
  const tableRows = data.skillStats.map(skill => {
    const avgDuration = formatDuration(skill.avgDuration);
    const successRate = skill.successRate
      ? `${(skill.successRate * 100).toFixed(1)}%`
      : 'N/A';
    
    return `| ${skill.skillName} | ${skill.executionCount} | ${avgDuration} | ${skill.findingsCount} | ${skill.confirmedCount} | ${successRate} |`;
  }).join('\n');
  
  return `## Skill Execution Statistics

| Skill | Executions | Avg Duration | Findings | Confirmed | Success Rate |
|-------|------------|--------------|----------|-----------|--------------|
${tableRows}

**Summary**: ${data.skillStats.length} unique skills were executed during this evaluation.

---`;
}

/**
 * Generate vulnerability summary section
 */
function generateVulnerabilitySummarySection(data: UnifiedReportData): string {
  const summary = data.vulnerabilitySummary;
  
  // By Type table
  const typeRows = Object.entries(summary.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => `| ${type} | ${count} |`)
    .join('\n');
  
  // By Skill table
  const skillRows = Object.entries(summary.bySkill)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([skill, count]) => `| ${skill} | ${count} |`)
    .join('\n');
  
  return `## Vulnerability Summary

### By Severity

| Severity | Count | Percentage |
|----------|-------|------------|
| Critical | ${summary.critical} | ${((summary.critical / summary.total) * 100).toFixed(1)}% |
| High | ${summary.high} | ${((summary.high / summary.total) * 100).toFixed(1)}% |
| Medium | ${summary.medium} | ${((summary.medium / summary.total) * 100).toFixed(1)}% |
| Low | ${summary.low} | ${((summary.low / summary.total) * 100).toFixed(1)}% |
| Info | ${summary.info} | ${((summary.info / summary.total) * 100).toFixed(1)}% |

### By Type (Top 10)

| Type | Count |
|------|-------|
${typeRows || '| N/A | 0 |'}

### By Skill (Top 10)

| Skill | Count |
|-------|-------|
${skillRows || '| N/A | 0 |'}

---`;
}

/**
 * Generate vulnerability details section
 */
function generateVulnerabilityDetailsSection(data: UnifiedReportData): string {
  if (data.vulnerabilities.length === 0) {
    return `## Vulnerability Details

No vulnerabilities were identified during this evaluation.

---`;
  }
  
  // Sort by severity
  const sortedVulns = [...data.vulnerabilities].sort((a, b) => {
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (sevOrder[a.severity as keyof typeof sevOrder] || 2) -
           (sevOrder[b.severity as keyof typeof sevOrder] || 2);
  });
  
  // Limit to first 50 for readability
  const displayVulns = sortedVulns.slice(0, 50);
  
  const vulnDetails = displayVulns.map(vuln => {
    const severityIcon = getSeverityIcon(vuln.severity);
    const location = vuln.filePath
      ? `${vuln.filePath}${vuln.lineStart ? `:${vuln.lineStart}` : ''}`
      : 'N/A';
    
    return `
### ${severityIcon} ${vuln.title}

- **ID**: ${vuln.id}
- **Type**: ${vuln.type}
- **Severity**: ${vuln.severity.toUpperCase()}
- **CWE**: ${vuln.cwe || 'N/A'}
- **Skill**: ${vuln.skill || 'N/A'}
- **Location**: ${location}
- **Status**: ${vuln.status}
- **Source**: ${vuln.source}

${vuln.description ? `**Description**: ${vuln.description}` : ''}
`;
  }).join('\n');
  
  const remainingCount = sortedVulns.length - displayVulns.length;
  const remainingNote = remainingCount > 0
    ? `\n> **Note**: ${remainingCount} additional vulnerabilities not shown. See database for complete list.`
    : '';
  
  return `## Vulnerability Details

${vulnDetails}
${remainingNote}

---`;
}

/**
 * Generate FSM-specific section
 */
function generateFSMSpecificSection(data: UnifiedReportData): string {
  const sections: string[] = [];
  
  sections.push(`## FSM Workflow Details`);
  
  if (data.fsmTemplate) {
    sections.push(`**Template**: ${data.fsmTemplate}`);
  }
  
  if (data.phaseOutputs && data.phaseOutputs.length > 0) {
    sections.push(`### Phase Outputs`);
    sections.push(`| Phase | Output Path |`);
    sections.push(`|-------|-------------|`);
    for (const outputPath of data.phaseOutputs) {
      const phaseName = path.basename(outputPath, '.yaml');
      sections.push(`| ${phaseName} | ${outputPath} |`);
    }
  }
  
  if (data.agentResults && data.agentResults.length > 0) {
    sections.push(`### Agent Zone Results`);
    sections.push(`| Agent | Result Path |`);
    sections.push(`|-------|-------------|`);
    for (const resultPath of data.agentResults) {
      const agentName = path.basename(resultPath, '.json');
      sections.push(`| ${agentName} | ${resultPath} |`);
    }
  }
  
  sections.push(`---`);
  
  return sections.join('\n');
}

/**
 * Generate footer section
 */
function generateFooterSection(data: UnifiedReportData): string {
  return `## Conclusion

${generateConclusionText(data)}

---

*Generated by Unified Report Generator*
*Workflow Type: ${data.workflowType.toUpperCase()}*
*Timestamp: ${data.generatedAt.toISOString()}*`;
}

// ============ Utility Functions ============

/**
 * Calculate overall risk level
 */
function calculateOverallRisk(summary: VulnerabilitySummary): string {
  if (summary.critical > 0) return 'CRITICAL';
  if (summary.high > 3) return 'HIGH';
  if (summary.high > 0 || summary.medium > 5) return 'MEDIUM';
  if (summary.medium > 0 || summary.low > 10) return 'LOW';
  return 'MINIMAL';
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (!ms || ms === 0) return '0ms';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  if (seconds > 0) {
    return `${seconds}s`;
  }
  return `${ms}ms`;
}

/**
 * Get status icon
 */
function getStatusIcon(status: string): string {
  switch (status.toLowerCase()) {
    case 'completed': return '✅';
    case 'running': return '🔄';
    case 'pending': return '⏳';
    case 'failed': return '❌';
    case 'skipped': return '⏭️';
    default: return '📋';
  }
}

/**
 * Get severity icon
 */
function getSeverityIcon(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    case 'info': return '🔵';
    default: return '⚪';
  }
}

/**
 * Generate conclusion text
 */
function generateConclusionText(data: UnifiedReportData): string {
  const risk = calculateOverallRisk(data.vulnerabilitySummary);
  
  if (risk === 'CRITICAL') {
    return 'Critical security issues were identified. Immediate remediation is required before production deployment.';
  }
  
  if (risk === 'HIGH') {
    return 'High-risk vulnerabilities require prioritized attention. A remediation plan should be developed and implemented.';
  }
  
  if (risk === 'MEDIUM') {
    return 'Several security concerns were identified. Consider implementing the recommended mitigations to improve security posture.';
  }
  
  if (risk === 'LOW') {
    return 'Minor security issues were found. Regular monitoring and periodic reassessment recommended.';
  }
  
  return 'No significant security issues were identified. Continue monitoring and periodic reassessment.';
}

// ============ Export Class for Service Integration ============

/**
 * UnifiedReportGenerator class
 * For integration with workflow execution services
 */
export class UnifiedReportGenerator {
  private evaluationId: string;
  private projectId: string;
  private projectName: string;
  private workflowType: 'dag' | 'fsm';
  private workspacePath: string;

  constructor(
    evaluationId: string,
    projectId: string,
    projectName: string,
    workflowType: 'dag' | 'fsm',
    workspacePath: string
  ) {
    this.evaluationId = evaluationId;
    this.projectId = projectId;
    this.projectName = projectName;
    this.workflowType = workflowType;
    this.workspacePath = workspacePath;
  }

  /**
   * Generate and save the unified report
   */
  async generate(): Promise<{ reportData: UnifiedReportData; reportPath: string }> {
    const config: UnifiedReportConfig = {
      evaluationId: this.evaluationId,
      projectId: this.projectId,
      projectName: this.projectName,
      workflowType: this.workflowType,
      workspacePath: this.workspacePath,
    };

    const reportData = await generateUnifiedReport(config);
    const reportPath = await saveUnifiedReport(reportData, this.workspacePath);

    return { reportData, reportPath };
  }

  /**
   * Generate report data only (without saving)
   */
  async generateData(): Promise<UnifiedReportData> {
    const config: UnifiedReportConfig = {
      evaluationId: this.evaluationId,
      projectId: this.projectId,
      projectName: this.projectName,
      workflowType: this.workflowType,
      workspacePath: this.workspacePath,
    };

    return generateUnifiedReport(config);
  }

  /**
   * Save existing report data
   */
  async save(reportData: UnifiedReportData): Promise<string> {
    return saveUnifiedReport(reportData, this.workspacePath);
  }
}

export default {
  generateUnifiedReport,
  saveUnifiedReport,
  UnifiedReportGenerator,
};