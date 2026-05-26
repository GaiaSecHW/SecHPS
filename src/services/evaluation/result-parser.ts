// src/services/evaluation/result-parser.ts
//
// 漏洞报告解析和保存服务
// 支持多种 AI 输出格式，增强日志记录
//

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import type { ClaudeVulnerabilityReport } from '@/types/vulnerability';

// ============================================
// Skills 提取
// ============================================

/**
 * 从 AI 响应中提取使用的 Skills
 */
export function extractUsedSkills(fullResponse: string): string[] {
  const skills: string[] = [];

  // 匹配多种可能的 skill 标识格式
  const patterns = [
    // Markdown 格式: **技能**: skill-name
    /\*\*技能\*\*:\s*`?([a-zA-Z0-9_-]+)`?/gi,
    // JSON 格式: "skill": "skill-name"
    /"skill"\s*:\s*"([a-zA-Z0-9_-]+)"/gi,
    // XML 标签格式: <skill>skill-name</skill>
    /<skill>([a-zA-Z0-9_-]+)<\/skill>/gi,
    // 使用技能说明格式: 使用技能: skill-name
    /使用技能:\s*([a-zA-Z0-9_-]+)/gi,
    // 技能调用格式: [SKILL:skill-name]
    /\[SKILL:([a-zA-Z0-9_-]+)\]/gi,
    // Skill 名称格式: code-audit, sql-injection 等
    /(?:skill|技能)[：:\s]*["']?([a-zA-Z][a-zA-Z0-9_-]*)["']?/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(fullResponse)) !== null) {
      const skillName = match[1].trim();
      if (skillName && !skills.includes(skillName) && skillName.length > 2) {
        skills.push(skillName);
      }
    }
  }

  if (skills.length > 0) {
    logger.info(LOG_MODULES.EVALUATION,`检测到使用的 Skills: ${skills.join(', ')}`);
  }

  return skills;
}

// ============================================
// JSON 提取（增强版）
// ============================================

/**
 * 从文本中提取 JSON 代码块（增强版）
 * 支持多种格式：
 * - ```json { ... } ```
 * - ``` { ... } ```
 * - 纯 JSON 对象
 * - 嵌套的 JSON 对象
 * - 多个 JSON 块（取包含漏洞的）
 */
function extractJsonBlock(text: string): { json: string; source: string } | null {
  logger.info(LOG_MODULES.EVALUATION, `开始提取 JSON 块，响应长度: ${text.length}`);

  // 策略1: 尝试匹配 ```json ... ``` 代码块
  const jsonCodeBlockRegex = /```json\s*\n?([\s\S]*?)```/gi;
  let match;
  let jsonBlocks: { json: string; source: string }[] = [];

  while ((match = jsonCodeBlockRegex.exec(text)) !== null) {
    const json = match[1].trim();
    if (json) {
      logger.info(LOG_MODULES.EVALUATION,`找到 JSON 代码块 (策略1-json标签)，长度: ${json.length}`);
      jsonBlocks.push({ json, source: 'json-code-block' });
    }
  }

  // 策略2: 尝试匹配 ``` ... ``` 代码块（无 json 标签）
  const codeBlockRegex = /```\s*\n?([\s\S]*?)```/gi;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[1].trim();
    // 检查是否看起来像 JSON
    if (content.startsWith('{') && content.includes('vulnerabilit')) {
      logger.info(LOG_MODULES.EVALUATION,`找到通用代码块 (策略2-通用标签)，长度: ${content.length}`);
      jsonBlocks.push({ json: content, source: 'generic-code-block' });
    }
  }

  // 策略3: 尝试匹配完整的 JSON 对象
  // 使用更智能的括号匹配
  const braceMatches = findJsonObjects(text);
  for (const json of braceMatches) {
    if (json.includes('vulnerabilit') || json.includes('summary')) {
      logger.info(LOG_MODULES.EVALUATION,`找到 JSON 对象 (策略3-括号匹配)，长度: ${json.length}`);
      jsonBlocks.push({ json, source: 'brace-match' });
    }
  }

  // 优先选择包含漏洞数据的块
  if (jsonBlocks.length > 0) {
    // 优先级: 包含 vulnerabilities > 包含 summary > 其他
    const withVulns = jsonBlocks.find(b => b.json.includes('"vulnerabilities"'));
    if (withVulns) {
      logger.info(LOG_MODULES.EVALUATION,`选择包含漏洞列表的 JSON 块，来源: ${withVulns.source}`);
      return withVulns;
    }

    const withSummary = jsonBlocks.find(b => b.json.includes('"summary"'));
    if (withSummary) {
      logger.info(LOG_MODULES.EVALUATION,`选择包含摘要的 JSON 块，来源: ${withSummary.source}`);
      return withSummary;
    }

    logger.info(LOG_MODULES.EVALUATION,`选择第一个 JSON 块，来源: ${jsonBlocks[0].source}`);
    return jsonBlocks[0];
  }

  logger.warn(LOG_MODULES.EVALUATION, '未找到任何 JSON 块');
  return null;
}

