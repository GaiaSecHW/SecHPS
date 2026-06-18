import type { TaskDebugForm } from './types.js';

interface ToolDispatchFieldsProps {
  form: TaskDebugForm;
  updateForm: (patch: Partial<TaskDebugForm>) => void;
}

const inputClassName =
  'w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500';

export function ToolDispatchFields({ form, updateForm }: ToolDispatchFieldsProps) {
  const isToolMode = form.toolId.trim().length > 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <label className="block text-sm font-medium text-gray-300">Tool ID</label>
          {isToolMode && (
            <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">Tool 模式已启用</span>
          )}
        </div>
        <input
          type="text"
          value={form.toolId}
          onChange={(event) => updateForm({ toolId: event.target.value })}
          placeholder="my-tool-identifier"
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-gray-500">填写后启用 Tool 调度模式；toolTaskId 由后端自动生成。</p>
      </div>

      {isToolMode && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Tool 可执行路径</label>
            <input
              type="text"
              value={form.toolPath}
              onChange={(event) => updateForm({ toolPath: event.target.value })}
              placeholder="/usr/local/bin/my-tool"
              className={inputClassName}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Tool 工作目录 (env.TOOL_WORK_DIR)</label>
            <input
              type="text"
              value={form.toolWorkDir}
              onChange={(event) => updateForm({ toolWorkDir: event.target.value })}
              placeholder="/mnt/tool-workspace (默认 TOOL_WORK_DIR)"
              className={inputClassName}
            />
          </div>
        </>
      )}
    </div>
  );
}
