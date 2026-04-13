/**
 * experience-generator.ts
 * 调用大模型，将失败→成功序列转换为结构化经验
 */

import { prisma } from '@/lib/prisma';
import type { FailureSuccessSequence } from './log-parser';

export interface GeneratedExperience {
  title: string;
  errorCategory: string;
  errorPatterns: string[];
  directSolution: string;
  lesson: string;
}

const ERROR_CATEGORY_MAP: Record<string, string> = {
  'exit code 254': 'tool_failure',
  'fork': 'tool_failure',
  'resource temporarily unavailable': 'tool_failure',
  'file has not been read': 'tool_failure',
  'file does not exist': 'path_error',
  'no files found': 'path_error',
  'enoent': 'path_error',
  'permission denied': 'permission',
  'eacces': 'permission',
  'timed out': 'mcp_timeout',
  'timeout': 'mcp_timeout',
  'stream closed': 'mcp_timeout',
};

function guessCategory(errors: string[]): string {
  const combined = errors.join(' ').toLowerCase();
  for (const [keyword, category] of Object.entries(ERROR_CATEGORY_MAP)) {
    if (combined.includes(keyword)) return category;
  }
  return 'other';
}

async function getModelConfig(): Promise<{
  providerType: string;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
} | null> {
  try {
    const config = await prisma.modelConfig.findFirst({
      where: { isActive: true, isDefault: true },
    });
    if (config) {
      return {
        providerType: config.providerType,
        apiKey: config.apiKey,
        apiBaseUrl: config.apiBaseUrl,
        model: (JSON.parse(config.models)[0] as string) || 'gpt-4o',
      };
    }
  } catch {
    // ignore
  }
  return null;
}

async function callLLM(prompt: string): Promise<string> {
  const cfg = await getModelConfig();
  if (!cfg) throw new Error('未配置默认模型');

  const baseUrl = cfg.apiBaseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content || '';
}

function buildPrompt(seq: FailureSuccessSequence): string {
  const failureLines = seq.failures.map((f, i) =>
    `失败 ${i + 1}:\n  工具: ${f.toolName}\n  输入: ${JSON.stringify(f.toolInput)}\n  错误: ${f.errorMessage}`
  ).join('\n\n');

  const successLine =
    `工具: ${seq.success.toolName}\n  输入: ${JSON.stringify(seq.success.toolInput)}`;

  return `你是一个 AI Agent 执行经验分析专家。
以下是一段 AI Agent 执行过程中的失败→成功尝试序列，请分析并生成结构化经验。

## 失败尝试
${failureLines}

## 最终成功操作
${successLine}

请以 JSON 格式输出，字段如下：
- title: 一句话概括这条经验（中文，20字以内）
- errorCategory: 错误分类，从以下选择：tool_failure / path_error / permission / mcp_timeout / other
- errorPatterns: 触发特征关键词数组（3-5个，用于后续匹配）
- directSolution: 直达方案，下次遇到此错误直接怎么做（中文，50字以内）
- lesson: 教训，为什么这样做有效（中文，100字以内）

只输出 JSON，不要其他内容。`;
}

/**
 * 将一条序列转换为结构化经验
 */
export async function generateExperience(seq: FailureSuccessSequence): Promise<GeneratedExperience> {
  const raw = await callLLM(buildPrompt(seq));

  // Extract JSON from response (may be wrapped in ```json blocks)
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1] : raw;

  try {
    const parsed = JSON.parse(jsonStr.trim()) as GeneratedExperience;
    // Validate required fields
    if (!parsed.title || !parsed.directSolution || !parsed.lesson) {
      throw new Error('缺少必要字段');
    }
    if (!Array.isArray(parsed.errorPatterns)) parsed.errorPatterns = [];
    return parsed;
  } catch {
    // Fallback: build a minimal experience from the raw data
    const errorMessages = seq.failures.map(f => f.errorMessage);
    return {
      title: `${seq.failures[0]?.toolName || '工具'} 失败 → ${seq.success.toolName} 成功`,
      errorCategory: guessCategory(errorMessages),
      errorPatterns: errorMessages.slice(0, 3).map(e => e.slice(0, 80)),
      directSolution: `遇到此错误时，改用 ${seq.success.toolName} 工具`,
      lesson: raw.slice(0, 200) || '参见尝试序列',
    };
  }
}

/**
 * 将经验存入数据库（相同 errorPatterns 则合并，hitCount +1）
 */
export async function saveExperience(
  exp: GeneratedExperience,
  seq: FailureSuccessSequence
): Promise<{ action: 'created' | 'merged'; id: string }> {
  // Try to find an existing experience with overlapping error patterns
  const existing = await prisma.autonomousEvolutionExperience.findFirst({
    where: {
      errorCategory: exp.errorCategory,
      title: exp.title,
    },
  });

  if (existing) {
    // Merge: increment hitCount
    const updated = await prisma.autonomousEvolutionExperience.update({
      where: { id: existing.id },
      data: { hitCount: { increment: 1 }, updatedAt: new Date() },
    });
    return { action: 'merged', id: updated.id };
  }

  const created = await prisma.autonomousEvolutionExperience.create({
    data: {
      title: exp.title,
      errorCategory: exp.errorCategory,
      errorPatterns: JSON.stringify(exp.errorPatterns),
      sourceModel: seq.model || 'unknown',
      sourceSessionId: seq.sessionId || '',
      attemptSequence: JSON.stringify({
        failures: seq.failures,
        success: seq.success,
      }),
      directSolution: exp.directSolution,
      lesson: exp.lesson,
    },
  });
  return { action: 'created', id: created.id };
}
