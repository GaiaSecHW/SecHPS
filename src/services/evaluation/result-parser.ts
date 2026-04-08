// src/services/evaluation/result-parser.ts

import { prisma } from '@/lib/prisma';
import type { ClaudeVulnerabilityReport } from '@/types/vulnerability';

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
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(fullResponse)) !== null) {
      const skillName = match[1].trim();
      if (skillName && !skills.includes(skillName)) {
        skills.push(skillName);
      }
    }
  }

  return skills;
}

/**
 * 从 Claude 输出中提取并解析 JSON 漏洞报告
 */
export async function parseAndSaveResults(
  evaluationId: string,
  projectId: string,
  fullResponse: string
): Promise<void> {
  try {
    // 1. 从输出中提取 JSON 块
    const jsonBlock = extractJsonBlock(fullResponse);
    if (!jsonBlock) {
      console.warn('[ResultParser] 未找到 JSON 报告块');
      return;
    }

    // 2. 解析 JSON
    const report: ClaudeVulnerabilityReport = JSON.parse(jsonBlock);

    // 2.5. 从完整响应中提取使用的 Skills
    const usedSkills = extractUsedSkills(fullResponse);
    console.log(`[ResultParser] 检测到使用的 Skills: ${usedSkills.join(', ') || '无'}`);

    // 3. 验证数据结构
    if (!report.summary || !Array.isArray(report.vulnerabilities)) {
      console.warn('[ResultParser] JSON 报告格式不正确');
      return;
    }

    // 4. 保存评估结果摘要
    await prisma.evaluationResult.create({
      data: {
        evaluationId,
        totalVulns: report.summary.total || report.vulnerabilities.length,
        criticalCount: report.summary.critical || 0,
        highCount: report.summary.high || 0,
        mediumCount: report.summary.medium || 0,
        lowCount: report.summary.low || 0,
        infoCount: report.summary.info || 0,
        // 合并从报告中提取的 skills 和从响应中检测到的 skills
        skillsUsed: JSON.stringify([
          ...(report.summary.skills_used || []),
          ...usedSkills,
        ].filter((v, i, a) => a.indexOf(v) === i)), // 去重
        rawReport: jsonBlock,
      },
    });

    // 5. 保存漏洞详情
    for (const vuln of report.vulnerabilities) {
      await prisma.vulnerability.create({
        data: {
          projectId,
          evaluationId,
          type: vuln.type,
          severity: vuln.severity.toLowerCase(),
          title: vuln.title,
          description: vuln.description || vuln.title,
          cwe: vuln.cwe_id || null,
          filePath: vuln.location || null,
          fixSuggestion: vuln.recommendation || null,
          aiAnalysis: vuln.description || null,
          skill: vuln.skill || null,  // 工具名称（纯文本）
        },
      });
    }

    console.log(`[ResultParser] 保存 ${report.vulnerabilities.length} 个漏洞`);
  } catch (error) {
    console.error('[ResultParser] 解析结果失败:', error);
  }
}

/**
 * 从文本中提取 JSON 代码块
 * 支持格式：
 * - ```json { ... } ```
 * - ``` { ... } ```
 * - 纯 JSON 对象
 */
function extractJsonBlock(text: string): string | null {
  // 尝试匹配 ```json ... ``` 代码块
  const jsonCodeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/;
  const match = text.match(jsonCodeBlockRegex);
  if (match) {
    return match[1].trim();
  }

  // 尝试匹配 { ... } JSON 对象（从最后一个 { 开始，确保匹配到的是报告部分）
  const braceRegex = /\{[\s\S]*\}/;
  const braceMatch = text.match(braceRegex);
  if (braceMatch) {
    return braceMatch[0];
  }

  return null;
}
