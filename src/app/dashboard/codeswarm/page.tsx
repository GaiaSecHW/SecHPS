'use client';

import { useState, useMemo } from 'react';
import { useApiFetch } from '@/hooks/useApiFetch';
import dynamic from 'next/dynamic';
const WorkerNodesTable = dynamic(() => import('@/components/codeswarm/WorkerNodesTable').then(m => ({ default: m.WorkerNodesTable })), { ssr: false });
const TaskDebugPanel = dynamic(() => import('@/components/codeswarm/TaskDebugPanel').then(m => ({ default: m.TaskDebugPanel })), { ssr: false });
const TaskResultViewer = dynamic(() => import('@/components/codeswarm/TaskResultViewer').then(m => ({ default: m.TaskResultViewer })), { ssr: false });
const LocalTestPanel = dynamic(() => import('@/components/codeswarm/LocalTestPanel').then(m => ({ default: m.LocalTestPanel })), { ssr: false });
const CodedmapDebugPanel = dynamic(() => import('@/components/codeswarm/CodedmapDebugPanel').then(m => ({ default: m.CodedmapDebugPanel })), { ssr: false });
const WorkerLogsPage = dynamic(() => import('@/components/codeswarm/WorkerLogsPage'), { ssr: false });
const SessionExtractPanel = dynamic(() => import('@/components/codeswarm/SessionExtractPanel').then(m => ({ default: m.SessionExtractPanel })), { ssr: false });
const VulnReparsePanel = dynamic(() => import('@/components/codeswarm/VulnReparsePanel').then(m => ({ default: m.VulnReparsePanel })), { ssr: false });
import { AdminGuard } from '@/components/PermissionGuard';
import { Server, Play, List, BookOpen, ChevronDown, ChevronRight, Activity, CheckCircle, XCircle, Loader2, Wifi, Terminal, FlaskConical, Database, FileSearch, RefreshCw } from 'lucide-react';

interface Task {
  id: string;
  taskId: string;
  state: string;
  instruction: string;
  agent: string | null;
  workerId: string | null;
  createdAt: string;
}

interface Worker {
  id: string;
  nodeId: string;
  status: string;
  maxConcurrent: number;
  currentTasks: number;
}

interface TasksResponse {
  tasks: Task[];
}

interface WorkersResponse {
  workers: Worker[];
}

interface ApiParam {
  name: string;
  type: string;
  required?: boolean;
  desc: string;
}

interface ApiEndpoint {
  method: string;
  path: string;
  desc: string;
  requestParams?: ApiParam[];
  requestBody?: ApiParam[];
  response?: ApiParam[];
}

export default function CodeSwarmPage() {
  return (
    <AdminGuard>
      <CodeSwarmPageContent />
    </AdminGuard>
  );
}

