import type { TaskDebugForm } from './types.js';

interface EngineFieldsProps {
  form: TaskDebugForm;
  updateForm: (patch: Partial<TaskDebugForm>) => void;
}

const inputClassName =
  'w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500';

const textareaClassName = `${inputClassName} font-mono text-sm`;

export function EngineFields({ form, updateForm }: EngineFieldsProps) {
  if (form.engine === 'opencode') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">模型</label>
            <input
              type="text"
              value={form.model}
              onChange={(event) => updateForm({ model: event.target.value })}
              placeholder="MiniMax-M2.7"
              className={inputClassName}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">API Base URL</label>
            <input
              type="text"
              value={form.apiBaseUrl}
              onChange={(event) => updateForm({ apiBaseUrl: event.target.value })}
              placeholder="https://api.example.com/v1"
              className={inputClassName}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">API Key</label>
          <input
            type="password"
            value={form.apiKey}
            onChange={(event) => updateForm({ apiKey: event.target.value })}
            placeholder="sk-..."
            className={inputClassName}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Max Tokens</label>
            <input
              type="number"
              value={form.maxTokens}
              onChange={(event) => updateForm({ maxTokens: parseInt(event.target.value, 10) || 0 })}
              min={0}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Context Window</label>
            <input
              type="number"
              value={form.contextWindow}
              onChange={(event) => updateForm({ contextWindow: parseInt(event.target.value, 10) || 0 })}
              min={0}
              className={inputClassName}
            />
          </div>
        </div>
      </div>
    );
  }

  if (form.engine === 'claudecode') {
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">模型</label>
          <input
            type="text"
            value={form.model}
            onChange={(event) => updateForm({ model: event.target.value })}
            placeholder="claude-opus-4-8"
            className={inputClassName}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">API Key</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(event) => updateForm({ apiKey: event.target.value })}
              placeholder="sk-ant-..."
              className={inputClassName}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">API Base URL</label>
            <input
              type="text"
              value={form.apiBaseUrl}
              onChange={(event) => updateForm({ apiBaseUrl: event.target.value })}
              placeholder="https://api.anthropic.com"
              className={inputClassName}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Command (JSON Array)</label>
        <textarea
          value={form.commandJson}
          onChange={(event) => updateForm({ commandJson: event.target.value })}
          placeholder='["python", "run.py", "--target", "/workspace"]'
          rows={3}
          className={textareaClassName}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Script CWD</label>
        <input
          type="text"
          value={form.scriptCwd}
          onChange={(event) => updateForm({ scriptCwd: event.target.value })}
          placeholder="/workspace"
          className={inputClassName}
        />
      </div>
    </div>
  );
}
