// src/services/evaluation/verifiers/index.ts
//
// Ralph Loop Agent 完成验证器
// 提供多种验证策略来判断任务是否真正完成
//

import type { VerifyCompletionFunction, VerifyCompletionContext, VerifyCompletionResult } from '../ralph-loop-agent-evaluator';

/**
 * 安全审计专用验证器
 * 
 * 检测场景：
 * 1. 评估完成标记 [EVALUATION_COMPLETE:...]
 * 2. JSON 格式的漏洞报告
 * 3. 工作流节点完成标记
 * 4. 明确的完成声明
 */
export const securityAuditVerifier: VerifyCompletionFunction = (context) => {
  const text = context.result.text;
  
  // 1. 检查评估完成标记 [EVALUATION_COMPLETE: total=X, critical=X, ...]
  if (text.includes('[EVALUATION_COMPLETE:')) {
    const match = text.match(/\[EVALUATION_COMPLETE:\s*total=(\d+)/);
    if (match) {
      return {
        complete: true,
        reason: `安全审计完成，发现 ${match[1]} 个漏洞`,
      };
    }
    return {
      complete: true,
      reason: '检测到评估完成标记',
    };
  }
  
  // 2. 检查 JSON 格式的漏洞报告
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const report = JSON.parse(jsonMatch[1].trim());
      
      // 检查标准报告格式
      if (report.summary?.total !== undefined) {
        return {
          complete: true,
          reason: `漏洞报告生成完成: ${report.summary.total} 个问题`,
        };
      }
      
      // 检查漏洞数组
      if (report.vulnerabilities && Array.isArray(report.vulnerabilities)) {
        return {
          complete: true,
          reason: `发现 ${report.vulnerabilities.length} 个漏洞`,
        };
      }
      
      // 检查 skills_used
      if (report.skills_used && Array.isArray(report.skills_used)) {
        return {
          complete: true,
          reason: `使用 ${report.skills_used.length} 个技能完成审计`,
        };
      }
    } catch {
      // JSON 解析失败，继续检查其他条件
    }
  }
  
  // 3. 检查工作流节点完成
  const nodeMatches = text.match(/\[EVALUATION_NODE_COMPLETE:\s*nodeId=([^\]]+)\]/g);
  if (nodeMatches && nodeMatches.length > 0) {
    // 有节点完成，提供进度反馈
    return {
      complete: false,
      reason: `已完成 ${nodeMatches.length} 个审计节点，继续执行...`,
    };
  }
  
  // 4. 检查明确的完成声明
  const completionPhrases = [
    '审计完成',
    '评估完成',
    '扫描完成',
    '安全审计已完成',
    '漏洞扫描已完成',
    'audit complete',
    'evaluation complete',
    'scan complete',
    'security audit finished',
  ];
  
  const lowerText = text.toLowerCase();
  for (const phrase of completionPhrases) {
    if (lowerText.includes(phrase.toLowerCase())) {
      return {
        complete: true,
        reason: `检测到完成声明: "${phrase}"`,
      };
    }
  }
  
  // 5. 检查是否有明确的"继续工作"信号
  const continuingPhrases = [
    '继续分析',
    '继续执行',
    '正在扫描',
    'continue analyzing',
    'continuing',
    'in progress',
  ];
  
  for (const phrase of continuingPhrases) {
    if (lowerText.includes(phrase.toLowerCase())) {
      return {
        complete: false,
        reason: 'AI 正在继续工作...',
      };
    }
  }
  
  // 6. 未完成，提供引导性反馈
  const feedback = generateProgressiveFeedback(context.iteration);
  return {
    complete: false,
    reason: feedback,
  };
};

/**
 * 生成渐进式反馈
 * 随着迭代次数增加，反馈更加具体
 */
