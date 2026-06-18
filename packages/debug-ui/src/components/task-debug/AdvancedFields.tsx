import type { TaskDebugForm } from './types.js';

interface AdvancedFieldsProps {
  form: TaskDebugForm;
  updateForm: (patch: Partial<TaskDebugForm>) => void;
}

const inputClassName =
  'w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500';

const textareaClassName = `${inputClassName} font-mono text-sm`;

export function AdvancedFields({ form, updateForm }: AdvancedFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">技能 (逗号分隔)</label>
          <input
            type="text"
            value={form.skills}
            onChange={(event) => updateForm({ skills: event.target.value })}
            placeholder="security-audit, code-analysis"
            className={inputClassName}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">目标产品</label>
          <input
            type="text"
            value={form.targetProduct}
            onChange={(event) => updateForm({ targetProduct: event.target.value })}
            placeholder="产品名称"
            className={inputClassName}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">MCP 配置 (JSON Array)</label>
        <textarea
          value={form.mcps}
          onChange={(event) => updateForm({ mcps: event.target.value })}
          placeholder='[{"type":"local","command":["npx","my-mcp"]}]'
          rows={3}
          className={textareaClassName}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">环境变量 (JSON Object)</label>
        <textarea
          value={form.env}
          onChange={(event) => updateForm({ env: event.target.value })}
          placeholder='{"NODE_ENV":"production","DEBUG":"true"}'
          rows={3}
          className={textareaClassName}
        />
        <p className="mt-1 text-xs text-gray-500">
          JSON 格式的环境变量对象；INPUT_DIR / TOOL_WORK_DIR / PLATFORM_TASK_ID 为保留键，会与表单字段合并。
        </p>
      </div>
    </div>
  );
}
