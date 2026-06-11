import { useState, useEffect, useRef } from 'react';
import { Play, ChevronDown, ChevronRight, Loader2, Terminal, Trash2, Settings, Wrench, Sliders } from 'lucide-react';
import toast from 'react-hot-toast';

interface TaskDebugPanelProps {
  onTaskCreated: (taskId: string) => void;
}

interface WorkerOption {
  nodeId: string;
  address: string;
  status: string;
}

interface LogEntry {
  type: string;
  message: string;
  details: string;
  timestamp: string;
  stream?: 'stdout' | 'stderr';
}

// Collapsible section component
function CollapsibleSection({
  title,
  icon,
  defaultExpanded = false,
  children,
  badge,
}: {
  title: string;
  icon: React.ReactNode;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="border border-gray-700/50 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-dark-surface-hover hover:bg-dark-surface transition-colors"
      >
        <div className="flex items-center space-x-2">
          <span className="text-gray-400">{icon}</span>
          <span className="text-sm font-medium text-gray-200">{title}</span>
          {badge}
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {expanded && (
        <div className="p-4 bg-dark-bg space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

export function TaskDebugPanel({ onTaskCreated }: TaskDebugPanelProps) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([]);
  const [form, setForm] = useState({
    // Basic
    instruction: '',
    projectPath: '',
    workspacePath: '',
    apiKey: '',
    timeoutSec: 300,
    preferredWorkerNodeId: '',
    engine: 'opencode' as 'opencode' | 'claudecode',
    // Model Config
    model: '',
    apiBaseUrl: '',
    maxTokens: 0,
    contextWindow: 0,
    // Tool Dispatch
    toolId: '',
    toolPath: '',
    toolWorkDir: '',
    // Advanced
    skills: '',
    mcps: '',
    scripts: '',
    env: '',
    targetProduct: '',
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchWorkers();
  }, []);

  // SSE connection for real-time logs
  useEffect(() => {
    if (!currentTaskId) return;

    const eventSource = new EventSource(`/api/task/${currentTaskId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') return;

        if (data.type === 'task_complete') {
          setLogs(prev => [...prev, {
            type: 'task_complete',
            message: data.state === 'completed' ? '任务完成' : '任务失败',
            details: data.result || data.error || '',
            timestamp: new Date().toISOString(),
          }]);
          setTimeout(() => eventSource.close(), 1000);
          return;
        }

        if (data.data) {
          const eventData = data.data;
          const eventLevel = eventData.level || 'agent';
          let message = '';
          let details = '';
          let streamType: 'stdout' | 'stderr' | undefined = eventData.stream;

          if (data.type === 'log_chunk' || data.type === 'agent_log_chunk') {
            message = eventLevel === 'worker' ? 'Worker' : 'Agent';
            details = eventData.content || '';
          } else if (data.type === 'agent_message_chunk') {
            message = 'Agent';
            details = eventData.content || '';
          } else if (data.type === 'task_started' || data.type === 'task_completed') {
            message = data.type === 'task_started' ? 'Start' : 'Done';
            details = eventData.command || eventData.content || '';
          } else if (data.type === 'tool_call') {
            message = 'Tool';
            details = eventData.tool || '';
            const inputObj = eventData.input;
            if (inputObj && typeof inputObj === 'object' && Object.keys(inputObj).length > 0) {
              details += ` ${cleanLogText(JSON.stringify(inputObj), 80)}`;
            }
          } else if (data.type === 'tool_result' || data.type === 'tool_call_update') {
            message = 'Result';
            details = cleanLogText(eventData.output || '', 150);
          } else if (data.type === 'skill_start') {
            message = 'Skill';
            details = eventData.skill || '';
          } else if (data.type === 'skill_complete') {
            message = 'Skill Done';
            details = eventData.skill || '';
          } else if (data.type === 'phase_start' || data.type === 'phase_complete') {
            message = 'Phase';
            details = eventData.phase || eventData.message || '';
          } else if (data.type === 'command_output') {
            message = 'Shell';
            details = cleanLogText(eventData.content || '', 150);
          } else if (data.type === 'error') {
            message = 'Error';
            details = eventData.message || '';
          } else if (data.type === 'progress') {
            message = 'Progress';
            details = eventData.content || '';
          } else {
            message = data.type;
            details = '';
          }

          if (message) {
            setLogs(prev => [...prev, {
              type: data.type,
              message,
              details,
              timestamp: data.timestamp || new Date().toISOString(),
              stream: streamType,
            }]);
          }
        }
      } catch (err) {
        console.error('[TaskDebugPanel] SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [currentTaskId]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const fetchWorkers = async () => {
    try {
      const response = await fetch('/api/node/list');
      if (response.ok) {
        const data = await response.json();
        setWorkerOptions(data.workers || []);
      }
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.instruction.trim()) {
      toast.error('请输入执行指令');
      return;
    }

    // Validate env JSON if provided
    let envParsed: Record<string, string> | undefined;
    if (form.env.trim()) {
      try {
        const parsed = JSON.parse(form.env.trim());
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          toast.error('env 必须是 JSON 对象格式');
          return;
        }
        envParsed = parsed as Record<string, string>;
      } catch {
        toast.error('env JSON 格式无效');
        return;
      }
    }

    setLoading(true);
    try {
      const payload = {
        instruction: form.instruction,
        engine: form.engine,
        projectPath: form.projectPath || undefined,
        workspacePath: form.workspacePath || undefined,
        apiKey: form.apiKey || undefined,
        timeoutSec: form.timeoutSec || undefined,
        preferredWorkerNodeId: form.preferredWorkerNodeId || undefined,
        // Model Config
        model: form.model || undefined,
        apiBaseUrl: form.apiBaseUrl || undefined,
        maxTokens: form.maxTokens > 0 ? form.maxTokens : undefined,
        contextWindow: form.contextWindow > 0 ? form.contextWindow : undefined,
        // Tool Dispatch
        toolId: form.toolId || undefined,
        toolPath: form.toolId && form.toolPath ? form.toolPath : undefined,
        toolWorkDir: form.toolId && form.toolWorkDir ? form.toolWorkDir : undefined,
        // Advanced
        skills: form.skills ? form.skills.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        mcps: form.mcps ? form.mcps.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        scripts: form.scripts ? form.scripts.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        env: envParsed,
        targetProduct: form.targetProduct || undefined,
      };

      const resp = await fetch('/api/task/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();

      if (resp.ok) {
        toast.success(`任务已创建: ${data.taskId}`);
        const taskId = data.taskId;
        setCurrentTaskId(taskId);
        setLogs([]);
        setShowLogs(true);
        onTaskCreated(taskId);

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

  const clearLogs = () => {
    setLogs([]);
    setShowLogs(false);
    setCurrentTaskId(null);
  };

  const cleanLogText = (text: string, maxLen = 200): string => {
    if (!text) return '';
    let clean = text;
    try { clean = JSON.parse(`"${clean}"`); } catch {}
    clean = clean.replace(/\\n/g, '\n').replace(/\\t/g, '  ').replace(/\\"/g, '"');
    clean = clean.replace(/\n{3,}/g, '\n\n').replace(/  +/g, ' ');
    if (clean.length > maxLen) clean = clean.slice(0, maxLen) + '...';
    return clean.trim();
  };

  // Tool dispatch mode indicator
  const isToolMode = form.toolId.trim().length > 0;

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
          {/* Section 1: 基础配置 (always visible) */}
          <div className="space-y-4">
            {/* Engine Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">执行引擎</label>
              <div className="flex gap-3">
                <label className={`flex items-center space-x-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${form.engine === 'opencode' ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-gray-600 text-gray-400 hover:bg-dark-surface-hover hover:text-gray-300'}`}>
                  <input type="radio" name="engine" value="opencode" checked={form.engine === 'opencode'} onChange={() => setForm({ ...form, engine: 'opencode' })} className="sr-only" />
                  <span className="font-medium">OpenCode</span>
                  <span className="text-xs opacity-70">opencode run</span>
                </label>
                <label className={`flex items-center space-x-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${form.engine === 'claudecode' ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-gray-600 text-gray-400 hover:bg-dark-surface-hover hover:text-gray-300'}`}>
                  <input type="radio" name="engine" value="claudecode" checked={form.engine === 'claudecode'} onChange={() => setForm({ ...form, engine: 'claudecode' })} className="sr-only" />
                  <span className="font-medium">Claude Code</span>
                  <span className="text-xs opacity-70">claude-code-acp</span>
                </label>
              </div>
            </div>

            {/* Instruction */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                执行指令 <span className="text-red-400">*</span>
              </label>
              <textarea
                value={form.instruction}
                onChange={(e) => setForm({ ...form, instruction: e.target.value })}
                placeholder={"分析这个代码库的安全漏洞，重点关注：\n1. SQL注入和XSS等OWASP Top 10漏洞\n2. 敏感信息泄露\n3. 认证和授权问题\n请给出详细的漏洞报告和修复建议。"}
                rows={5}
                className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
            </div>

            {/* Basic Fields Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">项目路径</label>
                <input type="text" value={form.projectPath} onChange={(e) => setForm({ ...form, projectPath: e.target.value })} placeholder="/path/to/project" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">工作区路径 (NFS)</label>
                <input type="text" value={form.workspacePath} onChange={(e) => setForm({ ...form, workspacePath: e.target.value })} placeholder="/shared/workspace/task-123" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
              </div>
            </div>

            {/* Worker Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">指定 Worker (空则自动分配)</label>
              <select value={form.preferredWorkerNodeId} onChange={(e) => setForm({ ...form, preferredWorkerNodeId: e.target.value })} className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200">
                <option value="">自动分配</option>
                {workerOptions.filter(w => w.status === 'online').map((w) => (
                  <option key={w.nodeId} value={w.nodeId}>{w.nodeId} ({w.address})</option>
                ))}
              </select>
            </div>

            {/* API Key & Timeout */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">API Key</label>
                <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-ant-... (可选，覆盖 Worker 端默认)" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">超时 (秒)</label>
                <input type="number" value={form.timeoutSec} onChange={(e) => setForm({ ...form, timeoutSec: parseInt(e.target.value) || 300 })} min={60} max={3600} className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200" />
              </div>
            </div>
          </div>

          {/* Section 2: 模型配置 (collapsible) */}
          <CollapsibleSection
            title="模型配置"
            icon={<Settings className="w-4 h-4" />}
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">AI 模型</label>
                <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="MiniMax-M2.7 / DeepSeek-V3" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">API Base URL</label>
                <input type="text" value={form.apiBaseUrl} onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })} placeholder="https://api.example.com/v1" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Max Tokens</label>
                <input type="number" value={form.maxTokens || ''} onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) || 0 })} min={0} placeholder="0 = 不限制" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Context Window</label>
                <input type="number" value={form.contextWindow || ''} onChange={(e) => setForm({ ...form, contextWindow: parseInt(e.target.value) || 0 })} min={0} placeholder="0 = 不限制" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200" />
              </div>
            </div>
          </CollapsibleSection>

          {/* Section 4: Tool 调度 (collapsible) */}
          <CollapsibleSection
            title="Tool 调度"
            icon={<Wrench className="w-4 h-4" />}
            badge={isToolMode ? (
              <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">Tool 模式已启用</span>
            ) : undefined}
          >
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Tool ID</label>
              <input type="text" value={form.toolId} onChange={(e) => setForm({ ...form, toolId: e.target.value })} placeholder="my-tool-identifier" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
              <p className="text-xs text-gray-500 mt-1">填写后将启用 Tool 调度模式，自动创建 toolTaskId</p>
            </div>
            {isToolMode && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Tool 可执行路径</label>
                  <input type="text" value={form.toolPath} onChange={(e) => setForm({ ...form, toolPath: e.target.value })} placeholder="/usr/local/bin/my-tool" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Tool 工作目录</label>
                  <input type="text" value={form.toolWorkDir} onChange={(e) => setForm({ ...form, toolWorkDir: e.target.value })} placeholder="/mnt/tool-workspace (默认 TOOL_WORK_DIR)" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
                </div>
              </>
            )}
          </CollapsibleSection>

          {/* Section 5: 高级配置 (collapsible) */}
          <CollapsibleSection
            title="高级配置"
            icon={<Sliders className="w-4 h-4" />}
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">技能 (逗号分隔)</label>
                <input type="text" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="security-audit, code-analysis" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">MCP 配置 (逗号分隔)</label>
                <input type="text" value={form.mcps} onChange={(e) => setForm({ ...form, mcps: e.target.value })} placeholder='{"type":"local","command":["npx"]}' className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500 font-mono text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">脚本列表 (逗号分隔)</label>
                <input type="text" value={form.scripts} onChange={(e) => setForm({ ...form, scripts: e.target.value })} placeholder="setup.sh, build.sh, test.sh" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">目标产品</label>
                <input type="text" value={form.targetProduct} onChange={(e) => setForm({ ...form, targetProduct: e.target.value })} placeholder="产品名称" className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">环境变量 (JSON)</label>
              <textarea
                value={form.env}
                onChange={(e) => setForm({ ...form, env: e.target.value })}
                placeholder='{"NODE_ENV": "production", "DEBUG": "true"}'
                rows={3}
                className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-200 placeholder-gray-500 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">JSON 格式的环境变量对象，将传递给 Agent 进程</p>
            </div>
          </CollapsibleSection>

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading || !form.instruction.trim()}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /><span>分发中...</span></>
              ) : (
                <><Play className="w-4 h-4" /><span>创建并分发任务</span></>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Real-time Logs Panel */}
      {showLogs && (
        <div className="border-t border-gray-700/50">
          <div className="px-6 py-3 flex items-center justify-between bg-dark-surface-alt">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-gray-100">实时日志</span>
              {currentTaskId && (
                <span className="text-xs text-gray-500">({currentTaskId})</span>
              )}
            </div>
            <button onClick={clearLogs} className="p-1 text-gray-400 hover:text-red-400 rounded" title="关闭日志">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="h-64 overflow-y-auto bg-dark-bg p-4 font-mono text-xs">
            {logs.length === 0 ? (
              <div className="text-gray-500">等待任务开始...</div>
            ) : (
              logs.map((log, idx) => {
                let textColor = 'text-gray-300';
                let badgeColor = 'bg-gray-700 text-gray-300';
                if (log.type === 'error') { textColor = 'text-red-400'; badgeColor = 'bg-red-900/50 text-red-400'; }
                else if (log.type === 'task_complete') { textColor = 'text-green-400'; badgeColor = 'bg-green-900/50 text-green-400'; }
                else if (log.type === 'skill_start') { textColor = 'text-purple-400'; badgeColor = 'bg-purple-900/50 text-purple-400'; }
                else if (log.type === 'skill_complete') { textColor = 'text-purple-300'; badgeColor = 'bg-purple-900/40 text-purple-300'; }
                else if (log.type === 'tool_call') { textColor = 'text-yellow-400'; badgeColor = 'bg-yellow-900/50 text-yellow-400'; }
                else if (log.type === 'tool_call_update' || log.type === 'tool_result') { textColor = 'text-blue-300'; badgeColor = 'bg-blue-900/50 text-blue-300'; }
                else if (log.type === 'command_output') {
                  textColor = log.stream === 'stderr' ? 'text-yellow-400' : 'text-green-300';
                  badgeColor = log.stream === 'stderr' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-green-900/50 text-green-300';
                }
                else if (log.type === 'phase_start' || log.type === 'phase_complete') { textColor = 'text-cyan-400'; badgeColor = 'bg-cyan-900/50 text-cyan-400'; }
                const cleanDetails = cleanLogText(log.details, 200);
                return (
                  <div key={idx} className={`mb-1 ${textColor}`}>
                    <span className="text-gray-600">{new Date(log.timestamp).toLocaleTimeString()}</span>{' '}
                    <span className={`px-1 rounded text-[10px] ${badgeColor}`}>{log.message}</span>
                    {cleanDetails && <span className="text-gray-400 ml-2">{cleanDetails}</span>}
                  </div>
                );
              })
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}