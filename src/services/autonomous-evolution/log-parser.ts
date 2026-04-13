/**
 * log-parser.ts
 * 解析 .jsonl 评估日志，提取"问题出现→问题解决"的完整过程序列
 *
 * 核心思路：
 * 以"错误关键词"为锚点，追踪某类错误从首次出现到不再出现的完整轨迹。
 * 中间所有的工具调用（失败和成功）、assistant 思考文本都纳入序列。
 * 只有当同类错误关键词不再出现，且后续工具调用成功，才认为问题已解决。
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';

export interface FailureAttempt {
  toolName: string;
  toolInput: Record<string, unknown>;
  errorMessage: string;
  timestamp: string;
}

export interface SuccessAttempt {
  toolName: string;
  toolInput: Record<string, unknown>;
  result: unknown;
  timestamp: string;
}

export interface FailureSuccessSequence {
  failures: FailureAttempt[];
  success: SuccessAttempt;
  sessionId: string;
  model: string;
  // 完整的中间过程（assistant 思考文本 + 所有工具调用）
  fullContext?: string;
}

interface JSONLEntry {
  type?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  isApiErrorMessage?: boolean;
  timestamp?: string;
  sessionId?: string;
  model?: string;
  message?: {
    role?: string;
    content?: string | Array<{
      type?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string | Array<{ type?: string; text?: string }>;
      is_error?: boolean;
      text?: string;
    }>;
  };
}

async function* readJSONL(filePath: string): AsyncGenerator<JSONLEntry> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as JSONLEntry;
    } catch {
      // skip malformed lines
    }
  }
}

function extractErrorText(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    for (const item of result) {
      if (item?.type === 'text' && typeof item.text === 'string') return item.text;
    }
  }
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.error === 'string') return r.error;
    if (typeof r.message === 'string') return r.message;
  }
  return null;
}

function extractAssistantText(entry: JSONLEntry): string {
  if (entry.message?.role === 'assistant') {
    const content = entry.message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(b => b?.type === 'text' && b.text)
        .map(b => b.text || '')
        .join('\n');
    }
  }
  return '';
}

interface ToolEvent {
  toolName: string;
  toolInput: Record<string, unknown>;
  errorMessage: string | null; // null = success
  result: unknown;
  timestamp: string;
}

/**
 * 从单个 .jsonl 文件提取失败→成功序列
 *
 * 新逻辑：
 * 1. 先把所有 tool_use 和 tool_result 配对，建立完整的工具调用事件列表
 * 2. 扫描事件列表，找到"连续出现同类错误关键词，最终被成功调用打断"的窗口
 * 3. 把窗口内所有失败事件 + 最终成功事件 + 中间 assistant 思考文本打包成序列
 */