function generateProgressiveFeedback(iteration: number): string {
  if (iteration <= 2) {
    return '请继续执行安全审计任务';
  } else if (iteration <= 5) {
    return '请继续审计，完成后请明确声明"审计完成"或生成 JSON 格式的漏洞报告';
  } else if (iteration <= 10) {
    return '审计已进行多轮，请尽快完成剩余工作并输出最终报告。报告格式：```json\\n{"summary": {"total": N, ...}, "vulnerabilities": [...]}\\n```';
  } else {
    return '即将达到最大迭代次数，请立即输出当前审计结果作为最终报告';
  }
}

/**
 * 基于关键词的验证器工厂
 * 
 * @param completeKeywords - 表示完成的关键词列表
 * @param continuingKeywords - 表示继续的关键词列表（可选）
 */
export const createKeywordVerifier = (
  completeKeywords: string[],
  continuingKeywords?: string[]
): VerifyCompletionFunction => {
  return (context: VerifyCompletionContext): VerifyCompletionResult => {
    const text = context.result.text.toLowerCase();
    
    // 检查完成关键词
    for (const keyword of completeKeywords) {
      if (text.includes(keyword.toLowerCase())) {
        return {
          complete: true,
          reason: `检测到完成关键词: "${keyword}"`,
        };
      }
    }
    
    // 检查继续关键词
    if (continuingKeywords) {
      for (const keyword of continuingKeywords) {
        if (text.includes(keyword.toLowerCase())) {
          return {
            complete: false,
            reason: `检测到继续信号: "${keyword}"`,
          };
        }
      }
    }
    
    return {
      complete: false,
      reason: '请继续完成任务',
    };
  };
};

/**
 * 基于 JSON 报告的验证器
 * 
 * @param requiredFields - JSON 报告必须包含的字段
 */
export const createJsonReportVerifier = (
  requiredFields: string[] = ['summary', 'total']
): VerifyCompletionFunction => {
  return (context: VerifyCompletionContext): VerifyCompletionResult => {
    const text = context.result.text;
    
    // 查找 JSON 代码块
    const jsonMatches = text.matchAll(/```json\s*([\s\S]*?)```/g);
    
    for (const match of jsonMatches) {
      try {
        const jsonStr = match[1].trim();
        const report = JSON.parse(jsonStr);
        
        // 检查必需字段
        const hasAllFields = requiredFields.every(field => {
          const parts = field.split('.');
          let obj: any = report;
          for (const part of parts) {
            if (obj && typeof obj === 'object' && part in obj) {
              obj = obj[part];
            } else {
              return false;
            }
          }
          return true;
        });
        
        if (hasAllFields) {
          // 提取总数
          const total = report.summary?.total ?? report.total ?? Object.keys(report.vulnerabilities || {}).length;
          return {
            complete: true,
            reason: `JSON 报告验证通过，包含所有必需字段，共 ${total} 个结果`,
          };
        }
      } catch {
        // 解析失败，继续检查下一个
      }
    }
    
    return {
      complete: false,
      reason: '请生成包含完整字段的 JSON 报告',
    };
  };
};

/**
 * 组合验证器
 * 
 * @param verifiers - 验证器数组
 * @param mode - 'any' 任一通过即完成，'all' 全部通过才完成
 */
export const createCombinedVerifier = (
  verifiers: VerifyCompletionFunction[],
  mode: 'any' | 'all' = 'any'
): VerifyCompletionFunction => {
  return async (context: VerifyCompletionContext): Promise<VerifyCompletionResult> => {
    const results = await Promise.all(
      verifiers.map(v => Promise.resolve(v(context)))
    );
    
    if (mode === 'any') {
      // 任一验证器返回 complete=true 即完成
      const completed = results.find(r => r.complete);
      if (completed) {
        return completed;
      }
      
      // 收集所有反馈
      const reasons = results
        .filter(r => r.reason)
        .map(r => r.reason)
        .filter((v, i, a) => a.indexOf(v) === i); // 去重
      
      return {
        complete: false,
        reason: reasons.length > 0 ? reasons.join('; ') : '请继续完成任务',
      };
    } else {
      // 所有验证器都返回 complete=true 才完成
      const allComplete = results.every(r => r.complete);
      if (allComplete) {
        return {
          complete: true,
          reason: '所有验证条件已满足',
        };
      }
      
      // 收集未完成的反馈
      const failedReasons = results
        .filter(r => !r.complete && r.reason)
        .map(r => r.reason);
      
      return {
        complete: false,
        reason: failedReasons.length > 0 ? failedReasons.join('; ') : '部分条件未满足',
      };
    }
  };
};

