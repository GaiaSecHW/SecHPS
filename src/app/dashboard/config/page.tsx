'use client';

import { useEffect, useState } from 'react';
import {
  Save,
  Server,
  Check,
  AlertCircle,
  Loader2,
  FolderOpen,
  Download,
  Upload,
  Cog,
  Clock,
  Database,
  Tag,
  MessageSquare,
  LayoutTemplate,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';

interface Config {
  id: string;
  name: string;
  projectUploadDir: string | null;
  workflowConfig: string | null;
  isActive: boolean;
  maxConcurrentEvaluations?: number;
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
  const [startNodeLabel, setStartNodeLabel] = useState('');
  const [startNodeDescription, setStartNodeDescription] = useState('');
  const [endNodeLabel, setEndNodeLabel] = useState('');
  const [endNodeDescription, setEndNodeDescription] = useState('');

  // 系统提示词配置
  const [customSystemPrompt, setCustomSystemPrompt] = useState('');

  // 自定义进展询问消息
  const [customProgressQuestion, setCustomProgressQuestion] = useState('');

  // Skill标准输出模板
  const [skillOutputTemplate, setSkillOutputTemplate] = useState('');

  // CLAUDE.md 全局模板
  const [claudemdTemplate, setClaudemdTemplate] = useState('');

  // 并发限制设置
  const [maxConcurrentEvaluations, setMaxConcurrentEvaluations] = useState(3);

  // 文件校验模型
  const [fileValidationModel, setFileValidationModel] = useState('');
  const [modelOptions, setModelOptions] = useState<{ key: string; label: string }[]>([]);

  // 系统信息
  const [systemInfo, setSystemInfo] = useState<{
    version: string;
    startTimeFormatted: string | null;
    database: string;
    uptimeFormatted: string;
  } | null>(null);
  const [systemInfoLoading, setSystemInfoLoading] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    fetchConfig();
    fetchSystemInfo();
  }, []);

  const fetchSystemInfo = async () => {
    try {
      setSystemInfoLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/system/info', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSystemInfo(data);
      }
    } catch {
      // 忽略错误，不影响页面显示
    } finally {
      setSystemInfoLoading(false);
    }
  };

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
      
      // 查找激活配置，如果没有激活配置则使用第一个并自动激活
      let activeConfig = data.configs.find((c: any) => c.isActive);
      
      if (!activeConfig && data.configs.length > 0) {
        // 没有激活配置，自动激活第一个
        const firstConfig = data.configs[0];
        console.log('[Config] 没有激活配置，自动激活第一个:', firstConfig.id);
        
        // 调用 API 激活这个配置
        const activateResponse = await fetch(`/api/config/${firstConfig.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ isActive: true }),
        });
        
        if (activateResponse.ok) {
          activeConfig = { ...firstConfig, isActive: true };
          console.log('[Config] 已自动激活配置:', activeConfig.id);
        } else {
          // 激活失败，直接使用第一个配置
          activeConfig = firstConfig;
        }
      }
      
      if (activeConfig) {
        setConfig(activeConfig);
        setProjectUploadDir(activeConfig.projectUploadDir || '');
        setCustomSystemPrompt(activeConfig.customSystemPrompt || '');
        setCustomProgressQuestion(activeConfig.progressQuestion || '');
        setSkillOutputTemplate(activeConfig.skillOutputTemplate || '');
        setClaudemdTemplate(activeConfig.claudemdTemplate || '');
        setMaxConcurrentEvaluations(activeConfig.maxConcurrentEvaluations || 3);
        setFileValidationModel(activeConfig.fileValidationModel || '');
        
        // 解析工作流配置
        if (activeConfig.workflowConfig) {
          try {
            const workflowConfig = JSON.parse(activeConfig.workflowConfig);
            // Use ?? to preserve empty strings
            setStartNodeLabel(workflowConfig.startNodeLabel ?? '');
            setStartNodeDescription(workflowConfig.startNodeDescription ?? '');
            setEndNodeLabel(workflowConfig.endNodeLabel ?? '');
            setEndNodeDescription(workflowConfig.endNodeDescription ?? '');
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

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const token = localStorage.getItem('token');
        const resp = await fetch('/api/models?isActive=true&forEvaluation=true', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          const options: { key: string; label: string }[] = [];
          for (const cfg of data.models || []) {
            for (const modelName of cfg.models || []) {
              options.push({
                key: `${cfg.id}::${modelName}`,
                label: `${cfg.name} - ${modelName}`,
              });
            }
          }
          setModelOptions(options);
        }
      } catch { /* ignore */ }
    };
    fetchModels();
  }, []);

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
        ?.match(/filename="(.+)"/)?.[1] ?? `SecHPS-config-${new Date().toISOString().slice(0, 10)}.json`;
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
          maxConcurrentEvaluations,
          fileValidationModel,
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
          <h2 className="text-xl font-semibold text-gray-100 mb-2">
            访问被拒绝
          </h2>
          <p className="text-gray-400">
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
          <h2 className="text-xl font-semibold text-gray-100 mb-2">
            未找到配置
          </h2>
          <p className="text-gray-400">
            请联系管理员创建默认配置。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <Cog size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">配置管理</h1>
            <p className="text-sm text-gray-400 mt-0.5">管理 OpenCode 系统配置</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 导出按钮 */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 border border-gray-600 text-gray-300 rounded-md hover:bg-dark-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="导出当前配置为 JSON 文件"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            导出配置
          </button>
          {/* 导入按钮 */}
          <label
            className={`flex items-center gap-2 px-4 py-2 border border-gray-600 text-gray-300 rounded-md hover:bg-dark-surface-hover transition-colors cursor-pointer ${importing ? 'opacity-50 pointer-events-none' : ''}`}
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
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
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
        <div className="bg-green-900/20 border border-green-800/40 text-green-300 px-4 py-3 rounded-md flex items-center gap-2">
          <Check className="h-5 w-5" />
          {success}
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded-md flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Configuration Form */}
      <div className="space-y-6">

        {/* ===== 系统设置 ===== */}
        <div>
          <h2 className="text-base font-semibold text-gray-300 mb-3 flex items-center gap-2 uppercase tracking-wider">
            <Server size={16} className="text-primary-400" />
            系统设置
          </h2>
          <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6 space-y-6">
            {/* 并发评估限制 + 文件校验模型 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  并发评估限制
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxConcurrentEvaluations}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      if (value >= 1 && value <= 10) {
                        setMaxConcurrentEvaluations(value);
                      }
                    }}
                    className="w-20 px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 text-center"
                  />
                  <span className="text-sm text-gray-400">个评估</span>
                  <div className="flex gap-1">
                    {[1, 3, 5, 10].map((n) => (
                      <button
                        key={n}
                        onClick={() => setMaxConcurrentEvaluations(n)}
                        className={`px-3 py-1 text-sm rounded-md border ${
                          maxConcurrentEvaluations === n
                            ? 'bg-primary-600 text-white border-blue-600'
                            : 'bg-dark-surface text-gray-400 border-gray-600 hover:bg-dark-surface-hover'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  超出限制的评估请求将加入排队队列，等待当前评估完成后自动启动
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  文件校验模型
                </label>
                <select
                  value={fileValidationModel}
                  onChange={(e) => setFileValidationModel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">不校验</option>
                  {modelOptions.map(opt => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  创建任务时校验上传文件目录结构，选择"不校验"则跳过
                </p>
              </div>
            </div>

            <div className="border-t border-gray-700/30 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 项目上传目录 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1 flex items-center gap-1.5">
                    <FolderOpen size={14} />
                    项目上传目录
                  </label>
                  <input
                    type="text"
                    value={projectUploadDir}
                    onChange={(e) => setProjectUploadDir(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="例如 /data/projects 或 D:\projects"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    项目文件将上传到此目录，每个项目会创建一个独立的子目录
                  </p>
                </div>

                {/* 工作流配置 - 开始节点 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    工作流节点默认名称
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={startNodeLabel}
                      onChange={(e) => setStartNodeLabel(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="开始节点名称"
                    />
                    <input
                      type="text"
                      value={endNodeLabel}
                      onChange={(e) => setEndNodeLabel(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="结束节点名称"
                    />
                  </div>
                  <div className="flex gap-3 mt-2">
                    <textarea
                      value={startNodeDescription}
                      onChange={(e) => setStartNodeDescription(e.target.value)}
                      rows={2}
                      className="flex-1 px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none text-sm"
                      placeholder="开始节点描述"
                    />
                    <textarea
                      value={endNodeDescription}
                      onChange={(e) => setEndNodeDescription(e.target.value)}
                      rows={2}
                      className="flex-1 px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none text-sm"
                      placeholder="结束节点描述"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ===== AI 行为配置 ===== */}
        <div>
          <h2 className="text-base font-semibold text-gray-300 mb-3 flex items-center gap-2 uppercase tracking-wider">
            <MessageSquare size={16} className="text-green-400" />
            AI 行为配置
          </h2>
          <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6 space-y-6">
            {/* 系统提示词 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                自定义系统提示词 <span className="text-red-400">*</span>
              </label>
              <textarea
                value={customSystemPrompt}
                onChange={(e) => setCustomSystemPrompt(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none font-mono text-sm"
                placeholder="在此输入自定义的系统提示词，用于项目评估时发送给 AI 的第一条系统消息..."
              />
              <p className="text-xs text-gray-500 mt-1">
                此提示词将在评估开始时作为系统消息发送，用于指导 AI 的评估行为。评估启动必须有此配置。
              </p>
            </div>

            <div className="border-t border-gray-700/30 pt-4">
              {/* 进展询问消息 */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  进展询问消息
                </label>
                <textarea
                  value={customProgressQuestion}
                  onChange={(e) => setCustomProgressQuestion(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none font-mono text-sm"
                  placeholder="请简要告诉我当前的评估进展如何：&#10;1. 已经完成了哪些检查？&#10;2. 目前发现了什么问题？&#10;3. 接下来计划做什么？"
                />
                <p className="text-xs text-gray-500 mt-1">
                  点击"询问进展"按钮时发送给 AI。留空则该按钮不可用。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ===== 模板管理 ===== */}
        <div>
          <h2 className="text-base font-semibold text-gray-300 mb-3 flex items-center gap-2 uppercase tracking-wider">
            <LayoutTemplate size={16} className="text-purple-400" />
            模板管理
          </h2>
          <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6 space-y-6">
            {/* Skill 输出模板 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Skill 标准输出模板
              </label>
              <textarea
                value={skillOutputTemplate}
                onChange={(e) => setSkillOutputTemplate(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none font-mono text-sm"
                placeholder={'# 安全审计报告\n\n## 漏洞列表\n\n### 1. [漏洞标题] [严重性]\n\n**位置**: `文件路径:行号`\n\n**问题描述**: ...\n\n**修复建议**: ...\n\n---\n\n## 摘要统计\n\n- 总计: N 个漏洞\n- 高危: N 个\n- 中危: N 个\n- 低危: N 个'}
              />
              <p className="text-xs text-gray-500 mt-1">
                定义 Skill 的标准化输出格式，创建 Skill 时作为参考模板。支持 Markdown、JSON、纯文本等。
              </p>
            </div>

            <div className="border-t border-gray-700/30 pt-4">
              {/* CLAUDE.md 模板 */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  CLAUDE.md 全局模板
                </label>
                <textarea
                  value={claudemdTemplate}
                  onChange={(e) => setClaudemdTemplate(e.target.value)}
                  rows={10}
                  className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none font-mono text-sm"
                  placeholder={'# 项目说明\n\n## 项目结构\n\n```\nsrc/\n├── controllers/\n├── models/\n├── routes/\n└── utils/\n```\n\n## 编码规范\n\n- 使用 TypeScript\n- 遵循 ESLint 规则\n- 函数必须有注释\n\n## 安全要求\n\n- 所有用户输入必须验证\n- 使用参数化查询防止 SQL 注入\n- 输出必须转义防止 XSS'}
                />
                <p className="text-xs text-gray-500 mt-1">
                  启动评估时写入项目根目录的 <code className="bg-dark-surface-hover px-1 rounded">.claude/CLAUDE.md</code> 文件。已存在则覆盖。
                </p>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* System Status Card */}
      <div className="bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-3 mb-4">
          <Server size={18} className="text-primary-400" />
          <h3 className="text-lg font-medium text-gray-100">系统状态</h3>
        </div>
        
        {systemInfoLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : systemInfo ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 版本号 */}
            <div className="bg-dark-surface-hover rounded-lg px-4 py-3 flex items-center gap-3">
              <Tag size={16} className="text-blue-400" />
              <div>
                <p className="text-xs text-gray-500">版本号</p>
                <p className="text-sm font-medium text-gray-200">v{systemInfo.version}</p>
              </div>
            </div>
            
            {/* 启动时间 */}
            <div className="bg-dark-surface-hover rounded-lg px-4 py-3 flex items-center gap-3">
              <Clock size={16} className="text-green-400" />
              <div>
                <p className="text-xs text-gray-500">启动时间</p>
                <p className="text-sm font-medium text-gray-200">
                  {systemInfo.startTimeFormatted || '未知'}
                </p>
                {systemInfo.uptimeFormatted && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    已运行 {systemInfo.uptimeFormatted}
                  </p>
                )}
              </div>
            </div>
            
            {/* 数据库 */}
            <div className="bg-dark-surface-hover rounded-lg px-4 py-3 flex items-center gap-3">
              <Database size={16} className="text-purple-400" />
              <div>
                <p className="text-xs text-gray-500">数据库</p>
                <p className="text-sm font-medium text-gray-200">{systemInfo.database}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-gray-400">
            无法加载系统信息
          </div>
        )}
      </div>

      {/* Save Button (Bottom) */}
      {hasPermission(PERMISSIONS.CONFIG_UPDATE) && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
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
