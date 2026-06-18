import type { TaskDebugForm, WorkerOption } from './types.js';

interface TaskBaseFieldsProps {
  form: TaskDebugForm;
  workerOptions: WorkerOption[];
  updateForm: (patch: Partial<TaskDebugForm>) => void;
}

const inputClassName =
  'w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500';

export function TaskBaseFields({ form, workerOptions, updateForm }: TaskBaseFieldsProps) {
  const onlineWorkers = workerOptions.filter((worker) => worker.status === 'online');

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          执行指令 <span className="text-red-400">*</span>
        </label>
        <textarea
          value={form.instruction}
          onChange={(event) => updateForm({ instruction: event.target.value })}
          placeholder={"分析这个代码库的安全漏洞，重点关注：\n1. SQL注入和XSS等OWASP Top 10漏洞\n2. 敏感信息泄露\n3. 认证和授权问题\n请给出详细的漏洞报告和修复建议。"}
          rows={5}
          className={inputClassName}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">项目路径 (env.INPUT_DIR)</label>
          <input
            type="text"
            value={form.projectPath}
            onChange={(event) => updateForm({ projectPath: event.target.value })}
            placeholder="/path/to/project"
            className={inputClassName}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">工作区路径 (NFS)</label>
          <input
            type="text"
            value={form.workspacePath}
            onChange={(event) => updateForm({ workspacePath: event.target.value })}
            placeholder="/shared/workspace/task-123"
            className={inputClassName}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">平台任务 ID (env.PLATFORM_TASK_ID)</label>
        <input
          type="text"
          value={form.platformTaskId}
          onChange={(event) => updateForm({ platformTaskId: event.target.value })}
          placeholder="外部平台任务 ID"
          className={inputClassName}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">指定 Worker (空则自动分配)</label>
        <select
          value={form.preferredWorkerNodeId}
          onChange={(event) => updateForm({ preferredWorkerNodeId: event.target.value })}
          className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200"
        >
          <option value="">自动分配</option>
          {onlineWorkers.map((worker) => (
            <option key={worker.nodeId} value={worker.nodeId}>
              {worker.nodeId} ({worker.address})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">超时 (秒)</label>
        <input
          type="number"
          value={form.timeoutSec}
          onChange={(event) => updateForm({ timeoutSec: parseInt(event.target.value, 10) || 300 })}
          min={60}
          max={3600}
          className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200"
        />
      </div>
    </div>
  );
}