/**
 * 查找文本中所有的 JSON 对象
 */
function findJsonObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const json = text.substring(start, i + 1);
        results.push(json);
        start = -1;
      }
    }
  }

  return results;
}

// ============================================
// 漏洞解析（增强版）
// ============================================

interface ParsedVulnerability {
  vulnerable?: boolean;
  type: string;
  severity: string;
  title: string;
  description?: string;
  cwe_id?: string;
  location?: string;
  POC?: string;
  recommendation?: string;
  skill?: string;
}

interface ParsedReport {
  summary?: {
    total?: number;
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
    info?: number;
    skills_used?: string[];
  };
  vulnerabilities?: ParsedVulnerability[];
}

/**
 * 尝试从 AI 响应中提取漏洞列表（宽松模式）
 */
function extractVulnerabilitiesFromText(text: string): ParsedVulnerability[] {
  const vulns: ParsedVulnerability[] = [];

  // 模式1: 编号列表格式的漏洞
  // 1. **SQL注入** - 严重程度: 高危
  const numberedPattern = /(\d+)\.\s*\*\*([^*]+)\*\*\s*[-–:]\s*(?:严重程度|风险等级|Severity)?:?\s*(高危|严重|中危|低危|critical|high|medium|low|info)/gi;
  let match;
  while ((match = numberedPattern.exec(text)) !== null) {
    vulns.push({
      title: match[2].trim(),
      type: match[2].trim(),
      severity: normalizeSeverity(match[3]),
    });
  }

  // 模式2: Markdown 标题格式的漏洞
  // ### SQL注入漏洞
  const headerPattern = /###\s*([^#\n]+(?:漏洞|注入|XSS|CSRF|RCE|SSRF|越权|未授权)[^\n]*)/gi;
  while ((match = headerPattern.exec(text)) !== null) {
    const title = match[1].trim();
    if (!vulns.some(v => v.title === title)) {
      vulns.push({
        title,
        type: extractVulnType(title),
        severity: 'medium', // 默认中危
      });
    }
  }

  // 模式3: 表格格式的漏洞
  // | SQL注入 | 高危 | ... |
  const tablePattern = /\|\s*([^|]+)\s*\|\s*(高危|严重|中危|低危|critical|high|medium|low|info)\s*\|/gi;
  while ((match = tablePattern.exec(text)) !== null) {
    const title = match[1].trim();
    if (title && !title.includes('漏洞类型') && !title.includes('---')) {
      vulns.push({
        title,
        type: extractVulnType(title),
        severity: normalizeSeverity(match[2]),
      });
    }
  }

  return vulns;
}

/**
 * 标准化严重程度
 */
function normalizeSeverity(severity: string): string {
  const lower = severity.toLowerCase().trim();
  const mapping: Record<string, string> = {
    '严重': 'critical',
    '危急': 'critical',
    'critical': 'critical',
    '高危': 'high',
    '高': 'high',
    'high': 'high',
    '中危': 'medium',
    '中': 'medium',
    'medium': 'medium',
    '低危': 'low',
    '低': 'low',
    'low': 'low',
    '信息': 'info',
    'info': 'info',
  };
  return mapping[lower] || 'medium';
}