/**
 * 迭代次数限制验证器
 * 强制在指定迭代次数后完成
 * 
 * @param maxIterations - 最大迭代次数
 */
export const createMaxIterationsVerifier = (
  maxIterations: number
): VerifyCompletionFunction => {
  return (context: VerifyCompletionContext): VerifyCompletionResult => {
    if (context.iteration >= maxIterations) {
      return {
        complete: true,
        reason: `已达到最大迭代次数 ${maxIterations}，强制完成`,
      };
    }
    
    return {
      complete: false,
      reason: `当前第 ${context.iteration} 次迭代，剩余 ${maxIterations - context.iteration} 次`,
    };
  };
};

/**
 * 工作流节点验证器
 * 检查所有工作流节点是否完成
 * 
 * @param expectedNodeCount - 预期的节点数量（可选，不提供则检查是否有任意节点完成）
 */
export const createWorkflowNodeVerifier = (
  expectedNodeCount?: number
): VerifyCompletionFunction => {
  return (context: VerifyCompletionContext): VerifyCompletionResult => {
    const text = context.result.text;
    const nodeMatches = text.match(/\[EVALUATION_NODE_COMPLETE:\s*nodeId=([^\]]+)\]/g);
    
    if (!nodeMatches || nodeMatches.length === 0) {
      return {
        complete: false,
        reason: '尚未有工作流节点完成',
      };
    }
    
    const completedCount = nodeMatches.length;
    
    if (expectedNodeCount !== undefined) {
      if (completedCount >= expectedNodeCount) {
        return {
          complete: true,
          reason: `所有 ${expectedNodeCount} 个工作流节点已完成`,
        };
      }
      
      return {
        complete: false,
        reason: `已完成 ${completedCount}/${expectedNodeCount} 个工作流节点`,
      };
    }
    
    // 没有预期数量，只要检查最终完成标记
    if (text.includes('[EVALUATION_COMPLETE:')) {
      return {
        complete: true,
        reason: '检测到评估完成标记',
      };
    }
    
    return {
      complete: false,
      reason: `已完成 ${completedCount} 个节点，等待最终完成`,
    };
  };
};

/**
 * 自定义函数验证器
 * 使用自定义函数判断完成状态
 * 
 * @param verifyFn - 自定义验证函数
 */
export const createCustomVerifier = (
  verifyFn: (text: string, iteration: number) => boolean | { complete: boolean; reason?: string }
): VerifyCompletionFunction => {
  return (context: VerifyCompletionContext): VerifyCompletionResult => {
    const result = verifyFn(context.result.text, context.iteration);
    
    if (typeof result === 'boolean') {
      return {
        complete: result,
        reason: result ? '自定义验证通过' : '自定义验证未通过',
      };
    }
    
    return result;
  };
};

/**
 * 默认验证器
 * 使用内置的关键词检测（与原实现兼容）
 */
export const defaultVerifier: VerifyCompletionFunction = (context) => {
  const text = context.result.text.toLowerCase();
  
  const completionKeywords = [
    '任务完成', '评估完成', '扫描完成', '已完成', '完成了', '全部完成',
    'task complete', 'completed', 'done', 'finished', 'all tasks', 'successfully completed',
  ];
  
  for (const keyword of completionKeywords) {
    if (text.includes(keyword.toLowerCase())) {
      return {
        complete: true,
        reason: `检测到完成关键词: "${keyword}"`,
      };
    }
  }
  
  return {
    complete: false,
    reason: '请继续完成任务',
  };
};
