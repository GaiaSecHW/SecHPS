'use client';

import { useState } from 'react';
import { Play, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface TaskDebugPanelProps {
  onTaskCreated: (taskId: string) => void;
}

export function TaskDebugPanel({ onTaskCreated }: TaskDebugPanelProps) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [form, setForm] = useState({
    instruction: '',
    projectPath: '',
    workspacePath: '',
    model: 'anthropic/claude-sonnet-4',
    apiKey: '',
    timeoutSec: 300,
    skills: '',
    mcps: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.instruction.trim()) {
      toast.error('请输入执行指令');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        instruction: form.instruction,
        projectPath: form.projectPath || undefined,
        workspacePath: form.workspacePath || undefined,
        model: form.model || undefined,
        apiKey: form.apiKey || undefined,
        timeoutSec: form.timeoutSec || undefined,
        skills: form.skills ? form.skills.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        mcps: form.mcps ? JSON.parse(form.mcps) : undefined,
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
    <div className="bg-white rounded-lg shadow border border-gray-200">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Play className="w-5 h-5 text-blue-600" />
          </div>
          <div className="text-left">
            <h2 className="text-lg font-semibold text-gray-900">手动任务调试</h2>
            <p className="text-sm text-gray-500">创建任务并分发给 Worker 执行</p>
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
        <form onSubmit={handleSubmit} className="p-6 border-t border-gray-200 space-y-4">
          {/* Instruction */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              执行指令 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.instruction}
              onChange={(e) => setForm({ ...form, instruction: e.target.value })}
              placeholder="输入要执行的指令，例如：分析这个代码库的安全漏洞..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Basic Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                项目路径
              </label>
              <input
                type="text"
                value={form.projectPath}
                onChange={(e) => setForm({ ...form, projectPath: e.target.value })}
                placeholder="/path/to/project"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                工作区路径 (NFS)
              </label>
              <input
                type="text"
                value={form.workspacePath}
                onChange={(e) => setForm({ ...form, workspacePath: e.target.value })}
                placeholder="/shared/workspace/task-123"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                模型
              </label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="anthropic/claude-sonnet-4"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-ant-..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                超时 (秒)
              </label>
              <input
                type="number"
                value={form.timeoutSec}
                onChange={(e) => setForm({ ...form, timeoutSec: parseInt(e.target.value) || 300 })}
                min={60}
                max={3600}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Advanced Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                技能 (逗号分隔)
              </label>
              <input
                type="text"
                value={form.skills}
                onChange={(e) => setForm({ ...form, skills: e.target.value })}
                placeholder="security-audit, code-analysis"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                MCP 配置 (JSON)
              </label>
              <input
                type="text"
                value={form.mcps}
                onChange={(e) => setForm({ ...form, mcps: e.target.value })}
                placeholder='[{"type":"local","command":["npx","-y","@modelcontextprotocol/server-filesystem"]}]'
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading || !form.instruction.trim()}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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