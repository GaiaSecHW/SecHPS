'use client';

import { useState, useEffect } from 'react';
import { Play, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface TaskDebugPanelProps {
  onTaskCreated: (taskId: string) => void;
}

interface ModelOption {
  key: string;
  modelId: string;
  modelName: string;
  label: string;
  hasApiKey: boolean;
  apiKey?: string;
}

export function TaskDebugPanel({ onTaskCreated }: TaskDebugPanelProps) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [executorMode, setExecutorMode] = useState<'instruction' | 'command'>('instruction');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [workerOptions, setWorkerOptions] = useState<{ nodeId: string; address: string; status: string }[]>([]);
  const [form, setForm] = useState({
    instruction: '',
    agent: 'opencode' as 'opencode' | 'claude',
    gitUrl: '',
    gitRef: '',
    projectPath: '',
    workspacePath: '',
    apiKey: '',
    timeoutSec: 300,
    skills: '',
    mcps: '',
    startCommand: '',
    preferredWorkerNodeId: '',
  });

  useEffect(() => {
    fetchModels();
    fetchWorkers();
  }, []);

  const fetchWorkers = async () => {
    try {
      const response = await fetch('/api/codeswarm/nodes');
      if (response.ok) {
        const data = await response.json();
        setWorkerOptions(data.workers || []);
      }
    } catch {
      // ignore error, keep empty options
    }
  };

  const fetchModels = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/models?isActive=true&forEvaluation=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const options: ModelOption[] = [];
        for (const cfg of data.models || []) {
          for (const modelName of cfg.models || []) {
            const suffix = cfg.isDefault ? ' [默认]' : '';
            options.push({
              key: `${cfg.id}::${modelName}`,
              modelId: cfg.id,
              modelName,
              label: `${cfg.name} - ${modelName}${suffix}`,
              hasApiKey: cfg.hasApiKey,
              apiKey: cfg.apiKey,
            });
          }
        }
        setModelOptions(options);
        if (options.length > 0) {
          setSelectedModelKey(options[0].key);
          if (options[0].hasApiKey && options[0].apiKey) {
            setForm(prev => ({ ...prev, apiKey: options[0].apiKey || '' }));
          }
        }
      }
    } catch {
      // ignore error, keep empty options
    }
  };

  const handleModelChange = (key: string) => {
    setSelectedModelKey(key);
    const option = modelOptions.find(o => o.key === key);
    if (option?.hasApiKey && option.apiKey) {
      setForm(prev => ({ ...prev, apiKey: option.apiKey || '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (executorMode === 'instruction' && !form.instruction.trim()) {
      toast.error('请输入执行指令');
      return;
    }
    if (executorMode === 'command' && !form.startCommand.trim()) {
      toast.error('请输入执行命令');
      return;
    }

    setLoading(true);
    try {
      const selectedModel = modelOptions.find(o => o.key === selectedModelKey);
      const payload = {
        instruction: executorMode === 'instruction' ? form.instruction : form.startCommand,
        agent: executorMode === 'command' ? 'opencode' : form.agent,
        gitUrl: form.gitUrl || undefined,
        gitRef: form.gitRef || undefined,
        projectPath: form.projectPath || undefined,
        workspacePath: form.workspacePath || undefined,
        model: selectedModel?.modelName || undefined,
        modelId: selectedModel?.modelId || undefined,
        apiKey: form.apiKey || undefined,
        timeoutSec: form.timeoutSec || undefined,
        skills: form.skills ? form.skills.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        mcps: form.mcps ? JSON.parse(form.mcps) : undefined,
        startCommand: executorMode === 'command' ? form.startCommand : undefined,
        preferredWorkerNodeId: form.preferredWorkerNodeId || undefined,
      };

      const resp = await fetch('/api/codeswarm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();

      if (resp.ok) {
        if (data.dispatched) {
          toast.success(`任务已分发到 Worker: ${data.workerAddress}`);
        } else {
          toast('当前无可用 Worker，任务已加入队列', { icon: 'ℹ️' });
        }
        onTaskCreated(data.taskId);

        // Reset form
        setForm(prev => ({
          ...prev,
          instruction: '',
          gitUrl: '',
          gitRef: '',
          projectPath: '',
          workspacePath: '',
        }));
      } else {
        toast.error(data.error || '创建任务失败');
      }
    } catch (err) {
      toast.error('创建任务失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-dark-surface-hover transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Play className="w-5 h-5 text-blue-400" />
          </div>
          <div className="text-left">
            <h2 className="text-lg font-semibold text-gray-100">手动任务调试</h2>
            <p className="text-sm text-gray-400">创建任务并分发给 Worker 执行</p>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-400" />
        )}
      </button>

      {/* Form */}
      {expanded && (
        <form onSubmit={handleSubmit} className="p-6 border-t border-gray-700/50 space-y-4">
          {/* Executor Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              执行方式
            </label>
            <div className="flex gap-3">
              <label className={`flex items-center space-x-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${executorMode === 'instruction' ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-gray-600 text-gray-400 hover:bg-dark-surface-hover hover:text-gray-300'}`}>
                <input
                  type="radio"
                  name="executorMode"
                  value="instruction"
                  checked={executorMode === 'instruction'}
                  onChange={() => setExecutorMode('instruction')}
                  className="sr-only"
                />
                <span className="font-medium">执行指令</span>
                <span className="text-xs opacity-70">自然语言描述</span>
              </label>
              <label className={`flex items-center space-x-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${executorMode === 'command' ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-gray-600 text-gray-400 hover:bg-dark-surface-hover hover:text-gray-300'}`}>
                <input
                  type="radio"
                  name="executorMode"
                  value="command"
                  checked={executorMode === 'command'}
                  onChange={() => setExecutorMode('command')}
                  className="sr-only"
                />
                <span className="font-medium">执行命令</span>
                <span className="text-xs opacity-70">opencode run --command</span>
              </label>
            </div>
          </div>

          {/* Instruction or Command */}
          {executorMode === 'instruction' ? (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                执行指令 <span className="text-red-400">*</span>
              </label>
              <textarea
                value={form.instruction}
                onChange={(e) => setForm({ ...form, instruction: e.target.value })}
                placeholder={"分析这个代码库的安全漏洞，重点关注：\n1. SQL注入和XSS等OWASP Top 10漏洞\n2. 敏感信息泄露\n3. 认证和授权问题\n请给出详细的漏洞报告和修复建议。"}
                rows={5}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                执行命令 (startCommand) <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.startCommand}
                onChange={(e) => setForm({ ...form, startCommand: e.target.value })}
                placeholder="opencode run --command nazhua-audit"
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
            </div>
          )}

          {/* Git URL */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Git 仓库地址
              </label>
              <input
                type="text"
                value={form.gitUrl}
                onChange={(e) => setForm({ ...form, gitUrl: e.target.value })}
                placeholder="https://github.com/username/repo.git"
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Git 分支/Tag
              </label>
              <input
                type="text"
                value={form.gitRef}
                onChange={(e) => setForm({ ...form, gitRef: e.target.value })}
                placeholder="main, v1.0, commit hash"
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
            </div>
          </div>

          {/* Basic Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                项目路径
              </label>
              <input
                type="text"
                value={form.projectPath}
                onChange={(e) => setForm({ ...form, projectPath: e.target.value })}
                placeholder="/path/to/project"
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                工作区路径 (NFS)
              </label>
              <input
                type="text"
                value={form.workspacePath}
                onChange={(e) => setForm({ ...form, workspacePath: e.target.value })}
                placeholder="/shared/workspace/task-123"
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
            </div>
          </div>

          {/* Worker Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              指定 Worker (空则自动分配)
            </label>
            <select
              value={form.preferredWorkerNodeId}
              onChange={(e) => setForm({ ...form, preferredWorkerNodeId: e.target.value })}
              className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200"
            >
              <option value="">自动分配</option>
              {workerOptions.map((w) => (
                <option key={w.nodeId} value={w.nodeId}>
                  {w.nodeId} ({w.address}) - {w.status}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                模型
              </label>
              <select
                value={selectedModelKey}
                onChange={(e) => handleModelChange(e.target.value)}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200"
              >
                <option value="">请选择模型</option>
                {modelOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                API Key
              </label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-ant-... (可选，覆盖模型的默认Key)"
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                超时 (秒)
              </label>
              <input
                type="number"
                value={form.timeoutSec}
                onChange={(e) => setForm({ ...form, timeoutSec: parseInt(e.target.value) || 300 })}
                min={60}
                max={3600}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200"
              />
            </div>
          </div>

          {/* Advanced Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                技能 (逗号分隔)
              </label>
              <input
                type="text"
                value={form.skills}
                onChange={(e) => setForm({ ...form, skills: e.target.value })}
                placeholder="security-audit, code-analysis"
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                MCP 配置 (JSON)
              </label>
              <input
                type="text"
                value={form.mcps}
                onChange={(e) => setForm({ ...form, mcps: e.target.value })}
                placeholder='[{"type":"local","command":["npx","-y","@modelcontextprotocol/server-filesystem"]}]'
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500 font-mono text-sm"
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading || (executorMode === 'instruction' ? !form.instruction.trim() : !form.startCommand.trim())}
              className="flex items-center space-x-2 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>分发中...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>创建并分发任务</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}