/**
 * 从标题中提取漏洞类型
 */
function extractVulnType(title: string): string {
  const patterns = [
    { regex: /sql/i, type: 'SQL注入' },
    { regex: /xss|跨站脚本/i, type: 'XSS' },
    { regex: /csrf|跨站请求/i, type: 'CSRF' },
    { regex: /ssrf|服务端请求/i, type: 'SSRF' },
    { regex: /rce|远程代码|命令注入/i, type: 'RCE' },
    { regex: /越权|未授权/i, type: '越权访问' },
    { regex: /文件上传/i, type: '文件上传漏洞' },
    { regex: /文件包含/i, type: '文件包含漏洞' },
    { regex: /敏感信息|信息泄露/i, type: '敏感信息泄露' },
    { regex: /弱密码/i, type: '弱密码' },
    { regex: /认证|登录/i, type: '认证漏洞' },
  ];

  for (const { regex, type } of patterns) {
    if (regex.test(title)) {
      return type;
    }
  }

  return title.substring(0, 50); // 默认使用标题前50字符
}

// ============================================
// 主函数
// ============================================

/**
 * 从 Claude 输出中提取并解析 JSON 漏洞报告
 * 
 * 增强版特性：
 * 1. 详细的日志记录
 * 2. 多策略 JSON 提取
 * 3. 宽松的数据验证
 * 4. 降级解析（从文本中提取漏洞）
 * 5. 保存原始响应
 */