export async function extractSequences(filePath: string): Promise<FailureSuccessSequence[]> {
  const entries: JSONLEntry[] = [];
  for await (const entry of readJSONL(filePath)) {
    entries.push(entry);
  }

  const sessionId = entries.find(e => e.sessionId)?.sessionId || '';
  const model = entries.find(e => e.model)?.model || '';

  // Step 1: 建立 tool_use_id -> tool info 映射
  const toolUseMap = new Map<string, { toolName: string; toolInput: Record<string, unknown> }>();
  for (const entry of entries) {
    if (entry.type === 'tool_use' && entry.tool_use_id && entry.tool_name) {
      toolUseMap.set(entry.tool_use_id, {
        toolName: entry.tool_name,
        toolInput: entry.tool_input || {},
      });
    }
    if (entry.message?.role === 'assistant' && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) {
        if (block?.type === 'tool_use' && block.id && block.name) {
          toolUseMap.set(block.id, { toolName: block.name, toolInput: block.input || {} });
        }
      }
    }
  }

  // Step 2: 构建有序事件流（工具调用结果 + assistant 思考）
  interface TimelineEvent {
    kind: 'tool_error' | 'tool_success' | 'assistant_think';
    toolName?: string;
    toolInput?: Record<string, unknown>;
    errorMessage?: string;
    result?: unknown;
    text?: string;
    timestamp: string;
    entryIndex: number;
  }

  const timeline: TimelineEvent[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const ts = entry.timestamp || new Date().toISOString();

    // assistant 思考文本
    const thinkText = extractAssistantText(entry);
    if (thinkText.trim()) {
      timeline.push({ kind: 'assistant_think', text: thinkText, timestamp: ts, entryIndex: i });
    }

    // 处理 tool_result（直接形式）
    if (entry.type === 'tool_result') {
      let toolName = entry.tool_name || '';
      let toolInput: Record<string, unknown> = entry.tool_input || {};
      if (!toolName && entry.tool_use_id) {
        const info = toolUseMap.get(entry.tool_use_id);
        if (info) { toolName = info.toolName; toolInput = info.toolInput; }
      }
      const isErr = entry.is_error === true || entry.isApiErrorMessage === true;
      const errMsg = isErr ? (extractErrorText(entry.tool_result) || '') : null;
      timeline.push({
        kind: isErr ? 'tool_error' : 'tool_success',
        toolName,
        toolInput,
        errorMessage: errMsg ?? undefined,
        result: entry.tool_result,
        timestamp: ts,
        entryIndex: i,
      });
    }

    // 处理 message.content 中的 tool_result blocks
    if (entry.message?.role === 'user' && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) {
        if (block?.type !== 'tool_result') continue;
        let toolName = '';
        let toolInput: Record<string, unknown> = {};
        if (block.tool_use_id) {
          const info = toolUseMap.get(block.tool_use_id);
          if (info) { toolName = info.toolName; toolInput = info.toolInput; }
        }
        const isErr = block.is_error === true;
        let errMsg: string | null = null;
        let result: unknown = block.content;
        if (isErr) {
          const content = block.content;
          if (typeof content === 'string') errMsg = content;
          else if (Array.isArray(content)) {
            for (const c of content) {
              if (c?.type === 'text' && typeof c.text === 'string') { errMsg = c.text; break; }
            }
          }
        }
        timeline.push({
          kind: isErr ? 'tool_error' : 'tool_success',
          toolName,
          toolInput,
          errorMessage: errMsg ?? undefined,
          result,
          timestamp: ts,
          entryIndex: i,
        });
      }
    }
  }

  // Step 3: 扫描 timeline，找"失败窗口→成功"序列
  // 策略：遇到第一个 tool_error 开始记录，直到遇到 tool_success 为止（不管中间有多少 assistant_think）
  // 同一个错误关键词簇视为同一个问题
  const sequences: FailureSuccessSequence[] = [];
  let pendingFailures: FailureAttempt[] = [];
  let pendingContext: string[] = [];
  let firstErrorKeywords: Set<string> = new Set();

  // 提取错误关键词（去路径后取前5个词）
  function errorKeywords(msg: string): string[] {
    const cleaned = msg.replace(/([A-Za-z]:)?[\\/][^\s:,'"]+/g, '').toLowerCase();
    return cleaned.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
  }

  function keywordOverlap(a: Set<string>, b: string[]): boolean {
    return b.some(k => a.has(k));
  }

  for (const event of timeline) {
    if (event.kind === 'tool_error') {
      const kws = errorKeywords(event.errorMessage || '');
      if (pendingFailures.length === 0) {
        // 开始新的失败窗口
        firstErrorKeywords = new Set(kws);
      } else if (!keywordOverlap(firstErrorKeywords, kws)) {
        // 错误类型完全不同，先关闭旧窗口（无成功，丢弃），开新窗口
        pendingFailures = [];
        pendingContext = [];
        firstErrorKeywords = new Set(kws);
      }
      pendingFailures.push({
        toolName: event.toolName || '',
        toolInput: event.toolInput || {},
        errorMessage: event.errorMessage || '',
        timestamp: event.timestamp,
      });
      pendingContext.push(`[失败] ${event.toolName}: ${event.errorMessage}`);

    } else if (event.kind === 'tool_success' && pendingFailures.length > 0) {
      // 成功了，关闭窗口，生成序列
      pendingContext.push(`[成功] ${event.toolName}: ${JSON.stringify(event.toolInput)}`);
      sequences.push({
        failures: [...pendingFailures],
        success: {
          toolName: event.toolName || '',
          toolInput: event.toolInput || {},
          result: event.result,
          timestamp: event.timestamp,
        },
        sessionId,
        model,
        fullContext: pendingContext.join('\n'),
      });
      pendingFailures = [];
      pendingContext = [];
      firstErrorKeywords = new Set();

    } else if (event.kind === 'assistant_think' && pendingFailures.length > 0) {
      // 记录中间思考过程
      if (event.text) pendingContext.push(`[思考] ${event.text.slice(0, 200)}`);
    }
  }

  return sequences;
}
