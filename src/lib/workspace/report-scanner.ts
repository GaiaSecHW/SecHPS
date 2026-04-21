/**
 * Workspace 报告扫描器
 * 
 * 扫描项目 workspace 中的各种安全扫描报告，
 * 解析并标准化漏洞数据。
 */

import * as fs from 'fs';
import * as path from 'path';

// 报告类型定义
export type ReportType = 
  | 'owasp-zap'
  | 'sonarqube'
  | 'burp'
  | 'semgrep'
  | 'trufflehog'
  | 'snyk'
  | 'markdown'
  | 'json-generic';

// 漏洞数据接口
export interface WorkspaceVulnerability {
  id: string;
  title: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  confidence?: 'high' | 'medium' | 'low';
  description?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  codeSnippet?: string;
  cwe?: string;
  owasp?: string;
  cvss?: number;
  references?: string[];
  sourceTool: ReportType;
  sourceFile: string;
  rawData?: any;
}

// 报告扫描结果接口
export interface WorkspaceReportScanResult {
  reportsFound: number;
  vulnerabilities: WorkspaceVulnerability[];
  summary: {
    total: number;
    bySeverity: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      info: number;
    };
    byTool: Record<ReportType, number>;
  };
  errors: string[];
}

// 报告文件模式
const REPORT_PATTERNS: Record<ReportType, string[]> = {
  'owasp-zap': ['zap-report.json', 'owasp-zap*.json', 'zap-*.json'],
  'sonarqube': ['sonarqube-report.json', 'sonar-*.json'],
  'burp': ['burp-report.xml', 'burp-*.xml', 'burp-report.json'],
  'semgrep': ['semgrep-report.json', 'semgrep-*.json'],
  'trufflehog': ['secrets-report.json', 'trufflehog-*.json'],
  'snyk': ['snyk-report.json', 'snyk-*.json', 'dependency-report.json'],
  'markdown': ['*-report.md', 'security-*.md', 'audit-*.md'],
  'json-generic': ['*-report.json', 'scan-*.json'],
};

/**
 * 扫描 workspace 中的报告文件
 */
export async function scanWorkspaceReports(
  workspacePath: string,
  additionalPaths?: string[]
): Promise<WorkspaceReportScanResult> {
  const result: WorkspaceReportScanResult = {
    reportsFound: 0,
    vulnerabilities: [],
    summary: {
      total: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      byTool: {} as Record<ReportType, number>,
    },
    errors: [],
  };

  // 默认扫描路径
  const scanPaths = [
    workspacePath,
    path.join(workspacePath, 'reports'),
    path.join(workspacePath, 'scan-reports'),
    path.join(workspacePath, 'vulnerabilities'),
    path.join(workspacePath, '.claude'),
    path.join(workspacePath, '.claude', 'reports'),
    ...additionalPaths || [],
  ];

  // 验证路径存在
  const validPaths = scanPaths.filter(p => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  // 扫描每个路径
  for (const scanPath of validPaths) {
    try {
      const files = await scanDirectory(scanPath);
      
      for (const file of files) {
        try {
          const reportType = identifyReportType(file);
          if (reportType) {
            const vulns = await parseReportFile(file, reportType);
            
            if (vulns.length > 0) {
              result.reportsFound++;
              result.vulnerabilities.push(...vulns);
              
              // 更新统计
              for (const vuln of vulns) {
                result.summary.total++;
                result.summary.bySeverity[vuln.severity]++;
                result.summary.byTool[vuln.sourceTool] = 
                  (result.summary.byTool[vuln.sourceTool] || 0) + 1;
              }
            }
          }
        } catch (err) {
          result.errors.push(`解析报告文件失败: ${file} - ${err}`);
        }
      }
    } catch (err) {
      result.errors.push(`扫描目录失败: ${scanPath} - ${err}`);
    }
  }

  return result;
}

/**
 * 扫描目录获取报告文件
 */
async function scanDirectory(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // 递归扫描子目录（限制深度）
        const subFiles = await scanDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        // 检查是否是报告文件
        const fileName = entry.name.toLowerCase();
        if (
          fileName.endsWith('.json') ||
          fileName.endsWith('.xml') ||
          fileName.endsWith('.md')
        ) {
          files.push(fullPath);
        }
      }
    }
  } catch (err) {
    // 目录访问失败，忽略
  }
  
  return files;
}

