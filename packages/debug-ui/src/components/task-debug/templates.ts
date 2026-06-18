import type { TaskDebugForm, TaskTemplate } from './types.js';

function keepExisting(existing: string, fallback: string): string {
  return existing.trim().length > 0 ? existing : fallback;
}

export function applyTaskTemplate(form: TaskDebugForm, template: TaskTemplate): TaskDebugForm {
  return template.apply(form);
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'opencode-security-audit',
    label: 'OpenCode 安全审计',
    description: '生成安全审计任务示例',
    engine: 'opencode',
    apply: (form) => ({
      ...form,
      engine: 'opencode',
      instruction: keepExisting(
        form.instruction,
        '分析这个代码库的安全漏洞，重点关注 OWASP Top 10、敏感信息泄露、认证和授权问题，并给出修复建议。',
      ),
      model: keepExisting(form.model, 'MiniMax-M2.7'),
      targetProduct: keepExisting(form.targetProduct, 'codeswarm'),
    }),
  },
  {
    id: 'claudecode-analysis',
    label: 'Claude Code 代码分析',
    description: '生成 Claude Code 代码分析任务示例',
    engine: 'claudecode',
    apply: (form) => ({
      ...form,
      engine: 'claudecode',
      instruction: keepExisting(
        form.instruction,
        '分析当前代码实现，指出主要风险、可维护性问题和推荐改进步骤。',
      ),
      model: keepExisting(form.model, 'claude-sonnet-4-6'),
    }),
  },
  {
    id: 'script-command',
    label: 'Script 命令执行',
    description: '生成 Script 引擎命令执行示例',
    engine: 'script',
    apply: (form) => ({
      ...form,
      engine: 'script',
      instruction: keepExisting(form.instruction, '执行脚本任务'),
      commandJson: keepExisting(form.commandJson, '["bash", "scripts/build.sh"]'),
      scriptCwd: keepExisting(form.scriptCwd, form.workspacePath || form.projectPath),
    }),
  },
];
