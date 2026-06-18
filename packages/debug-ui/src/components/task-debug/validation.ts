import { parseCommandJson, parseJsonObject, parseMcps } from './payload.js';
import type { SubmitTaskPayload, TaskDebugForm, ValidationIssue } from './types.js';

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

export function validateSubmitPayload(
  form: TaskDebugForm,
  _payload: SubmitTaskPayload,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (form.instruction.trim().length === 0) {
    issues.push({
      id: 'instruction-required',
      severity: 'error',
      message: '执行指令不能为空',
    });
  }

  if (form.timeoutSec < 60 || form.timeoutSec > 3600) {
    issues.push({
      id: 'timeout-range',
      severity: 'error',
      message: '超时必须在 60 到 3600 秒之间',
    });
  }

  const envResult = parseJsonObject(form.env);
  if (envResult.error !== undefined) {
    issues.push({
      id: 'env-json',
      severity: 'error',
      message: envResult.error,
    });
  }

  const mcpsResult = parseMcps(form.mcps);
  if (mcpsResult.error !== undefined) {
    issues.push({
      id: 'mcps-json',
      severity: 'error',
      message: mcpsResult.error,
    });
  }

  if (form.engine === 'script') {
    const commandResult = parseCommandJson(form.commandJson);
    if (commandResult.error !== undefined) {
      issues.push({
        id: 'script-command',
        severity: 'error',
        message: commandResult.error,
      });
    }

    if (form.scriptCwd.trim().length === 0) {
      issues.push({
        id: 'script-cwd',
        severity: 'warning',
        message: '未填写 scriptCwd，将由 Worker 使用默认工作目录',
      });
    }
  }

  if (form.engine === 'opencode' && form.model.trim().length === 0) {
    issues.push({
      id: 'opencode-model',
      severity: 'warning',
      message: 'OpenCode 未填写模型，将使用 Worker 默认配置',
    });
  }

  if (form.toolId.trim().length > 0 && form.toolPath.trim().length === 0) {
    issues.push({
      id: 'tool-path',
      severity: 'warning',
      message: 'Tool 模式未填写 toolPath，确认 Worker 是否可自行解析',
    });
  }

  return issues;
}
