import { routeRequestWithDefaultModel } from '@/lib/model-client';
import type { CompactCase } from './case-extractor';
import { getEvolutionConfig, DEFAULT_EVOLUTION_CONFIG } from './evolution-scheduler';
import { getEvolutionPrompt } from './prompt-manager';

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export interface BacktestResult {
  falsePositiveResults: Array<{
    case: CompactCase;
    newSkillReports: boolean;
    expected: 'not report';
    passed: boolean;
    reason?: string;
  }>;
  confirmedResults: Array<{
    case: CompactCase;
    newSkillReports: boolean;
    expected: 'report';
    passed: boolean;
    reason?: string;
  }>;
  summary: {
    totalCases: number;
    falsePositiveFixed: number;
    falsePositiveRemaining: number;
    confirmedDetected: number;
    confirmedMissed: number;
    passedCount: number;
    failedCount: number;
    backtestPrecision: number;
    improvementScore: number;
    falsePositiveExclusionRate: number;
  };
  isSuccessful: boolean;
  recommendation: string;
}

export interface BacktestDetailRow {
  caseId: string;
  caseTitle: string;
  caseType: '误报案例' | '正确发现案例';
  expectedAction: '不应报告' | '应报告';
  newSkillAction: '未报告' | '已报告';
  passed: boolean;
  reason: string;
  vulnerabilityId: string;
}

const BACKTEST_SYSTEM_PROMPT = `你是一个安全检测专家。

**任务**：判断给定案例是否应被报告为漏洞。

**输出要求**：
必须只输出一行 JSON，不要有任何其他文字、分析过程或解释。
格式：{"shouldReport":true,"reason":"简短原因"}

或：{"shouldReport":false,"reason":"简短原因"}

**禁止输出**：
- 不要输出思考过程
- 不要输出分析步骤
- 不要输出代码片段
- 不要输出 markdown 格式
- 不要输出任何非 JSON 内容

**示例正确输出**：
{"shouldReport":true,"reason":"用户输入直接拼接到 Runtime.exec，存在命令注入漏洞"}
{"shouldReport":false,"reason":"参数经过安全过滤，不存在漏洞"}

现在开始分析，只输出 JSON：`;

function buildBacktestPrompt(skillContent: string, caseItem: CompactCase): string {
  const truncateContent = (content: string, maxLen: number = DEFAULT_EVOLUTION_CONFIG.MAX_SKILL_CONTENT_LENGTH): string => {
    if (content.length <= maxLen) return content;
    return content.substring(0, maxLen) + '\n... (已截断)';
  };

  return `## Skill 定义
\`\`\`markdown
${truncateContent(skillContent)}
\`\`\`

## 待分析案例
- **标题**: ${caseItem.title}
- **描述**: ${caseItem.description}
${caseItem.location ? `- **源代码**:\n\`\`\`\n${caseItem.location}\n\`\`\`` : ''}

