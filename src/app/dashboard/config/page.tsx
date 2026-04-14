'use client';

import { useEffect, useState } from 'react';
import {
  Settings,
  Save,
  Server,
  Check,
  AlertCircle,
  Loader2,
  FolderOpen,
  FileText,
  Layers,
  Download,
  Upload,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import TechStackSection from './TechStackSection';

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

  // Skill标准输出模板
  const [skillOutputTemplate, setSkillOutputTemplate] = useState('');

  // CLAUDE.md 全局模板
  const [claudemdTemplate, setClaudemdTemplate] = useState('');

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
        setSkillOutputTemplate(activeConfig.skillOutputTemplate || '');
        setClaudemdTemplate(activeConfig.claudemdTemplate || '');
        
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

  // 导入/导出状态
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    try {
      setExporting(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/config/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '导出失败');
      }
      // 触发浏览器下载
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = response.headers.get('content-disposition')
        ?.match(/filename="(.+)"/)?.[1] ?? `ai4web-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess('配置已导出');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || '导出配置失败');
      setTimeout(() => setError(null), 3000);
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 重置 input 让同一文件可再次选择
    e.target.value = '';
    try {
      setImporting(true);
      const text = await file.text();
      const json = JSON.parse(text);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/config/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(json),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '导入失败');
      setSuccess(data.message || '配置导入成功，页面数据已刷新');
      fetchConfig();
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      setError(err.message || '导入配置失败，请确认文件格式正确');
      setTimeout(() => setError(null), 4000);
    } finally {
      setImporting(false);
    }
  };

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
          skillOutputTemplate,
          claudemdTemplate,
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
        <div className="flex items-center gap-2">
          {/* 导出按钮 */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="导出当前配置为 JSON 文件"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            导出配置
          </button>
          {/* 导入按钮 */}
          <label
            className={`flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors cursor-pointer ${importing ? 'opacity-50 pointer-events-none' : ''}`}
            title="从 JSON 文件导入配置（将覆盖当前配置）"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            导入配置
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImport}
              disabled={importing}
            />
          </label>
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

        {/* Skill Output Template */}
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <FileText size={20} />
            Skill标准输出模板
          </h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              模板内容
            </label>
            <textarea
              value={skillOutputTemplate}
              onChange={(e) => setSkillOutputTemplate(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm"
              placeholder={'# 安全审计报告\n\n## 漏洞列表\n\n### 1. [漏洞标题] [严重性]\n\n**位置**: `文件路径:行号`\n\n**问题描述**: ...\n\n**修复建议**: ...\n\n---\n\n## 摘要统计\n\n- 总计: N 个漏洞\n- 高危: N 个\n- 中危: N 个\n- 低危: N 个'}
            />
            <p className="text-xs text-gray-500 mt-1">
              定义 Skill 的标准化输出格式模板。创建 Skill 时用户只能查看此模板，不能修改。支持任意文本格式（Markdown、JSON、纯文本等）。
            </p>
          </div>
        </div>

        {/* CLAUDE.md Global Template */}
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <FileText size={20} />
            CLAUDE.md 全局模板
          </h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              模板内容
            </label>
            <textarea
              value={claudemdTemplate}
              onChange={(e) => setClaudemdTemplate(e.target.value)}
              rows={12}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm"
              placeholder={'# 项目说明\n\n## 项目结构\n\n```\nsrc/\n├── controllers/\n├── models/\n├── routes/\n└── utils/\n```\n\n## 编码规范\n\n- 使用 TypeScript\n- 遵循 ESLint 规则\n- 函数必须有注释\n\n## 安全要求\n\n- 所有用户输入必须验证\n- 使用参数化查询防止 SQL 注入\n- 输出必须转义防止 XSS'}
            />
            <p className="text-xs text-gray-500 mt-1">
              启动评估时，此模板内容将写入项目根目录的 <code className="bg-gray-100 px-1 rounded">.claude/CLAUDE.md</code> 文件。如果文件已存在将被覆盖。
            </p>
          </div>
        </div>

        {/* Tech Stack Options */}
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <Layers size={20} />
            技术栈管理
          </h3>
          <p className="text-sm text-gray-500">
            管理可用于 Skill 和 Workflow 的技术栈选项
          </p>
          <TechStackSection token={localStorage.getItem('token') || ''} />
        </div>
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