function StatsCards({ tasks, workers }: { tasks: Task[]; workers: Worker[] }) {
  const stats = useMemo(() => {
    const onlineWorkers = workers.filter(w => w.status === 'online').length;
    const totalWorkers = workers.length;
    const activeTasks = tasks.filter(t => ['queued', 'dispatched', 'building', 'running'].includes(t.state)).length;
    const completedTasks = tasks.filter(t => t.state === 'completed').length;
    const failedTasks = tasks.filter(t => t.state === 'failed').length;
    const totalTasks = tasks.length;
    const successRate = (completedTasks + failedTasks) > 0
      ? Math.round((completedTasks / (completedTasks + failedTasks)) * 100)
      : 0;

    return { onlineWorkers, totalWorkers, activeTasks, completedTasks, failedTasks, totalTasks, successRate };
  }, [tasks, workers]);

  const cards = [
    {
      label: '在线节点',
      value: `${stats.onlineWorkers}/${stats.totalWorkers}`,
      icon: Wifi,
      color: stats.onlineWorkers > 0 ? 'text-green-400' : 'text-gray-400',
      bg: stats.onlineWorkers > 0 ? 'bg-green-100' : 'bg-dark-surface-hover',
    },
    {
      label: '活跃任务',
      value: stats.activeTasks,
      icon: Loader2,
      color: 'text-blue-400',
      bg: 'bg-blue-100',
      spin: stats.activeTasks > 0,
    },
    {
      label: '已完成',
      value: stats.completedTasks,
      icon: CheckCircle,
      color: 'text-green-400',
      bg: 'bg-green-100',
    },
    {
      label: '成功率',
      value: `${stats.successRate}%`,
      icon: Activity,
      color: stats.successRate >= 80 ? 'text-green-400' : stats.successRate >= 50 ? 'text-yellow-400' : 'text-red-400',
      bg: stats.successRate >= 80 ? 'bg-green-100' : stats.successRate >= 50 ? 'bg-yellow-100' : 'bg-red-100',
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-dark-surface rounded-lg border border-gray-700/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className="text-2xl font-bold text-gray-100 mt-1">{card.value}</p>
            </div>
            <div className={`p-3 rounded-lg ${card.bg}`}>
              <card.icon className={`w-6 h-6 ${card.color} ${card.spin ? 'animate-spin' : ''}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ApiDocCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center space-x-3 p-4 bg-dark-bg hover:bg-dark-surface-hover transition-colors"
      >
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
          endpoint.method === 'GET' ? 'bg-green-500/15 text-green-400' :
          endpoint.method === 'POST' ? 'bg-blue-500/15 text-blue-400' :
          endpoint.method === 'PATCH' ? 'bg-yellow-500/15 text-yellow-400' :
          'bg-red-500/15 text-red-400'
        }`}>
          {endpoint.method}
        </span>
        <code className="text-sm text-gray-200 font-mono flex-1 text-left">{endpoint.path}</code>
        <span className="text-sm text-gray-500">{endpoint.desc}</span>
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 border-t">
          {endpoint.requestParams && endpoint.requestParams.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">URL 参数</h5>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1">参数</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">必填</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {endpoint.requestParams.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.required ? <span className="text-red-500">是</span> : <span className="text-gray-400">否</span>}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {endpoint.requestBody && endpoint.requestBody.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">请求体 (JSON)</h5>
              <pre className="bg-gray-900 text-cyan-400 p-3 rounded text-xs overflow-x-auto border border-gray-700">
{JSON.stringify(
  endpoint.requestBody.reduce((acc, p) => ({ ...acc, [p.name]: p.type }), {}),
  null, 2
)}
              </pre>
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1">字段</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">必填</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {endpoint.requestBody.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.required ? <span className="text-red-500">是</span> : <span className="text-gray-400">否</span>}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {endpoint.response && endpoint.response.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">响应示例</h5>
              <pre className="bg-gray-900 text-cyan-400 p-3 rounded text-xs overflow-x-auto border border-gray-700">
{JSON.stringify(
  endpoint.response.reduce((acc, p) => ({ ...acc, [p.name]: p.type }), {}),
  null, 2
)}
              </pre>
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1">字段</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {endpoint.response.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CodeSwarmPageContent() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'debug' | 'workers' | 'tasks' | 'logs' | 'api' | 'local-test' | 'codedmap' | 'session-extract' | 'vuln-reparse'>('overview');
  const { data: tasksData, refetch: refetchTasks } = useApiFetch<TasksResponse>('/api/codeswarm/tasks');
  const { data: workersData } = useApiFetch<WorkersResponse>('/api/codeswarm/nodes');

  const handleTaskCreated = (taskId: string) => {
    setSelectedTaskId(taskId);
    setActiveTab('tasks');
    refetchTasks();
  };

  const apiDocs = [
    {
      category: 'Worker 注册',
      endpoints: [
        {
          method: 'POST',
          path: '/api/codeswarm/worker/heartbeat',
          desc: 'Worker 心跳上报',
          requestBody: [
            { name: 'nodeId', type: 'string', required: true, desc: '节点唯一标识' },
            { name: 'maxConcurrent', type: 'number', required: false, desc: '最大并发数 (默认5)' },
            { name: 'currentTasks', type: 'number', required: false, desc: '当前任务数' },
            { name: 'address', type: 'string', required: false, desc: 'Worker 地址' },
          ],
          response: [
            { name: 'success', type: 'boolean', desc: '是否成功' },
            { name: 'nodeId', type: 'string', desc: '节点 ID' },
          ]
        },
        {
          method: 'POST',
          path: '/api/codeswarm/worker/event',
          desc: 'Worker 事件回调',
          requestBody: [
            { name: 'taskId', type: 'string', required: true, desc: '任务 ID' },
            { name: 'nodeId', type: 'string', required: false, desc: '节点 ID' },
            { name: 'events', type: 'Event[]', required: true, desc: '事件数组 [{type, data, timestamp}]' },
          ],
          response: [
            { name: 'success', type: 'boolean', desc: '是否成功' },
            { name: 'eventCount', type: 'number', desc: '处理的事件数' },
          ]
        },
        {
          method: 'POST',
          path: '/api/codeswarm/worker/result',
          desc: 'Worker 结果回调',
          requestBody: [
            { name: 'taskId', type: 'string', required: true, desc: '任务 ID' },
            { name: 'nodeId', type: 'string', required: false, desc: '节点 ID' },
            { name: 'status', type: 'string', required: true, desc: '状态 (completed/failed)' },
            { name: 'result', type: 'object', required: false, desc: '执行结果' },
            { name: 'error', type: 'string', required: false, desc: '错误信息' },
            { name: 'reportContent', type: 'string', required: false, desc: '报告内容' },
          ],
          response: [
            { name: 'success', type: 'boolean', desc: '是否成功' },
            { name: 'taskId', type: 'string', desc: '任务 ID' },
            { name: 'status', type: 'string', desc: '最终状态' },
          ]
        },
        {
          method: 'GET',
          path: '/api/codeswarm/worker/dist',
          desc: '下载 Worker 部署包 (Linux/macOS)',
          requestParams: [
            { name: 'version', type: 'string', required: false, desc: '版本号 (默认 0.2.0)' },
          ],
          response: [
            { name: 'Content-Type', type: 'application/gzip', desc: 'tar.gz 包' },
          ]
        },
      ]
    },
    {
      category: '任务管理',
      endpoints: [
        {
          method: 'GET',
          path: '/api/codeswarm/tasks',
          desc: '获取任务列表',
          response: [
            { name: 'tasks', type: 'Task[]', desc: '任务数组' },
          ]
        },
        {
          method: 'POST',
          path: '/api/codeswarm/tasks',
          desc: '创建任务 (平台接口)',
          requestBody: [
            { name: 'instruction', type: 'string', required: true, desc: 'AI 执行指令' },
            { name: 'agent', type: 'string', required: false, desc: '执行器类型 (opencode/claude/nazhua-audit)' },
            { name: 'projectPath', type: 'string', required: false, desc: '项目路径 (本地)' },
            { name: 'workspacePath', type: 'string', required: false, desc: '工作空间路径 (NFS共享目录)' },
            { name: 'engine', type: 'string', required: false, desc: '执行引擎 (opencode/claudecode，默认 opencode)' },
            { name: 'model', type: 'string', required: false, desc: 'AI 模型 (如 anthropic/claude-sonnet-4-5)' },
            { name: 'apiKey', type: 'string', required: false, desc: 'API Key (覆盖模型默认Key)' },
            { name: 'apiBaseUrl', type: 'string', required: false, desc: 'API Base URL (自定义模型端点)' },
            { name: 'timeoutSec', type: 'number', required: false, desc: '超时时间(秒，默认300)' },
            { name: 'skills', type: 'string[]', required: false, desc: '启用的 Skill 列表' },
            { name: 'mcps', type: 'string (JSON)', required: false, desc: 'MCP 服务配置 (JSON数组字符串)' },
            { name: 'gitUrl', type: 'string', required: false, desc: 'Git 仓库地址' },
            { name: 'gitRef', type: 'string', required: false, desc: 'Git 分支/Tag' },
            { name: 'preferredWorkerNodeId', type: 'string', required: false, desc: '指定 Worker 节点 (空则自动分配)' },
            { name: 'startCommand', type: 'string', required: false, desc: '自定义启动命令' },
          ],
          response: [
            { name: 'taskId', type: 'string', desc: '任务 ID' },
            { name: 'dispatched', type: 'boolean', desc: '是否已分发到 Worker' },
            { name: 'workerAddress', type: 'string', desc: 'Worker 地址 (分发时)' },
          ]
        },
        {
          method: 'GET',
          path: '/api/codeswarm/tasks/:taskId',
          desc: '获取任务详情',
          response: [
            { name: 'task', type: 'Task', desc: '任务对象' },
          ]
        },
        {
          method: 'DELETE',
          path: '/api/codeswarm/tasks/:taskId',
          desc: '删除任务',
          response: [
            { name: 'success', type: 'boolean', desc: '是否成功' },
          ]
        },
      ]
    },
    {
      category: '节点管理',
      endpoints: [
        {
          method: 'GET',
          path: '/api/codeswarm/nodes',
          desc: '获取 Worker 节点列表',
          response: [
            { name: 'workers', type: 'Worker[]', desc: '节点数组' },
          ]
        },
        {
          method: 'GET',
          path: '/api/codeswarm/nodes/:nodeId',
          desc: '获取节点详情 (含最近任务)',
          response: [
            { name: 'worker', type: 'Worker & {tasks: Task[]}', desc: '节点对象及最近20条任务' },
          ]
        },
        {
          method: 'PATCH',
          path: '/api/codeswarm/nodes/:nodeId',
          desc: '更新节点配置',
          requestBody: [
            { name: 'maxConcurrent', type: 'number', required: false, desc: '最大并发数 (1-50)' },
            { name: 'name', type: 'string', required: false, desc: '节点名称' },
            { name: 'status', type: 'string', required: false, desc: '节点状态' },
          ],
          response: [
            { name: 'success', type: 'boolean', desc: '是否成功' },
            { name: 'worker', type: 'Worker', desc: '更新后的节点对象' },
          ]
        },
        {
          method: 'DELETE',
          path: '/api/codeswarm/nodes/:nodeId',
          desc: '删除节点',
          response: [
            { name: 'success', type: 'boolean', desc: '是否成功' },
          ]
        },
      ]
    },
  ];

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-dark-surface-hover p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'overview'
              ? 'bg-dark-surface shadow text-blue-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>概览</span>
        </button>
        <button
          onClick={() => setActiveTab('debug')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'debug'
              ? 'bg-dark-surface shadow text-blue-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <Play className="w-4 h-4" />
          <span>任务调试</span>
        </button>
        <button
          onClick={() => setActiveTab('workers')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'workers'
              ? 'bg-dark-surface shadow text-blue-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>Worker 节点</span>
        </button>
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'tasks'
              ? 'bg-dark-surface shadow text-blue-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <List className="w-4 h-4" />
          <span>任务列表</span>
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'logs'
              ? 'bg-dark-surface shadow text-blue-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>日志查看</span>
        </button>
        <button
          onClick={() => setActiveTab('api')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'api'
              ? 'bg-dark-surface shadow text-blue-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>接口文档</span>
        </button>
        <button
          onClick={() => setActiveTab('local-test')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'local-test'
              ? 'bg-dark-surface shadow text-blue-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <FlaskConical className="w-4 h-4" />
          <span>报告解析测试</span>
        </button>
        <button
          onClick={() => setActiveTab('codedmap')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'codedmap'
              ? 'bg-dark-surface shadow text-purple-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Codedmap 调试</span>
        </button>
        <button
          onClick={() => setActiveTab('session-extract')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'session-extract'
              ? 'bg-dark-surface shadow text-emerald-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <FileSearch className="w-4 h-4" />
          <span>Session 解析</span>
        </button>
        <button
          onClick={() => setActiveTab('vuln-reparse')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'vuln-reparse'
              ? 'bg-dark-surface shadow text-orange-400'
              : 'text-gray-400 hover:text-gray-100'
          }`}
        >
          <RefreshCw className="w-4 h-4" />
          <span>漏洞重解析</span>
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <StatsCards tasks={tasksData?.tasks || []} workers={workersData?.workers || []} />
          <TaskResultViewer
            selectedTaskId={selectedTaskId}
            onTaskSelect={setSelectedTaskId}
            onRefresh={refetchTasks}
          />
        </div>
      )}

      {activeTab === 'debug' && (
        <TaskDebugPanel onTaskCreated={handleTaskCreated} />
      )}

      {activeTab === 'workers' && (
        <WorkerNodesTable />
      )}

      {activeTab === 'tasks' && (
        <TaskResultViewer
          selectedTaskId={selectedTaskId}
          onTaskSelect={setSelectedTaskId}
          onRefresh={refetchTasks}
        />
      )}

      {activeTab === 'logs' && (
        <WorkerLogsPage />
      )}

      {activeTab === 'api' && (
        <div className="bg-dark-surface rounded-lg">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">CodeSwarm API 文档</h2>
            <p className="text-sm text-gray-500 mt-1">点击接口查看详细参数说明</p>
          </div>
          <div className="p-6 space-y-6">
            {apiDocs.map((section) => (
              <div key={section.category}>
                <h3 className="text-sm font-medium text-gray-300 mb-3 uppercase tracking-wide">
                  {section.category}
                </h3>
                <div className="space-y-2">
                  {section.endpoints.map((ep) => (
                    <ApiDocCard key={`${ep.method}-${ep.path}`} endpoint={ep} />
                  ))}
                </div>
              </div>
            ))}

            <div className="mt-6 p-4 bg-primary-900/20 border border-primary-700/40 rounded-lg">
              <h4 className="text-sm font-medium text-primary-400 mb-2">Worker 启动配置示例</h4>
              <pre className="text-xs bg-gray-800 text-gray-200 p-3 rounded overflow-x-auto">
{`# 环境变量配置
ORCHESTRATOR_URL=http://your-domain.com   # 指向本服务
NODE_ID=worker-1                           # 唯一节点标识
PORT=8080                                  # Worker HTTP 端口
MAX_CONCURRENT=3                           # 最大并发任务数

# 引擎依赖安装
# OpenCode:     npm i -g opencode-ai@latest
# Claude Code:  npm i -g @anthropic-ai/claude-code @anthropic-ai/claude-code-acp

# 启动命令 (独立测试 Worker)
node scripts/test-worker.mjs

# 或使用完整 Worker 包
npx tsx packages/worker/src/index.ts`}
              </pre>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'local-test' && (
        <LocalTestPanel />
      )}

      {activeTab === 'codedmap' && (
        <CodedmapDebugPanel />
      )}

      {activeTab === 'session-extract' && (
        <SessionExtractPanel />
      )}

      {activeTab === 'vuln-reparse' && (
        <VulnReparsePanel />
      )}

      {/* Callback URLs Info */}
      {activeTab !== 'api' && activeTab !== 'overview' && activeTab !== 'local-test' && activeTab !== 'codedmap' && activeTab !== 'session-extract' && activeTab !== 'vuln-reparse' && (
        <div className="bg-cyan-900/20 border border-cyan-700/40 rounded-lg p-4">
          <h3 className="text-sm font-medium text-cyan-400 mb-2">Worker 配置说明</h3>
          <p className="text-sm text-gray-300 mb-2">
            Worker 启动时需要配置回调地址指向本服务：
          </p>
          <code className="block bg-gray-800 p-2 rounded text-xs text-green-400">
            ORCHESTRATOR_URL=http://localhost:3000 node scripts/test-worker.mjs
          </code>
          <p className="text-xs text-gray-400 mt-2">
            Worker 注册后会在此页面显示，心跳间隔 30 秒，超时 90 秒判定离线
          </p>
        </div>
      )}
    </div>
  );
}
