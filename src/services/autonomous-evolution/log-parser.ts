/**
 * log-parser.ts
 * 解析 .jsonl 评估日志，提取"失败→成功"尝试序列
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
      tool_use_id?: string;
      content?: string | Array<{ type?: string; text?: string }>;
      is_error?: boolean;
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

function isErrorEntry(entry: JSONLEntry): boolean {
  // Direct tool_result with is_error flag
  if (entry.type === 'tool_result' && entry.is_error === true) return true;

  // Message with tool_result content blocks that have is_error
  if (entry.message?.role === 'user' && Array.isArray(entry.message.content)) {
    for (const block of entry.message.content) {
      if (block?.type === 'tool_result' && block.is_error === true) return true;
    }
  }

  // isApiErrorMessage flag
  if (entry.isApiErrorMessage === true) return true;

  return false;
}

function isSuccessToolResult(entry: JSONLEntry): boolean {
  if (entry.type === 'tool_result' && entry.is_error !== true) return true;
  if (entry.message?.role === 'user' && Array.isArray(entry.message.content)) {
    for (const block of entry.message.content) {
      if (block?.type === 'tool_result' && block.is_error !== true) return true;
    }
  }
  return false;
}

/**
 * 从单个 .jsonl 文件提取失败→成功序列
 */
export async function extractSequences(filePath: string): Promise<FailureSuccessSequence[]> {
  const entries: JSONLEntry[] = [];
  for await (const entry of readJSONL(filePath)) {
    entries.push(entry);
  }

  const sequences: FailureSuccessSequence[] = [];

  // Build a map of tool_use_id -> tool_name + tool_input from tool_use entries
  const toolUseMap = new Map<string, { toolName: string; toolInput: Record<string, unknown> }>();
  for (const entry of entries) {
    if (entry.type === 'tool_use' && entry.tool_use_id && entry.tool_name) {
      toolUseMap.set(entry.tool_use_id, {
        toolName: entry.tool_name,
        toolInput: entry.tool_input || {},
      });
    }
    // Also check assistant message content blocks
    if (entry.message?.role === 'assistant' && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content as Array<{
        type?: string; id?: string; name?: string; input?: Record<string, unknown>
      }>) {
        if (block?.type === 'tool_use' && block.id && block.name) {
          toolUseMap.set(block.id, { toolName: block.name, toolInput: block.input || {} });
        }
      }
    }
  }

  // Sliding window: collect consecutive failures followed by a success
  let pendingFailures: FailureAttempt[] = [];
  const sessionId = entries.find(e => e.sessionId)?.sessionId || '';
  const model = entries.find(e => e.model)?.model || '';

  for (const entry of entries) {
    if (isErrorEntry(entry)) {
      // Extract tool info
      let toolName = entry.tool_name || '';
      let toolInput: Record<string, unknown> = entry.tool_input || {};
      let errorMsg = extractErrorText(entry.tool_result) || '';

      // Try to resolve from message content blocks
      if (!toolName && entry.message?.role === 'user' && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block?.type === 'tool_result' && block.is_error === true) {
            const toolInfo = block.tool_use_id ? toolUseMap.get(block.tool_use_id) : undefined;
            if (toolInfo) { toolName = toolInfo.toolName; toolInput = toolInfo.toolInput; }
            const content = block.content;
            if (typeof content === 'string') errorMsg = content;
            else if (Array.isArray(content)) {
              for (const c of content) {
                if (c?.type === 'text' && typeof c.text === 'string') { errorMsg = c.text; break; }
              }
            }
          }
        }
      }

      if (!toolName && entry.tool_use_id) {
        const info = toolUseMap.get(entry.tool_use_id);
        if (info) { toolName = info.toolName; toolInput = info.toolInput; }
      }

      pendingFailures.push({
        toolName,
        toolInput,
        errorMessage: errorMsg,
        timestamp: entry.timestamp || new Date().toISOString(),
      });
    } else if (isSuccessToolResult(entry) && pendingFailures.length > 0) {
      // Found a success after failures — emit sequence
      let toolName = entry.tool_name || '';
      let toolInput: Record<string, unknown> = entry.tool_input || {};
      let result: unknown = entry.tool_result;

      if (!toolName && entry.tool_use_id) {
        const info = toolUseMap.get(entry.tool_use_id);
        if (info) { toolName = info.toolName; toolInput = info.toolInput; }
      }
      if (!toolName && entry.message?.role === 'user' && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block?.type === 'tool_result' && block.is_error !== true) {
            const toolInfo = block.tool_use_id ? toolUseMap.get(block.tool_use_id) : undefined;
            if (toolInfo) { toolName = toolInfo.toolName; toolInput = toolInfo.toolInput; }
            result = block.content;
          }
        }
      }

      sequences.push({
        failures: [...pendingFailures],
        success: {
          toolName,
          toolInput,
          result,
          timestamp: entry.timestamp || new Date().toISOString(),
        },
        sessionId,
        model,
      });
      pendingFailures = [];
    } else {
      // Non-error, non-tool-result entry resets the failure window
      // (only reset on assistant messages to avoid false resets)
      if (entry.message?.role === 'assistant') {
        pendingFailures = [];
      }
    }
  }

  return sequences;
}
