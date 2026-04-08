'use client';

import { useEffect, useState } from 'react';
import {
  Settings,
  Save,
  Server,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import SkillCategoriesSection from './SkillCategoriesSection';

interface Config {
  id: string;
  name: string;
  projectUploadDir: string | null;
  workflowConfig: string | null;
  isActive: boolean;
}

export default function ConfigPage() {
  const [user, setUser] = useState<any>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 表单数据
  const [projectUploadDir, setProjectUploadDir] = useState('');
  
  // 工作流配置
  const [startNodeLabel, setStartNodeLabel] = useState('开始');
  const [startNodeDescription, setStartNodeDescription] = useState('工作流的起始点');
  const [endNodeLabel, setEndNodeLabel] = useState('结束');
  const [endNodeDescription, setEndNodeDescription] = useState('工作流的结束点');

  // 系统提示词配置
  const [customSystemPrompt, setCustomSystemPrompt] = useState('');

  // 自定义进展询问消息
  const [customProgressQuestion, setCustomProgressQuestion] = useState('');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/config', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取配置失败');
      }

      const data = await response.json();
      const activeConfig = data.configs.find((c: any) => c.isActive);
      
      if (activeConfig) {
        setConfig(activeConfig);
        setProjectUploadDir(activeConfig.projectUploadDir || '');
        setCustomSystemPrompt(activeConfig.customSystemPrompt || '');
        setCustomProgressQuestion(activeConfig.progressQuestion || '');
        
        // 解析工作流配置
        if (activeConfig.workflowConfig) {
          try {
            const workflowConfig = JSON.parse(activeConfig.workflowConfig);
            setStartNodeLabel(workflowConfig.startNodeLabel || '开始');
            setStartNodeDescription(workflowConfig.startNodeDescription || '工作流的起始点');
            setEndNodeLabel(workflowConfig.endNodeLabel || '结束');
            setEndNodeDescription(workflowConfig.endNodeDescription || '工作流的结束点');
          } catch (e) {
            console.error('Failed to parse workflow config:', e);
          }
        }
      }
    } catch (err) {
      setError('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (permission: string) => {
    return user?.permissions?.includes(permission) || user?.roles?.includes('admin');
  };

  // 从 OpenCode 获取 MCP 服务器配置
  const [mcpServers, setMcpServers] = useState<{ name: string; type: string; enabled: boolean }[]>([]);
  
  const fetchMcpServers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/opencode/config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setMcpServers(data.mcpServers || []);
      }
    } catch (err) {
      console.error('Failed to fetch MCP servers:', err);
    }
  };

  useEffect(() => {
    fetchMcpServers();
  }, []);

  const handleSave = async () => {
    if (!config) {
      setError('未找到配置');
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      
      // 构建工作流配置
      const workflowConfig = JSON.stringify({
        startNodeLabel,
        startNodeDescription,
        endNodeLabel,
        endNodeDescription,
      });
      
      const response = await fetch(`/api/config/${config.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectUploadDir,
          workflowConfig,
          customSystemPrompt,
          progressQuestion: customProgressQuestion,
        }),
      });

      if (!response.ok) {
        throw new Error('保存配置失败');
      }

      setSuccess('配置保存成功');
      fetchConfig();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('保存配置失败');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (!hasPermission(PERMISSIONS.CONFIG_READ)) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            访问被拒绝
          </h2>
          <p className="text-gray-600">
            您没有查看配置的权限。
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            未找到配置
          </h2>
          <p className="text-gray-600">
            请联系管理员创建默认配置。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Settings className="h-6 w-6" />
            配置管理
          </h1>
          <p className="text-gray-600 mt-1">
            管理您的 OpenCode 配置
          </p>
        </div>
        {hasPermission(PERMISSIONS.CONFIG_UPDATE) && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save size={18} />
                保存配置
              </>
            )}
          </button>
        )}
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md flex items-center gap-2">
          <Check className="h-5 w-5" />
          {success}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Configuration Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        {/* Project Upload Directory */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <FolderOpen size={20} />
            项目上传目录
          </h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              目录路径
            </label>
            <input
              type="text"
              value={projectUploadDir}
              onChange={(e) => setProjectUploadDir(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如 /data/projects 或 D:\projects"
            />
            <p className="text-xs text-gray-500 mt-1">
              项目文件将上传到此目录，每个项目会创建一个独立的子目录
            </p>
          </div>
        </div>

        {/* Workflow Config */}
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <Settings size={20} />
            工作流配置
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Start Node Config */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-800">开始节点</h4>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  节点名称
                </label>
                <input
                  type="text"
                  value={startNodeLabel}
                  onChange={(e) => setStartNodeLabel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="开始"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  节点描述
                </label>
                <textarea
                  value={startNodeDescription}
                  onChange={(e) => setStartNodeDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="工作流的起始点"
                />
              </div>
            </div>
            
            {/* End Node Config */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-800">结束节点</h4>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  节点名称
                </label>
                <input
                  type="text"
                  value={endNodeLabel}
                  onChange={(e) => setEndNodeLabel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="结束"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  节点描述
                </label>
                <textarea
                  value={endNodeDescription}
                  onChange={(e) => setEndNodeDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="工作流的结束点"
                />
              </div>
            </div>
          </div>
          
          <p className="text-xs text-gray-500">
            这些配置将作为工作流中开始和结束节点的默认名称和描述
          </p>
        </div>

        {/* System Prompt Config */}
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <Settings size={20} />
            系统提示词
          </h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              自定义系统提示词
            </label>
            <textarea
              value={customSystemPrompt}
              onChange={(e) => setCustomSystemPrompt(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm"
              placeholder="在此输入自定义的系统提示词，用于项目评估时发送给 AI 的第一条系统消息..."
            />
            <p className="text-xs text-gray-500 mt-1">
              此提示词将在评估开始时作为系统消息发送，用于指导 AI 的评估行为
            </p>
          </div>
        </div>

        {/* Progress Question Config */}
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <Settings size={20} />
            进展询问消息
          </h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              自定义进展询问消息
            </label>
            <textarea
              value={customProgressQuestion}
              onChange={(e) => setCustomProgressQuestion(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm"
              placeholder="请简要告诉我当前的评估进展如何：&#10;1. 已经完成了哪些检查？&#10;2. 目前发现了什么问题？&#10;3. 接下来计划做什么？&#10;&#10;请简洁回答，让我了解大致进度即可。"
            />
            <p className="text-xs text-gray-500 mt-1">
              此消息将在点击"询问进展"按钮时发送给 AI，用于了解当前评估进度。留空则"询问进展"按钮将不可用。
            </p>
          </div>
        </div>

        {/* Skill Categories Management */}
        {hasPermission(PERMISSIONS.CONFIG_UPDATE) && (
          <SkillCategoriesSection />
        )}

        {/* MCP Servers */}
        {mcpServers.length > 0 && (
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <Server size={20} />
              MCP 服务器
            </h3>
            <p className="text-sm text-gray-500">
              以下 MCP 服务器由 OpenCode 服务端配置，在此仅展示不可编辑
            </p>
            <div className="bg-gray-50 rounded-md p-3 space-y-2">
              {mcpServers.map((server, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between text-sm py-1"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        server.enabled ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                    <span className="text-gray-700">{server.name}</span>
                  </div>
                  <span className="text-gray-500 text-xs">{server.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save Button (Bottom) */}
      {hasPermission(PERMISSIONS.CONFIG_UPDATE) && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save size={18} />
                保存配置
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