export async function parseAndSaveResults(
  evaluationId: string,
  projectId: string,
  fullResponse: string
): Promise<{ success: boolean; vulnCount: number; error?: string }> {
  logger.info(LOG_MODULES.EVALUATION, '========================================');
  logger.info(LOG_MODULES.EVALUATION, '开始解析评估结果');
  logger.info(LOG_MODULES.EVALUATION, `评估ID: ${evaluationId}`);
  logger.info(LOG_MODULES.EVALUATION, `项目ID: ${projectId}`);
  logger.info(LOG_MODULES.EVALUATION, `响应长度: ${fullResponse.length} 字符`);
  logger.info(LOG_MODULES.EVALUATION, '========================================');

  const result = { success: false, vulnCount: 0, error: undefined as string | undefined };

  try {
    // 1. 从完整响应中提取使用的 Skills
    const usedSkills = extractUsedSkills(fullResponse);

    // 2. 尝试提取 JSON 块
    const jsonResult = extractJsonBlock(fullResponse);
    
    let report: ParsedReport | null = null;
    let jsonSource = 'none';

    if (jsonResult) {
      jsonSource = jsonResult.source;
      try {
        report = JSON.parse(jsonResult.json);
        logger.info(LOG_MODULES.EVALUATION,`JSON 解析成功，来源: ${jsonSource}`);
      } catch (parseError: unknown) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        logger.warn(LOG_MODULES.EVALUATION,`JSON 解析失败: ${errorMsg}`);
        
        // 日志：打印完整的 JSON 块内容和解析失败原因
        logger.error(LOG_MODULES.EVALUATION,'========================================');
        logger.error(LOG_MODULES.EVALUATION,'!!! JSON 解析失败 - 打印完整 JSON 块 !!!');
        logger.error(LOG_MODULES.EVALUATION,`解析失败原因: ${errorMsg}`);
        logger.error(LOG_MODULES.EVALUATION,`JSON 来源: ${jsonSource}`);
        logger.error(LOG_MODULES.EVALUATION,`JSON 长度: ${jsonResult.json.length} 字符`);
        logger.error(LOG_MODULES.EVALUATION,'----------------------------------------');
        logger.error(LOG_MODULES.EVALUATION,'完整 JSON 内容:');
        logger.error(LOG_MODULES.EVALUATION,'----------------------------------------');
        // 分段打印，避免日志截断
        const jsonContent = jsonResult.json;
        const chunkSize = 5000;
        for (let i = 0; i < jsonContent.length; i += chunkSize) {
          const chunk = jsonContent.substring(i, Math.min(i + chunkSize, jsonContent.length));
          logger.error(LOG_MODULES.EVALUATION, `[JSON内容 ${Math.floor(i/chunkSize) + 1}/${Math.ceil(jsonContent.length/chunkSize)}] ${chunk}`);
        }
        logger.error(LOG_MODULES.EVALUATION,'----------------------------------------');
        logger.error(LOG_MODULES.EVALUATION,'JSON 内容结束');
        logger.error(LOG_MODULES.EVALUATION,'========================================');
        
        logger.warn(LOG_MODULES.EVALUATION,'尝试修复 JSON...');
        
        // 尝试修复常见的 JSON 问题
        try {
          const fixedJson = fixJson(jsonResult.json);
          report = JSON.parse(fixedJson);
          logger.info(LOG_MODULES.EVALUATION,'JSON 修复后解析成功');
        } catch (fixError: unknown) {
          const fixErrorMsg = fixError instanceof Error ? fixError.message : String(fixError);
          logger.warn(LOG_MODULES.EVALUATION,`JSON 修复失败: ${fixErrorMsg}`);
          
          // 打印修复后的 JSON（调试用）
          logger.error(LOG_MODULES.EVALUATION,'修复后的 JSON 仍然无法解析');
        }
      }
    } else {
      // 没有找到 JSON 块
      logger.warn(LOG_MODULES.EVALUATION,'未找到任何 JSON 块');
      logger.warn(LOG_MODULES.EVALUATION,'========================================');
      logger.warn(LOG_MODULES.EVALUATION,'!!! 未找到 JSON 块 - 可能的漏洞文件内容 !!!');
      logger.warn(LOG_MODULES.EVALUATION, `响应长度: ${fullResponse.length}`);
      logger.warn(LOG_MODULES.EVALUATION,'----------------------------------------');
      // 查找可能的漏洞相关内容
      const vulnKeywords = ['vulnerability', 'vulnerabilities', '漏洞', '注入', 'XSS', 'CSRF', '风险', '问题'];
      const relevantParts: string[] = [];
      
      // 按段落分割响应
      const paragraphs = fullResponse.split(/\n\n+/);
      for (const para of paragraphs) {
        if (vulnKeywords.some(kw => para.toLowerCase().includes(kw.toLowerCase()))) {
          relevantParts.push(para);
        }
      }
      
      if (relevantParts.length > 0) {
        logger.warn(LOG_MODULES.EVALUATION,`找到 ${relevantParts.length} 个可能包含漏洞的段落:`);
        relevantParts.forEach((part, idx) => {
          logger.warn(LOG_MODULES.EVALUATION,`--- 段落 ${idx + 1} ---`);
          logger.warn(LOG_MODULES.EVALUATION, part.substring(0, 1000));
        });
      } else {
        // 打印前5000字符作为参考
        logger.warn(LOG_MODULES.EVALUATION,'未找到明确包含漏洞的内容，打印响应前5000字符:');
        logger.warn(LOG_MODULES.EVALUATION, fullResponse.substring(0, 5000));
      }
      logger.warn(LOG_MODULES.EVALUATION,'========================================');
    }

    // 3. 提取漏洞列表
    let vulnerabilities: ParsedVulnerability[] = [];

    if (report?.vulnerabilities && Array.isArray(report.vulnerabilities)) {
      vulnerabilities = report.vulnerabilities;
      logger.info(LOG_MODULES.EVALUATION,`从 JSON 报告中提取到 ${vulnerabilities.length} 个漏洞`);
    } else {
      // 降级：从文本中提取漏洞
      logger.warn(LOG_MODULES.EVALUATION,'JSON 中未找到漏洞列表，尝试从文本中提取...');
      vulnerabilities = extractVulnerabilitiesFromText(fullResponse);
      logger.info(LOG_MODULES.EVALUATION,`从文本中提取到 ${vulnerabilities.length} 个漏洞`);
    }

    // 4. 如果没有找到任何漏洞，记录原始响应并返回
    if (vulnerabilities.length === 0) {
      logger.error(LOG_MODULES.EVALUATION,'========================================');
      logger.error(LOG_MODULES.EVALUATION,'!!! 未找到任何漏洞 - 打印完整响应 !!!');
      logger.error(LOG_MODULES.EVALUATION,`评估ID: ${evaluationId}`);
      logger.error(LOG_MODULES.EVALUATION,`项目ID: ${projectId}`);
      logger.error(LOG_MODULES.EVALUATION,`响应长度: ${fullResponse.length} 字符`);
      logger.error(LOG_MODULES.EVALUATION,`JSON 来源: ${jsonSource}`);
      logger.error(LOG_MODULES.EVALUATION,'----------------------------------------');
      logger.error(LOG_MODULES.EVALUATION,'解析失败原因: JSON中没有漏洞列表且文本提取也为空');
      logger.error(LOG_MODULES.EVALUATION,'----------------------------------------');
      logger.error(LOG_MODULES.EVALUATION,'完整响应内容:');
      logger.error(LOG_MODULES.EVALUATION,'----------------------------------------');
      // 分段打印，避免日志截断
      const chunkSize = 5000;
      for (let i = 0; i < fullResponse.length; i += chunkSize) {
        const chunk = fullResponse.substring(i, Math.min(i + chunkSize, fullResponse.length));
        logger.error(LOG_MODULES.EVALUATION, `[响应内容 ${Math.floor(i/chunkSize) + 1}/${Math.ceil(fullResponse.length/chunkSize)}] ${chunk}`);
      }
      logger.error(LOG_MODULES.EVALUATION,'----------------------------------------');
      logger.error(LOG_MODULES.EVALUATION,'响应内容结束');
      logger.error(LOG_MODULES.EVALUATION,'========================================');
      
      // 保存一个空的结果记录，包含原始响应
      try {
        await prisma.evaluationResult.create({
          data: {
            id: `result-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            evaluationId,
            totalVulns: 0,
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            infoCount: 0,
            skillsUsed: JSON.stringify(usedSkills),
            rawReport: fullResponse.substring(0, 50000), // 限制大小
          },
        });
        logger.info(LOG_MODULES.EVALUATION,'已保存空的评估结果记录（包含原始响应）');
      } catch (dbError) {
        logger.error(LOG_MODULES.EVALUATION, '保存空结果记录失败', { details: { error: dbError instanceof Error ? dbError.message : String(dbError) } });
      }

      result.error = '未找到漏洞数据';
      return result;
    }

    // 5. 计算统计信息
    const summary = report?.summary || {};
    const stats = {
      total: summary.total || vulnerabilities.length,
      critical: summary.critical || vulnerabilities.filter(v => v.severity === 'critical').length,
      high: summary.high || vulnerabilities.filter(v => v.severity === 'high').length,
      medium: summary.medium || vulnerabilities.filter(v => v.severity === 'medium').length,
      low: summary.low || vulnerabilities.filter(v => v.severity === 'low').length,
      info: summary.info || vulnerabilities.filter(v => v.severity === 'info').length,
    };

    logger.info(LOG_MODULES.EVALUATION,'漏洞统计:');
    logger.info(LOG_MODULES.EVALUATION,`  - 总数: ${stats.total}`);
    logger.info(LOG_MODULES.EVALUATION,`  - 严重: ${stats.critical}`);
    logger.info(LOG_MODULES.EVALUATION,`  - 高危: ${stats.high}`);
    logger.info(LOG_MODULES.EVALUATION,`  - 中危: ${stats.medium}`);
    logger.info(LOG_MODULES.EVALUATION,`  - 低危: ${stats.low}`);
    logger.info(LOG_MODULES.EVALUATION,`  - 信息: ${stats.info}`);

    // 6. 保存评估结果摘要
    try {
      // 先检查是否已存在
      const existing = await prisma.evaluationResult.findUnique({
        where: { evaluationId },
      });

      if (existing) {
        logger.info(LOG_MODULES.EVALUATION,'更新已存在的评估结果');
        await prisma.evaluationResult.update({
          where: { evaluationId },
          data: {
            totalVulns: stats.total,
            criticalCount: stats.critical,
            highCount: stats.high,
            mediumCount: stats.medium,
            lowCount: stats.low,
            infoCount: stats.info,
            skillsUsed: JSON.stringify([...(summary.skills_used || []), ...usedSkills].filter((v, i, a) => a.indexOf(v) === i)),
            rawReport: jsonResult?.json || fullResponse.substring(0, 50000),
          },
        });
      } else {
        await prisma.evaluationResult.create({
          data: {
            id: `result-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            evaluationId,
            totalVulns: stats.total,
            criticalCount: stats.critical,
            highCount: stats.high,
            mediumCount: stats.medium,
            lowCount: stats.low,
            infoCount: stats.info,
            skillsUsed: JSON.stringify([...(summary.skills_used || []), ...usedSkills].filter((v, i, a) => a.indexOf(v) === i)),
            rawReport: jsonResult?.json || fullResponse.substring(0, 50000),
          },
        });
      }
      logger.info(LOG_MODULES.EVALUATION,'评估结果摘要已保存');
    } catch (dbError) {
      logger.error(LOG_MODULES.EVALUATION, '保存评估结果摘要失败', { details: { error: dbError instanceof Error ? dbError.message : String(dbError) } });
      result.error = `保存摘要失败: ${dbError}`;
      return result;
    }

    // 7. 保存漏洞详情
    // [已禁用] 漏洞入库统一在 evaluation-completion.ts 的 completeEvaluation 函数处理
    // 此处不再调用 prisma.vulnerability.create，避免重复入库
    let savedCount = 0;
    let failedCount = 0;

    logger.info(LOG_MODULES.EVALUATION,`[已禁用] 漏洞入库跳过 - 统一在评估结束时处理`);
    logger.info(LOG_MODULES.EVALUATION,`发现漏洞 ${vulnerabilities.length} 个，将在评估结束后统一入库`);

    logger.info(LOG_MODULES.EVALUATION,'========================================');
    logger.info(LOG_MODULES.EVALUATION,'漏洞保存完成');
    logger.info(LOG_MODULES.EVALUATION,`发现漏洞文件: ${vulnerabilities.length} 个`);
    logger.info(LOG_MODULES.EVALUATION,`成功入库: ${savedCount} 个`);
    if (failedCount > 0) {
      logger.warn(LOG_MODULES.EVALUATION,`入库失败: ${failedCount} 个`);
    }
    logger.info(LOG_MODULES.EVALUATION,'========================================');

    result.success = true;
    result.vulnCount = savedCount;
    return result;

  } catch (error: unknown) {
    logger.error(LOG_MODULES.EVALUATION,'========================================');
    logger.error(LOG_MODULES.EVALUATION,'解析结果失败');
    logger.error(LOG_MODULES.EVALUATION,String(error));
    logger.error(LOG_MODULES.EVALUATION,'========================================');
    
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

/**
 * 尝试修复常见的 JSON 问题
 */
function fixJson(json: string): string {
  let fixed = json;

  // 移除末尾的逗号
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // 修复未转义的引号（简单情况）
  // fixed = fixed.replace(/(?<!\\)"([^"]*)"([^":,}\]]*)"([^"]*)"(?!\s*:)/g, '"$1\\"$2\\"$3"');

  // 移除注释
  fixed = fixed.replace(/\/\/.*$/gm, '');
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

  return fixed;
}

/**
 * 仅解析结果，不保存（用于预览）
 */
export function parseResultsOnly(fullResponse: string): {
  vulnerabilities: ParsedVulnerability[];
  skills: string[];
  rawJson: string | null;
} {
  const skills = extractUsedSkills(fullResponse);
  const jsonResult = extractJsonBlock(fullResponse);
  
  let vulnerabilities: ParsedVulnerability[] = [];
  let rawJson: string | null = null;

  if (jsonResult) {
    try {
      const report = JSON.parse(jsonResult.json);
      rawJson = jsonResult.json;
      if (report.vulnerabilities && Array.isArray(report.vulnerabilities)) {
        vulnerabilities = report.vulnerabilities;
      }
    } catch {
      // 忽略解析错误
    }
  }

  if (vulnerabilities.length === 0) {
    vulnerabilities = extractVulnerabilitiesFromText(fullResponse);
  }

  return { vulnerabilities, skills, rawJson };
}
