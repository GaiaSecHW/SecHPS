/**
 * 解析 AI 响应中的结构化信息
 */

export interface ParsedVulnerability {
  title: string;
  description: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  codeSnippet?: string;
  recommendation?: string;
  cwe?: string;
  cve?: string;
  confidence: number; // 0-100
}

export interface ParsedToolCall {
  tool: string;
  parameters: Record<string, unknown>;
  callId?: string;
}

export interface ParsedResult {
  vulnerabilities: ParsedVulnerability[];
  toolCalls: ParsedToolCall[];
  summary: string;
  rawResponse: string;
  needsToolCall: boolean;
}

// 工具调用正则表达式模式
const TOOL_CALL_PATTERN = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const TOOL_NAME_PATTERN = /"tool"\s*:\s*"([^"]+)"/;
const TOOL_PARAMS_PATTERN = /"parameters"\s*:\s*(\{[\s\S]*?\})/;

// 漏洞报告正则表达式模式
const VULNERABILITY_PATTERN = /<vulnerability>\s*([\s\S]*?)\s*<\/vulnerability>/gi;
const SEVERITY_PATTERN = /"severity"\s*:\s*"(critical|high|medium|low|info)"/i;
const TITLE_PATTERN = /"title"\s*:\s*"([^"]+)"/;
const DESCRIPTION_PATTERN = /"description"\s*:\s*"([^"]+)"/;
const FILE_PATH_PATTERN = /"filePath"\s*:\s*"([^"]+)"/;
const LINE_PATTERN = /"line(?:Start|End)"\s*:\s*(\d+)/g;
const CWE_PATTERN = /"cwe"\s*:\s*"([^"]+)"/;
const CONFIDENCE_PATTERN = /"confidence"\s*:\s*(\d+)/;

// 摘要提取模式
const SUMMARY_PATTERN = /<summary>\s*([\s\S]*?)\s*<\/summary>/i;

/**
 * 解析 AI 响应
 */
export function parseAIResponse(response: string): ParsedResult {
  const vulnerabilities: ParsedVulnerability[] = [];
  const toolCalls: ParsedToolCall[] = [];
  let summary = '';

  // 解析工具调用
  let toolMatch;
  while ((toolMatch = TOOL_CALL_PATTERN.exec(response)) !== null) {
    const toolBlock = toolMatch[1];
    const toolCall = parseToolCall(toolBlock);
    if (toolCall) {
      toolCalls.push(toolCall);
    }
  }

  // 解析漏洞报告
  let vulnMatch;
  while ((vulnMatch = VULNERABILITY_PATTERN.exec(response)) !== null) {
    const vulnBlock = vulnMatch[1];
    const vulnerability = parseVulnerability(vulnBlock);
    if (vulnerability) {
      vulnerabilities.push(vulnerability);
    }
  }

  // 解析摘要
  const summaryMatch = SUMMARY_PATTERN.exec(response);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  } else {
    // 如果没有明确的摘要，取前500字符
    summary = response.slice(0, 500).replace(/<[^>]+>/g, '').trim();
    if (summary.length === 0) {
      summary = '分析完成';
    }
  }

  return {
    vulnerabilities,
    toolCalls,
    summary,
    rawResponse: response,
    needsToolCall: toolCalls.length > 0,
  };
}

/**
 * 解析工具调用
 */
function parseToolCall(block: string): ParsedToolCall | null {
  try {
    // 尝试 JSON 解析
    const jsonMatch = block.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        tool: parsed.tool || parsed.name || '',
        parameters: parsed.parameters || parsed.args || {},
        callId: parsed.callId || parsed.id,
      };
    }

    // 使用正则表达式解析
    const toolMatch = block.match(TOOL_NAME_PATTERN);
    if (!toolMatch) return null;

    const paramsMatch = block.match(TOOL_PARAMS_PATTERN);
    const parameters = paramsMatch ? JSON.parse(paramsMatch[1]) : {};

    return {
      tool: toolMatch[1],
      parameters,
    };
  } catch (error) {
    console.error('[ResultParser] 解析工具调用失败:', error);
    return null;
  }
}

/**
 * 解析漏洞信息
 */
function parseVulnerability(block: string): ParsedVulnerability | null {
  try {
    // 尝试 JSON 解析
    const jsonMatch = block.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || '未命名漏洞',
        description: parsed.description || '',
        type: parsed.type || 'unknown',
        severity: parseSeverity(parsed.severity),
        filePath: parsed.filePath || parsed.file,
        lineStart: parsed.lineStart || parsed.line,
        lineEnd: parsed.lineEnd || parsed.line,
        codeSnippet: parsed.codeSnippet || parsed.code,
        recommendation: parsed.recommendation || parsed.fix,
        cwe: parsed.cwe,
        cve: parsed.cve,
        confidence: parsed.confidence || 80,
      };
    }

    // 使用正则表达式解析
    const titleMatch = block.match(TITLE_PATTERN);
    if (!titleMatch) return null;

    const severityMatch = block.match(SEVERITY_PATTERN);
    const descriptionMatch = block.match(DESCRIPTION_PATTERN);
    const filePathMatch = block.match(FILE_PATH_PATTERN);
    const cweMatch = block.match(CWE_PATTERN);
    const confidenceMatch = block.match(CONFIDENCE_PATTERN);

    // 解析行号
    let lineStart: number | undefined;
    let lineEnd: number | undefined;
    let lineMatch;
    while ((lineMatch = LINE_PATTERN.exec(block)) !== null) {
      const num = parseInt(lineMatch[1], 10);
      if (lineStart === undefined) {
        lineStart = num;
      }
      lineEnd = num;
    }

    return {
      title: titleMatch[1],
      description: descriptionMatch?.[1] || '',
      type: 'unknown',
      severity: severityMatch ? parseSeverity(severityMatch[1]) : 'medium',
      filePath: filePathMatch?.[1],
      lineStart,
      lineEnd,
      cwe: cweMatch?.[1],
      confidence: confidenceMatch ? parseInt(confidenceMatch[1], 10) : 80,
    };
  } catch (error) {
    console.error('[ResultParser] 解析漏洞失败:', error);
    return null;
  }
}

/**
 * 解析严重程度
 */
function parseSeverity(severity: string | undefined): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (!severity) return 'medium';

  const normalized = severity.toLowerCase();
  if (normalized === 'critical' || normalized === '严重') return 'critical';
  if (normalized === 'high' || normalized === '高危') return 'high';
  if (normalized === 'medium' || normalized === '中危') return 'medium';
  if (normalized === 'low' || normalized === '低危') return 'low';
  if (normalized === 'info' || normalized === '信息') return 'info';

  return 'medium';
}

/**
 * 从响应中提取 JSON 内容
 */
export function extractJSON(response: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const jsonPattern = /```json\s*([\s\S]*?)\s*```/gi;

  let match;
  while ((match = jsonPattern.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      results.push(parsed);
    } catch {
      // 忽略解析错误
    }
  }

  // 尝试直接解析 JSON 对象
  const jsonObjectPattern = /\{[\s\S]*?\}/g;
  while ((match = jsonObjectPattern.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed === 'object' && parsed !== null) {
        results.push(parsed);
      }
    } catch {
      // 忽略解析错误
    }
  }

  return results;
}