/**
 * 识别报告类型
 */
function identifyReportType(filePath: string): ReportType | null {
  const fileName = path.basename(filePath).toLowerCase();
  
  // 检查特定工具报告
  for (const [type, patterns] of Object.entries(REPORT_PATTERNS)) {
    for (const pattern of patterns) {
      if (matchPattern(fileName, pattern.toLowerCase())) {
        return type as ReportType;
      }
    }
  }
  
  // JSON 文件尝试解析识别
  if (fileName.endsWith('.json')) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      // OWASP ZAP 特征
      if (data.site || data['@version'] === '2.7.0' || data.alerts) {
        return 'owasp-zap';
      }
      
      // Semgrep 特征
      if (data.results && data.results[0]?.check_id) {
        return 'semgrep';
      }
      
      // Snyk 特征
      if (data.vulnerabilities || data.ok === false) {
        return 'snyk';
      }
      
      // TruffleHog 特征
      if (data.findings && data.findings[0]?.detector_type) {
        return 'trufflehog';
      }
      
      // SonarQube 特征
      if (data.issues && data.issues[0]?.rule) {
        return 'sonarqube';
      }
      
      return 'json-generic';
    } catch {
      return 'json-generic';
    }
  }
  
  // Markdown 文件
  if (fileName.endsWith('.md')) {
    return 'markdown';
  }
  
  return null;
}

/**
 * 简单模式匹配
 */
function matchPattern(fileName: string, pattern: string): boolean {
  // 将 * 转换为正则
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*');
  
  return new RegExp(`^${regexPattern}$`).test(fileName);
}

/**
 * 解析报告文件
 */
async function parseReportFile(
  filePath: string,
  reportType: ReportType
): Promise<WorkspaceVulnerability[]> {
  switch (reportType) {
    case 'owasp-zap':
      return parseZapReport(filePath);
    case 'semgrep':
      return parseSemgrepReport(filePath);
    case 'snyk':
      return parseSnykReport(filePath);
    case 'trufflehog':
      return parseTrufflehogReport(filePath);
    case 'sonarqube':
      return parseSonarqubeReport(filePath);
    case 'markdown':
      return parseMarkdownReport(filePath);
    case 'json-generic':
      return parseGenericJsonReport(filePath);
    default:
      return [];
  }
}

/**
 * 解析 OWASP ZAP 报告
 */
function parseZapReport(filePath: string): WorkspaceVulnerability[] {
  const vulnerabilities: WorkspaceVulnerability[] = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    // ZAP 报告格式: site[].alerts[]
    const sites = data.site || [data];
    
    for (const site of sites) {
      const alerts = site.alerts || [];
      
      for (const alert of alerts) {
        const instances = alert.instances || [{}];
        
        for (let i = 0; i < instances.length; i++) {
          const instance = instances[i];
          
          vulnerabilities.push({
            id: `zap-${alert.alertRef || alert.pluginId}-${i}`,
            title: alert.name || 'Unknown ZAP Alert',
            type: alert.name || 'Vulnerability',
            severity: mapZapRiskToSeverity(alert.riskdesc || alert.riskcode),
            confidence: mapZapConfidence(alert.confidence),
            description: alert.description || alert.desc,
            filePath: instance.uri || instance.file,
            lineStart: instance.line,
            cwe: alert.cweid ? `CWE-${alert.cweid}` : undefined,
            owasp: alert.wascid ? `WASC-${alert.wascid}` : undefined,
            references: alert.reference ? [alert.reference] : undefined,
            sourceTool: 'owasp-zap',
            sourceFile: filePath,
            rawData: alert,
          });
        }
      }
    }
  } catch (err) {
    // 解析失败
  }
  
  return vulnerabilities;
}

/**
 * 解析 Semgrep 报告
 */
function parseSemgrepReport(filePath: string): WorkspaceVulnerability[] {
  const vulnerabilities: WorkspaceVulnerability[] = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    const results = data.results || [];
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      
      vulnerabilities.push({
        id: `semgrep-${result.check_id}-${i}`,
        title: result.check_id || 'Semgrep Finding',
        type: extractSemgrepType(result.check_id),
        severity: mapSemgrepSeverity(result.extra?.severity),
        confidence: 'high', // Semgrep 静态分析置信度高
        description: result.extra?.message,
        filePath: result.path,
        lineStart: result.start?.line,
        lineEnd: result.end?.line,
        codeSnippet: result.extra?.lines,
        cwe: result.extra?.metadata?.cwe,
        owasp: result.extra?.metadata?.owasp,
        references: result.extra?.metadata?.references,
        sourceTool: 'semgrep',
        sourceFile: filePath,
        rawData: result,
      });
    }
  } catch (err) {
    // 解析失败
  }
  
  return vulnerabilities;
}

