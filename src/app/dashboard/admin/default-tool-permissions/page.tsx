'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Shield,
  Plus,
  Edit,
  Trash2,
  Save,
  Check,
  X,
  AlertCircle,
  Loader2,
  Info,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';

// Claude Agent SDK 内置工具列表
const BUILTIN_TOOLS = [
  { name: 'Read', description: '读取文件内容' },
  { name: 'Write', description: '创建/写入新文件' },
  { name: 'Edit', description: '编辑文件（字符串替换）' },
  { name: 'Bash', description: '执行命令行命令' },
  { name: 'Glob', description: '文件模式匹配搜索' },
  { name: 'Grep', description: '文件内容搜索' },
  { name: 'LS', description: '列出目录内容' },
  { name: 'WebSearch', description: '网络搜索' },
  { name: 'WebFetch', description: '获取网页内容' },
  { name: 'Task', description: '启动子 Agent' },
  { name: 'AskUserQuestion', description: '向用户提问' },
  { name: 'TodoWrite', description: '创建/更新任务列表' },
  { name: 'Monitor', description: '监控后台脚本' },
  { name: 'NotebookEdit', description: '编辑 Notebook' },
  { name: 'KillShell', description: '终止后台进程' },
];

const PERMISSION_OPTIONS = [
  { value: 'allow', label: '允许', color: 'bg-green-500/15 text-green-400 border border-green-500/20' },
  { value: 'ask', label: '询问', color: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20' },
  { value: 'deny', label: '拒绝', color: 'bg-red-500/15 text-red-400 border border-red-500/20' },
];

interface ToolPermission {
  toolPattern: string;
  permission: 'allow' | 'deny' | 'ask';
  description?: string;
}

export default function DefaultToolPermissionsPage() {
  return (
    <AdminGuard>
      <DefaultToolPermissionsContent />
    </AdminGuard>
  );
}

function DefaultToolPermissionsContent() {
  const router = useRouter();
  const [configId, setConfigId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ToolPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // 新增/编辑表单
  const [formData, setFormData] = useState({
    toolPattern: '',
    permission: 'ask' as 'allow' | 'deny' | 'ask',
    description: '',
  });

  useEffect(() => {
    fetchPermissions();
  }, []);

  const fetchPermissions = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/config/default-tool-permissions', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取配置失败');
      }

      const data = await response.json();
      setConfigId(data.configId);
      setPermissions(data.permissions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!configId) {
      toast.error('未找到激活的全局配置');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/config/default-tool-permissions', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          configId,
          permissions,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '保存失败');
      }

      toast.success('默认工具权限已保存');
      setShowAddModal(false);
      setEditingIndex(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    if (!formData.toolPattern) {
      toast.error('请输入工具名称或模式');
      return;
    }

    // 检查是否已存在
    if (permissions.some(p => p.toolPattern === formData.toolPattern)) {
      toast.error('该工具已存在配置');
      return;
    }

    setPermissions([...permissions, { ...formData }]);
    setFormData({ toolPattern: '', permission: 'ask', description: '' });
    setShowAddModal(false);
    toast.success('已添加，点击保存按钮生效');
  };

  const handleEdit = (index: number) => {
    const perm = permissions[index];
    setFormData({
      toolPattern: perm.toolPattern,
      permission: perm.permission,
      description: perm.description || '',
    });
    setEditingIndex(index);
  };

  const handleUpdate = () => {
    if (editingIndex === null) return;

    const updated = [...permissions];
    updated[editingIndex] = { ...formData };
    setPermissions(updated);
    setEditingIndex(null);
    setFormData({ toolPattern: '', permission: 'ask', description: '' });
    toast.success('已修改，点击保存按钮生效');
  };

  const handleDelete = (index: number) => {
    if (!confirm('确定要删除这条权限规则吗？')) return;

    const updated = permissions.filter((_, i) => i !== index);
    setPermissions(updated);
    toast.success('已删除，点击保存按钮生效');
  };

  const handleAddBuiltinTool = (toolName: string) => {
    if (permissions.some(p => p.toolPattern === toolName)) {
      toast.error('该工具已存在配置');
      return;
    }

    const tool = BUILTIN_TOOLS.find(t => t.name === toolName);
    setPermissions([...permissions, {
      toolPattern: toolName,
      permission: 'ask',
      description: tool?.description,
    }]);
    toast.success('已添加，点击保存按钮生效');
  };

  // 按权限类型分组统计
  const stats = {
    allow: permissions.filter(p => p.permission === 'allow').length,
    ask: permissions.filter(p => p.permission === 'ask').length,
    deny: permissions.filter(p => p.permission === 'deny').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">默认工具权限配置</h1>
            <p className="text-sm text-gray-400 mt-0.5">配置新建项目时继承的工具权限规则</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
          >
            <Plus size={16} />
            添加规则
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            保存配置
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-400">{stats.allow}</div>
          <div className="text-sm text-green-400/80">允许的工具</div>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-lg p-4">
          <div className="text-2xl font-bold text-yellow-400">{stats.ask}</div>
          <div className="text-sm text-yellow-400/80">需要询问</div>
        </div>
        <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-400">{stats.deny}</div>
          <div className="text-sm text-red-400/80">拒绝的工具</div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded flex items-center gap-2">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {/* Quick Add - Built-in Tools */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">快速添加内置工具</h3>
        <div className="flex flex-wrap gap-2">
          {BUILTIN_TOOLS.map(tool => (
            <button
              key={tool.name}
              onClick={() => handleAddBuiltinTool(tool.name)}
              disabled={permissions.some(p => p.toolPattern === tool.name)}
              className="px-3 py-1 text-sm border border-gray-600 text-gray-300 rounded-md hover:bg-dark-surface-hover disabled:opacity-50 disabled:bg-dark-surface-hover"
            >
              {tool.name}
            </button>
          ))}
        </div>
      </div>

      {/* Permissions List */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50">
        {permissions.length === 0 ? (
          <div className="text-center py-12">
            <Shield className="h-12 w-12 text-gray-500 mx-auto mb-4" />
            <p className="text-gray-400 mb-4">暂无默认工具权限配置</p>
            <p className="text-sm text-gray-500">
              点击"添加规则"按钮或使用上方快速添加内置工具
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {permissions.map((perm, index) => (
              <div key={perm.toolPattern} className="px-6 py-4 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-gray-100">{perm.toolPattern}</span>
                    <span className={`px-2 py-0.5 text-xs rounded ${PERMISSION_OPTIONS.find(o => o.value === perm.permission)?.color}`}>
                      {PERMISSION_OPTIONS.find(o => o.value === perm.permission)?.label}
                    </span>
                  </div>
                  {perm.description && (
                    <p className="text-sm text-gray-500 mt-1">{perm.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEdit(index)}
                    className="p-2 text-gray-400 hover:text-blue-400"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(index)}
                    className="p-2 text-gray-400 hover:text-red-400"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-blue-900/20 border border-blue-500/20 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-400 mt-0.5" />
          <div className="text-sm text-blue-300">
            <p className="font-medium mb-1">说明</p>
            <ul className="list-disc list-inside space-y-1">
              <li>toolPattern 支持精确匹配（如 "Bash"）或模式匹配（如 "Bash(npm:*)"）</li>
              <li>MCP 工具格式：mcp__服务器名__工具名（如 "mcp__security-scanner__*")</li>
              <li>新建项目时会自动继承这些权限规则</li>
              <li>allow：直接执行，无需确认</li>
              <li>ask：每次执行前询问用户</li>
              <li>deny：禁止执行</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editingIndex !== null) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-dark-surface rounded-lg shadow-xl max-w-md w-full mx-4 border border-gray-700/50">
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-100">
                {editingIndex !== null ? '编辑权限规则' : '添加权限规则'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingIndex(null);
                  setFormData({ toolPattern: '', permission: 'ask', description: '' });
                }}
                className="text-gray-400 hover:text-gray-200"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  工具名称/模式 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.toolPattern}
                  onChange={(e) => setFormData({ ...formData, toolPattern: e.target.value })}
                  disabled={editingIndex !== null}
                  className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:ring-2 focus:ring-primary-500 disabled:bg-dark-surface-hover disabled:text-gray-500"
                  placeholder="例如：Bash 或 Bash(npm:*)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  权限类型 <span className="text-red-400">*</span>
                </label>
                <select
                  value={formData.permission}
                  onChange={(e) => setFormData({ ...formData, permission: e.target.value as any })}
                  className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 rounded-md focus:ring-2 focus:ring-primary-500"
                >
                  {PERMISSION_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  描述（可选）
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:ring-2 focus:ring-primary-500"
                  placeholder="描述这条权限规则的用途"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingIndex(null);
                  setFormData({ toolPattern: '', permission: 'ask', description: '' });
                }}
                className="px-4 py-2 text-sm bg-dark-surface border border-gray-600 text-gray-300 rounded-md hover:bg-dark-surface-hover"
              >
                取消
              </button>
              <button
                onClick={editingIndex !== null ? handleUpdate : handleAdd}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
              >
                {editingIndex !== null ? '更新' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
