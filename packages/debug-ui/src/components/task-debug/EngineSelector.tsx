import { Code2, FileTerminal, Workflow } from 'lucide-react';
import type { TaskDebugForm, TaskEngine, ValidationIssue, WorkerOption } from './types.js';

interface EngineSelectorProps {
  form: TaskDebugForm;
  issues: ValidationIssue[];
  workerOptions: WorkerOption[];
  onEngineChange: (engine: TaskEngine) => void;
}

const ENGINES = [
  { id: 'opencode' as const, label: 'OpenCode', description: '模型与 provider 调试', icon: Code2 },
  { id: 'claudecode' as const, label: 'Claude Code', description: 'Claude Code ACP 执行', icon: Workflow },
  { id: 'script' as const, label: 'Script', description: '直接 argv 命令执行', icon: FileTerminal },
];

export function EngineSelector({ form, issues, workerOptions, onEngineChange }: EngineSelectorProps) {
  const selectedWorker = workerOptions.find((worker) => worker.nodeId === form.preferredWorkerNodeId);
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  return (
    <aside className="space-y-4">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-100">执行引擎</h3>
        <div className="space-y-2">
          {ENGINES.map((engine) => {
            const Icon = engine.icon;
            const active = form.engine === engine.id;

            return (
              <button
                key={engine.id}
                type="button"
                onClick={() => onEngineChange(engine.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                    : 'border-gray-700 bg-dark-bg text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{engine.label}</span>
                </div>
                <p className="mt-1 text-xs opacity-75">{engine.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-gray-700 bg-dark-bg p-3 text-xs">
        <h4 className="font-medium text-gray-200">当前摘要</h4>
        <div className="text-gray-400">Worker: {selectedWorker ? selectedWorker.nodeId : '自动分配'}</div>
        <div className="text-gray-400">Timeout: {form.timeoutSec}s</div>
        <div className="text-gray-400">Workspace: {form.workspacePath ? '自定义' : '自动分配'}</div>
        <div className="text-gray-400">Tool: {form.toolId.trim() ? '已启用' : '未启用'}</div>
        <div className="border-t border-gray-700 pt-2 text-gray-400">
          校验: <span className="text-red-400">{errorCount} error</span> /{' '}
          <span className="text-yellow-400">{warningCount} warning</span>
        </div>
      </div>
    </aside>
  );
}