/**
 * 解析 Snyk 报告
 */
function parseSnykReport(filePath: string): WorkspaceVulnerability[] {
  const vulnerabilities: WorkspaceVulnerability[] = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    const vulns = data.vulnerabilities || [];
    
    for (let i = 0; i < vulns.length; i++) {
      const vuln = vulns[i];
      
      vulnerabilities.push({
        id: `snyk-${vuln.id || i}`,
        title: vuln.title || vuln.name || 'Snyk Vulnerability',
        type: vuln.type || 'Dependency Vulnerability',
        severity: mapSnykSeverity(vuln.severity),
        description: vuln.description,
        cwe: vuln.cwe ? `CWE-${vuln.cwe}` : undefined,
        cvss: vuln.cvssScore,
        references: vuln.references?.url ? [vuln.references.url] : undefined,
        sourceTool: 'snyk',
        sourceFile: filePath,
        rawData: vuln,
      });
    }
  } catch (err) {
    // 解析失败
  }
  
  return vulnerabilities;
}

/**
 * 解析 TruffleHog 报告
 */
function parseTrufflehogReport(filePath: string): WorkspaceVulnerability[] {
  const vulnerabilities: WorkspaceVulnerability[] = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    const findings = data.findings || [];
    
    for (let i = 0; i < findings.length; i++) {
      const finding = findings[i];
      
      vulnerabilities.push({
        id: `trufflehog-${finding.fingerprint || i}`,
        title: `Secret Detected: ${finding.detector_name || 'Unknown'}`,
        type: 'Sensitive Data Exposure',
        severity: 'high', // 密钥泄露通常是高危
        confidence: finding.verified ? 'high' : 'medium',
        description: `Potential secret/credential detected using ${finding.detector_name}`,
        filePath: finding.file_path,
        lineStart: finding.line_number,
        codeSnippet: finding.snippet,
        sourceTool: 'trufflehog',
        sourceFile: filePath,
        rawData: finding,
      });
    }
  } catch (err) {
    // 解析失败
  }
  
  return vulnerabilities;
}

/**
 * 解析 SonarQube 报告
 */
function parseSonarqubeReport(filePath: string): WorkspaceVulnerability[] {
  const vulnerabilities: WorkspaceVulnerability[] = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    const issues = data.issues || [];
    
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      
      vulnerabilities.push({
        id: `sonarqube-${issue.key || i}`,
        title: issue.message || issue.rule || 'SonarQube Issue',
        type: extractSonarqubeType(issue.rule),
        severity: mapSonarqubeSeverity(issue.severity),
        description: issue.message,
        filePath: issue.component,
        lineStart: issue.line,
        cwe: extractCweFromRule(issue.rule),
        sourceTool: 'sonarqube',
        sourceFile: filePath,
        rawData: issue,
      });
    }
  } catch (err) {
    // 解析失败
  }
  
  return vulnerabilities;
}

/**
 * 解析 Markdown 报告（简单提取）
 */
