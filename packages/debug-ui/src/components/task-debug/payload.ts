import type { SubmitTaskPayload, TaskDebugForm } from './types.js';

export type ParseResult<T> =
  | { value: T | undefined; error?: undefined }
  | { value?: undefined; error: string };

function trimToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === 'string');
}

export function parseJsonObject(value: string): ParseResult<Record<string, string>> {
  if (value.trim().length === 0) {
    return { value: undefined };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: 'env JSON 格式无效' };
  }

  if (!isPlainObject(parsed)) {
    return { error: 'env 必须是 JSON 对象' };
  }

  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item !== 'string') {
      return { error: `env.${key} 必须是字符串` };
    }
  }

  return { value: parsed as Record<string, string> };
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function isValidLocalMcp(value: Record<string, unknown>): boolean {
  if (value.type !== 'local' || !isNonEmptyStringArray(value.command)) {
    return false;
  }

  if ('environment' in value && !isStringRecord(value.environment)) {
    return false;
  }

  if ('enabled' in value && typeof value.enabled !== 'boolean') {
    return false;
  }

  if ('timeout' in value && typeof value.timeout !== 'number') {
    return false;
  }

  return true;
}

function isValidRemoteMcp(value: Record<string, unknown>): boolean {
  if (value.type !== 'remote' || typeof value.url !== 'string' || value.url.trim().length === 0) {
    return false;
  }

  try {
    new URL(value.url);
  } catch {
    return false;
  }

  if ('headers' in value && !isStringRecord(value.headers)) {
    return false;
  }

  if ('enabled' in value && typeof value.enabled !== 'boolean') {
    return false;
  }

  if ('timeout' in value && typeof value.timeout !== 'number') {
    return false;
  }

  return true;
}

function isValidMcpItem(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return isValidLocalMcp(value) || isValidRemoteMcp(value);
}

export function parseMcps(value: string): ParseResult<unknown[]> {
  if (value.trim().length === 0) {
    return { value: undefined };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: 'mcps JSON 格式无效' };
  }

  if (!Array.isArray(parsed)) {
    return { error: 'mcps 必须是 JSON 数组' };
  }

  for (const [index, item] of parsed.entries()) {
    if (!isValidMcpItem(item)) {
      return { error: `mcps[${index}] 必须是非空字符串或合法 MCP service 对象` };
    }
  }

  return { value: parsed };
}

export function parseCommandJson(value: string): ParseResult<string[]> {
  if (value.trim().length === 0) {
    return { error: 'Script command 不能为空' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: 'Script command JSON 格式无效' };
  }

  if (!isNonEmptyStringArray(parsed)) {
    return { error: 'Script command 必须是非空字符串数组' };
  }

  return { value: parsed };
}

function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function parseSkills(value: string): string[] | undefined {
  const skills = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return skills.length > 0 ? skills : undefined;
}

export function buildSubmitPayload(form: TaskDebugForm): SubmitTaskPayload {
  const projectPath = trimToUndefined(form.projectPath);
  const toolId = trimToUndefined(form.toolId);
  const toolWorkDir = trimToUndefined(form.toolWorkDir);

  const parsedEnv = parseJsonObject(form.env);
  const reservedEnv: Record<string, string> = {};

  if (projectPath !== undefined) {
    reservedEnv.INPUT_DIR = projectPath;
  }

  if (toolId !== undefined && toolWorkDir !== undefined) {
    reservedEnv.TOOL_WORK_DIR = toolWorkDir;
  }

  const platformTaskId = trimToUndefined(form.platformTaskId);
  if (platformTaskId !== undefined) {
    reservedEnv.PLATFORM_TASK_ID = platformTaskId;
  }

  const env = {
    ...(parsedEnv.value ?? {}),
    ...reservedEnv,
  };

  const parsedMcps = parseMcps(form.mcps);
  const command = form.engine === 'script' ? parseCommandJson(form.commandJson).value : undefined;
  const isAgentEngine = form.engine === 'opencode' || form.engine === 'claudecode';
  const isToolMode = toolId !== undefined;

  return omitUndefined<SubmitTaskPayload>({
    instruction: form.instruction,
    engine: form.engine,
    workspacePath: trimToUndefined(form.workspacePath),
    projectPath,
    apiKey: isAgentEngine ? trimToUndefined(form.apiKey) : undefined,
    timeoutSec: form.timeoutSec,
    preferredWorkerNodeId: trimToUndefined(form.preferredWorkerNodeId),
    model: isAgentEngine ? trimToUndefined(form.model) : undefined,
    apiBaseUrl: isAgentEngine ? trimToUndefined(form.apiBaseUrl) : undefined,
    maxTokens: form.engine === 'opencode' && form.maxTokens > 0 ? form.maxTokens : undefined,
    contextWindow: form.engine === 'opencode' && form.contextWindow > 0 ? form.contextWindow : undefined,
    command,
    scriptCwd: form.engine === 'script' ? trimToUndefined(form.scriptCwd) : undefined,
    toolId: isToolMode ? toolId : undefined,
    toolPath: isToolMode ? trimToUndefined(form.toolPath) : undefined,
    toolWorkDir,
    skills: parseSkills(form.skills),
    mcps: parsedMcps.value && parsedMcps.value.length > 0 ? parsedMcps.value : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    targetProduct: trimToUndefined(form.targetProduct),
  });
}
