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

const BACKTEST_SYSTEM_PROMPT = `你是一个安全检测专家，负责模拟 Skill 对特定案例进行分析。

**任务**：
判断给定的案例是否应该被报告为漏洞。

**输出格式**：
只输出 JSON 对象：{"shouldReport": true/false, "reason": "简短原因"}

**重要**：
- shouldReport: true 表示 Skill 应该报告此案例为漏洞
- shouldReport: false 表示 Skill 不应该报告此案例（排除误报）
- reason: 简短说明判断理由（1-2句话）`;

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
${caseItem.location ? `- **代码位置**: ${caseItem.location}` : ''}
${caseItem.sourceCodePreview ? `- **源代码预览**:\n\`\`\`\n${caseItem.sourceCodePreview}\n\`\`\`` : ''}

**问题**: 根据 Skill 定义，这个案例是否应该被报告为漏洞？

请输出 JSON:`;
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

    // 方式3: 查找独立的 JSON 对象
    if (!parsed) {
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        const jsonStr = content.substring(jsonStart, jsonEnd + 1);
        try {
          // 清理可能的问题字符
          const cleaned = jsonStr
            .replace(/[\u0000-\u001F]/g, '') // 移除控制字符
            .replace(/\\n/g, '\n') // 处理转义换行
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t');
          parsed = JSON.parse(cleaned);
        } catch (e) {
          console.warn('[Backtest] Failed to parse inline JSON:', e);
        }
      }
    }

    // 方式4: 根据关键词判断
    if (!parsed) {
      const lowerContent = content.toLowerCase();
      if (lowerContent.includes('shouldreport: true') || 
          lowerContent.includes('should report') && lowerContent.includes('true')) {
        parsed = { shouldReport: true, reason: 'Parsed from text' };
      } else if (lowerContent.includes('shouldreport: false') ||
                 lowerContent.includes('should report') && lowerContent.includes('false')) {
        parsed = { shouldReport: false, reason: 'Parsed from text' };
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
    recommendation = `回测验证成功：排除率 ${(falsePositiveExclusionRate * 100).toFixed(1)}% (${falsePositiveFixed}/${limitedFP.length})，正确发现全部检出 (${confirmedDetected}/${limitedCC.length})。`;
  } else if (confirmedMissed > 0) {
    recommendation = `回测失败：漏检 ${confirmedMissed} 个确认问题（不允许漏检），必须重新进化。`;
  } else if (falsePositiveExclusionRate < 0.5) {
    recommendation = `回测失败：排除率 ${(falsePositiveExclusionRate * 100).toFixed(1)}% (${falsePositiveFixed}/${limitedFP.length}) < 50%，未达标，必须重新进化。`;
  } else {
    recommendation = `回测结果：排除率 ${(falsePositiveExclusionRate * 100).toFixed(1)}%，漏检数 ${confirmedMissed}。`;
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