根据 Skill 定义判断此案例是否应报告为漏洞。只输出 JSON，不要分析过程：`;
}

async function testSingleCase(skillContent: string, caseItem: CompactCase): Promise<{
  shouldReport: boolean;
  reason: string;
}> {
  try {
    const prompt = buildBacktestPrompt(skillContent, caseItem);
    
    const response = await routeRequestWithDefaultModel(
      [{ role: 'user', content: prompt }],
      {
        system: BACKTEST_SYSTEM_PROMPT,
        max_tokens: 200,
        context: {
          userId: 'system',
          scene: 'skill-evolution',
          description: 'Skill 回测验证',
        },
      }
    );

    let content = '';
    if (response?.content?.[0]?.text) {
      content = response.content[0].text;
    } else if (response?.choices?.[0]?.message?.content) {
      content = response.choices[0].message.content;
    } else if (response?.text) {
      content = response.text;
    }

    console.log('[Backtest] LLM response:', content);

    // 去掉思考标签包裹的内容（只保留标签外的 JSON）
    content = content.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '');
    content = content.replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '');
    content = content.trim();

    console.log('[Backtest] After removing think tags:', content);

    // 尝试多种方式解析 JSON
    let parsed: { shouldReport?: boolean; reason?: string } | null = null;

    // 方式1: 从 ```json 代码块提取
    const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      try {
        parsed = JSON.parse(jsonBlockMatch[1].trim());
      } catch {
        console.warn('[Backtest] Failed to parse json block');
      }
    }

    // 方式2: 从 ``` 代码块提取
    if (!parsed) {
      const codeBlockMatch = content.match(/```\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        try {
          parsed = JSON.parse(codeBlockMatch[1].trim());
        } catch {
          console.warn('[Backtest] Failed to parse code block');
        }
      }
    }

    // 方式3: 查找包含 shouldReport 的 JSON 对象
    if (!parsed) {
      // 优先查找包含 shouldReport 的对象
      const shouldReportPattern = /{\s*"shouldReport"\s*:/i;
      const match = content.match(shouldReportPattern);
      
      if (match && match.index !== undefined) {
        const jsonStart = match.index;
        let braceCount = 0;
        let jsonEnd = -1;
        for (let i = jsonStart; i < content.length; i++) {
          if (content[i] === '{') braceCount++;
          else if (content[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              jsonEnd = i;
              break;
            }
          }
        }
        
        if (jsonEnd !== -1) {
          const jsonStr = content.substring(jsonStart, jsonEnd + 1);
          try {
            // 清理可能的问题字符
            let cleaned = jsonStr
              .replace(/[\u0000-\u001F]/g, '')
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '\r')
              .replace(/\\t/g, '\t');
            
            // 尝试修复常见的 JSON 格式问题
            console.log('[Backtest] Original JSON string:', JSON.stringify(cleaned));
            
            // 修复 = 为 : 并添加引号 (command = "whoami" -> "command": "whoami")
            cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*/g, '$1"$2": ');
            console.log('[Backtest] After = replacement:', JSON.stringify(cleaned));
            
            // 移除值末尾的分号 ("whoami"; -> "whoami")
            cleaned = cleaned.replace(/"\s*;\s*([},])/g, '"$1');
            console.log('[Backtest] After semicolon removal:', JSON.stringify(cleaned));
            
            // 修复未加引号的属性名 (shouldReport: -> "shouldReport":)
            cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
            console.log('[Backtest] Final cleaned:', JSON.stringify(cleaned));
            
            parsed = JSON.parse(cleaned);
          } catch (e) {
            console.warn('[Backtest] Failed to parse inline JSON:', e);
            console.warn('[Backtest] Attempted JSON string:', jsonStr.substring(0, 200));
          }
        }
      }
    }

    // 方式4: 根据关键词判断
    if (!parsed) {
      const lowerContent = content.toLowerCase();
      
      // 显式的 JSON 格式关键词
      if (lowerContent.includes('shouldreport: true') || 
          lowerContent.includes('should report') && lowerContent.includes('true')) {
        parsed = { shouldReport: true, reason: 'Parsed from text keyword' };
      } else if (lowerContent.includes('shouldreport: false') ||
                 lowerContent.includes('should report') && lowerContent.includes('false')) {
        parsed = { shouldReport: false, reason: 'Parsed from text keyword' };
      }
      // 根据分析结论推断
      else if (lowerContent.includes('应该报告') || 
               lowerContent.includes('应报告') ||
               lowerContent.includes('是漏洞') ||
               lowerContent.includes('确认漏洞') ||
               lowerContent.includes('符合漏洞') ||
               lowerContent.includes('需要报告')) {
        parsed = { shouldReport: true, reason: 'Inferred from analysis (should report)' };
      } else if (lowerContent.includes('不应报告') ||
                 lowerContent.includes('不应该报告') ||
                 lowerContent.includes('误报') ||
                 lowerContent.includes('非漏洞') ||
                 lowerContent.includes('排除') ||
                 lowerContent.includes('不满足漏洞')) {
        parsed = { shouldReport: false, reason: 'Inferred from analysis (false positive)' };
      }
    }

    if (parsed) {
      return {
        shouldReport: parsed.shouldReport ?? false,
        reason: parsed.reason ?? '',
      };
    }

    return { shouldReport: false, reason: `Failed to parse: ${content.substring(0, 100)}` };
  } catch (error) {
    console.error('[Backtest] Test case failed:', error);
    return { shouldReport: false, reason: `Error: ${error instanceof Error ? error.message : 'Unknown'}` };
  }
}

export function getBacktestDetailRows(result: BacktestResult): BacktestDetailRow[] {
  const rows: BacktestDetailRow[] = [];
  
  for (const r of result.falsePositiveResults) {
    rows.push({
      caseId: r.case.vulnerabilityId,
      caseTitle: r.case.title,
      caseType: '误报案例',
      expectedAction: '不应报告',
      newSkillAction: r.newSkillReports ? '已报告' : '未报告',
      passed: r.passed,
      reason: r.reason || '',
      vulnerabilityId: r.case.vulnerabilityId,
    });
  }
  
  for (const r of result.confirmedResults) {
    rows.push({
      caseId: r.case.vulnerabilityId,
      caseTitle: r.case.title,
      caseType: '正确发现案例',
      expectedAction: '应报告',
      newSkillAction: r.newSkillReports ? '已报告' : '未报告',
      passed: r.passed,
      reason: r.reason || '',
      vulnerabilityId: r.case.vulnerabilityId,
    });
  }
  
  return rows;
}

export async function runBacktest(
  newSkillContent: string,
  falsePositiveCases: CompactCase[],
  confirmedCases: CompactCase[],
  options?: { maxCases?: number }
): Promise<BacktestResult> {
  const maxCases = options?.maxCases ?? 10;
  
  // 数据采样策略：数据量 <= maxCases 时全部使用，否则随机采样
  let limitedFP: CompactCase[];
  let limitedCC: CompactCase[];
  
  if (falsePositiveCases.length <= maxCases) {
    limitedFP = falsePositiveCases;
  } else {
    // 随机采样
    limitedFP = shuffleArray(falsePositiveCases).slice(0, maxCases);
  }
  
  if (confirmedCases.length <= maxCases) {
    limitedCC = confirmedCases;
  } else {
    limitedCC = shuffleArray(confirmedCases).slice(0, maxCases);
  }

  console.log(`[Backtest] Running backtest: ${limitedFP.length}/${falsePositiveCases.length} FP cases, ${limitedCC.length}/${confirmedCases.length} CC cases`);

  const falsePositiveResults: BacktestResult['falsePositiveResults'] = [];
  const confirmedResults: BacktestResult['confirmedResults'] = [];

  for (const caseItem of limitedFP) {
    const result = await testSingleCase(newSkillContent, caseItem);
    falsePositiveResults.push({
      case: caseItem,
      newSkillReports: result.shouldReport,
      expected: 'not report',
      passed: !result.shouldReport,
      reason: result.reason,
    });
  }

  for (const caseItem of limitedCC) {
    const result = await testSingleCase(newSkillContent, caseItem);
    confirmedResults.push({
      case: caseItem,
      newSkillReports: result.shouldReport,
      expected: 'report',
      passed: result.shouldReport,
      reason: result.reason,
    });
  }

  const falsePositiveFixed = falsePositiveResults.filter(r => r.passed).length;
  const falsePositiveRemaining = falsePositiveResults.filter(r => !r.passed).length;
  const confirmedDetected = confirmedResults.filter(r => r.passed).length;
  const confirmedMissed = confirmedResults.filter(r => !r.passed).length;

  const totalCases = limitedFP.length + limitedCC.length;
  const passedCount = falsePositiveFixed + confirmedDetected;
  const failedCount = falsePositiveRemaining + confirmedMissed;

  const backtestPrecision = totalCases > 0 ? passedCount / totalCases : 0;

  const falsePositiveExclusionRate = limitedFP.length > 0 
    ? falsePositiveFixed / limitedFP.length 
    : 0;

  const improvementScore = (falsePositiveExclusionRate) * 0.6 + 
                           (limitedCC.length > 0 ? confirmedDetected / limitedCC.length : 0) * 0.4;

  // 达标标准：漏检数 = 0 且 排除率 >= 50%
  const isSuccessful = confirmedMissed === 0 && falsePositiveExclusionRate >= 0.5;

  let recommendation: string;
  if (isSuccessful) {
    recommendation = `验证通过！改进后的 Skill 排除了 ${falsePositiveFixed} 个误报（占 ${limitedFP.length} 个误报案例的 ${(falsePositiveExclusionRate * 100).toFixed(1)}%），同时仍能正确检出所有 ${confirmedDetected} 个真实漏洞。`;
  } else if (confirmedMissed > 0) {
    recommendation = `验证失败：改进后的 Skill 未能检出 ${confirmedMissed} 个真实漏洞（共 ${limitedCC.length} 个真实漏洞案例）。漏检真实漏洞是严重问题，会导致安全隐患被忽略，必须重新改进 Skill。`;
  } else if (falsePositiveExclusionRate < 0.5) {
    recommendation = `验证失败：改进后的 Skill 仅排除了 ${falsePositiveFixed} 个误报（排除率 ${(falsePositiveExclusionRate * 100).toFixed(1)}%），低于 50% 的达标要求。误报仍太多，需要进一步优化 Skill 以减少误报。`;
  } else {
    recommendation = `验证结果：排除率 ${(falsePositiveExclusionRate * 100).toFixed(1)}%，漏检数 ${confirmedMissed}。`;
  }

  return {
    falsePositiveResults,
    confirmedResults,
    summary: {
      totalCases,
      falsePositiveFixed,
      falsePositiveRemaining,
      confirmedDetected,
      confirmedMissed,
      passedCount,
      failedCount,
      backtestPrecision,
      improvementScore,
      falsePositiveExclusionRate,
    },
    isSuccessful,
    recommendation,
  };
}