function parseMarkdownReport(filePath: string): WorkspaceVulnerability[] {
  const vulnerabilities: WorkspaceVulnerability[] = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // 简单提取：查找标题模式
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // 检查漏洞标题模式 (# Vulnerability, ## [HIGH], etc.)
      if (line.match(/^#{1,3}\s*(vulnerability|finding|security|漏洞|风险)/i)) {
        // 提取标题
        const title = line.replace(/^#+\s*/, '').trim();
        
        // 提取严重性（从标题中）
        let severity: WorkspaceVulnerability['severity'] = 'medium';
        if (title.match(/critical|严重/i)) severity = 'critical';
        else if (title.match(/high|高危/i)) severity = 'high';
        else if (title.match(/low|低危/i)) severity = 'low';
        else if (title.match(/info|信息/i)) severity = 'info';
        
        // 提取后续描述段落
        let description = '';
        let j = i + 1;
        while (j < lines.length && !lines[j].match(/^#{1,3}/)) {
          description += lines[j] + '\n';
          j++;
        }
        
        vulnerabilities.push({
          id: `md-${filePath}-${i}`,
          title: title,
          type: 'Markdown Finding',
          severity: severity,
          description: description.trim() || undefined,
          sourceTool: 'markdown',
          sourceFile: filePath,
        });
      }
    }
  } catch (err) {
    // 解析失败
  }
  
  return vulnerabilities;
}

/**
 * 解析通用 JSON 报告
 */
function parseGenericJsonReport(filePath: string): WorkspaceVulnerability[] {
  const vulnerabilities: WorkspaceVulnerability[] = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    // 尝试通用数组格式
    const items = Array.isArray(data) ? data : 
      (data.findings || data.vulnerabilities || data.issues || data.alerts || []);
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      if (typeof item === 'object') {
        vulnerabilities.push({
          id: `generic-${item.id || i}`,
          title: item.title || item.name || item.message || 'Finding',
          type: item.type || 'Vulnerability',
          severity: mapGenericSeverity(item.severity || item.risk || item.level),
          description: item.description || item.desc || item.details,
          filePath: item.file || item.path || item.filePath,
          lineStart: item.line || item.lineStart,
          lineEnd: item.endLine || item.lineEnd,
          cwe: item.cwe || item.CWE,
          sourceTool: 'json-generic',
          sourceFile: filePath,
          rawData: item,
        });
      }
    }
  } catch (err) {
    // 解析失败
  }
  
  return vulnerabilities;
}

// ============ 辅助映射函数 ============

function mapZapRiskToSeverity(risk: string | number): WorkspaceVulnerability['severity'] {
  const riskCode = typeof risk === 'string' ? parseInt(risk.split(' ')[0]) : risk;
  
  switch (riskCode) {
    case 3: return 'critical';
    case 2: return 'high';
    case 1: return 'medium';
    case 0: return 'info';
    default: return 'medium';
  }
}

function mapZapConfidence(confidence: string | number): WorkspaceVulnerability['confidence'] {
  const confCode = typeof confidence === 'string' ? parseInt(confidence) : confidence;
  
  switch (confCode) {
    case 3: return 'high';
    case 2: return 'medium';
    case 1: return 'low';
    default: return 'medium';
  }
}

function mapSemgrepSeverity(severity: string): WorkspaceVulnerability['severity'] {
  switch (severity?.toUpperCase()) {
    case 'ERROR': return 'high';
    case 'WARNING': return 'medium';
    case 'INFO': return 'info';
    default: return 'medium';
  }
}

function mapSnykSeverity(severity: string): WorkspaceVulnerability['severity'] {
  switch (severity?.toLowerCase()) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low': return 'low';
    default: return 'medium';
  }
}

function mapSonarqubeSeverity(severity: string): WorkspaceVulnerability['severity'] {
  switch (severity?.toUpperCase()) {
    case 'BLOCKER': return 'critical';
    case 'CRITICAL': return 'critical';
    case 'MAJOR': return 'high';
    case 'MINOR': return 'low';
    case 'INFO': return 'info';
    default: return 'medium';
  }
}

function mapGenericSeverity(severity: string | number): WorkspaceVulnerability['severity'] {
  if (typeof severity === 'number') {
    if (severity >= 9) return 'critical';
    if (severity >= 7) return 'high';
    if (severity >= 4) return 'medium';
    if (severity >= 1) return 'low';
    return 'info';
  }
  
  switch (severity?.toLowerCase()) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low': return 'low';
    case 'info': return 'info';
    default: return 'medium';
  }
}

function extractSemgrepType(checkId: string): string {
  // 从 check_id 提取类型，如 "semgrep.sql-injection"
  const parts = checkId?.split('.') || [];
  return parts[parts.length - 1] || checkId || 'Semgrep Finding';
}

function extractSonarqubeType(rule: string): string {
  // 从 rule 提取类型
  return rule?.split(':').pop() || rule || 'SonarQube Issue';
}

function extractCweFromRule(rule: string): string | undefined {
  // 尝试从规则中提取 CWE
  const cweMatch = rule?.match(/cwe[:\-]?(\d+)/i);
  return cweMatch ? `CWE-${cweMatch[1]}` : undefined;
}

export default {
  scanWorkspaceReports,
};