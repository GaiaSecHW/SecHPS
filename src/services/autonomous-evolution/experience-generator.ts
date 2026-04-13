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

  const contextSection = seq.fullContext
    ? `\n## 完整执行过程（含中间思考）\n${seq.fullContext}\n`
    : '';

  return `你是一个 AI Agent 执行经验分析专家。
以下是一段 AI Agent 执行过程中从"遇到问题"到"解决问题"的完整记录，请分析并提炼可复用的经验。

## 失败尝试（汇总）
${failureLines}

## 最终成功操作
${successLine}
${contextSection}
请以 JSON 格式输出，字段如下：
- title: 一句话概括这条经验（中文，20字以内）
- errorCategory: 错误分类，从以下选择：tool_failure / path_error / permission / mcp_timeout / other
- errorPatterns: 触发特征关键词数组（3-5个，来自错误消息的通用关键词，不含具体路径）
- directSolution: 【直接可用的解决方案】——必须写清楚：遇到什么错误时，应该用什么替代方案，包括具体的命令或工具用法。这是注入给 AI Agent 的操作指南，必须足够具体，让 Agent 看到后能直接执行正确操作，不需要再试错。（中文，150字以内）
- lesson: 深层原因——为什么会出现这个错误，根本原因是什么（中文，80字以内）

⚠️ 关键要求：
- directSolution 必须包含具体的替代方案，例如"在 Windows 环境下，mkdir -p 不可用，应改用 md 命令或 mkdir 不带 -p 参数"
- 不要用"检查环境"、"注意兼容性"这类空话，要写出具体怎么做
- errorPatterns 不含具体路径，但 directSolution 可以包含具体命令

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
    // Fallback: build a minimal experience, strip paths from error messages
    const errorMessages = seq.failures.map(f => f.errorMessage);
    const stripPaths = (s: string) =>
      s.replace(/([A-Za-z]:)?[\\/][^\s:,'"]+/g, '<path>').slice(0, 80);
    return {
      title: `${seq.failures[0]?.toolName || '工具'} 失败 → ${seq.success.toolName} 成功`,
      errorCategory: guessCategory(errorMessages),
      errorPatterns: errorMessages.slice(0, 3).map(stripPaths),
      directSolution: `遇到此错误时，改用 ${seq.success.toolName} 工具`,
      lesson: '参见尝试序列',
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

  // 读取全局开关：决定新经验默认是否启用
  const { getInjectionEnabled } = await import('@/services/autonomous-evolution/idle-trigger');
  const defaultEnabled = await getInjectionEnabled();

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
      isInjected: defaultEnabled,
      injectedAt: defaultEnabled ? new Date() : null,
    },
  });
  return { action: 'created', id: created.id };
}
