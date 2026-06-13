import { useState } from 'react';
import { useApiFetch } from '@/lib/use-api-fetch';
import { TaskDebugPanel } from '@/components/TaskDebugPanel';
import { TaskResultViewer } from '@/components/TaskResultViewer';
import { WorkerNodesTable } from '@/components/WorkerNodesTable';
import WorkerLogsPage from '@/components/WorkerLogsPage';
import { StatsCards } from '@/components/StatsCards';
import { ApiDocCard, type ApiEndpoint } from '@/components/ApiDocCard';
import { Server, Play, List, BookOpen, ChevronDown, ChevronRight, Activity, CheckCircle, XCircle, Loader2, Wifi, Terminal } from 'lucide-react';

interface Task {
  taskId: string;
  state: string;
  instruction: string;
}

interface Worker {
  nodeId: string;
  status: string;
}

interface TasksResponse { tasks: Task[] }
interface WorkersResponse { workers: Worker[] }

type TabKey = 'overview' | 'debug' | 'workers' | 'tasks' | 'logs' | 'api';

const API_DOCS: { category: string; endpoints: ApiEndpoint[] }[] = [
  {
    category: '任务管理',
    endpoints: [
      { method: 'GET', path: '/api/codeswarm/task/list', desc: '获取任务列表', response: [{ name: 'tasks', type: 'Task[]', desc: '任务数组' }] },
      { method: 'POST', path: '/api/codeswarm/task/submit', desc: '提交任务', requestBody: [
        { name: 'instruction', type: 'string', required: true, desc: 'AI 执行指令' },
        { name: 'engine', type: 'string', desc: '执行引擎 (opencode/claudecode)' },
        { name: 'projectPath', type: 'string', desc: '项目路径' },
        { name: 'agentPath', type: 'string', desc: 'Agent 目录路径，Worker 会复制到任务工作区' },
        { name: 'workspacePath', type: 'string', desc: '工作空间路径' },
        { name: 'model', type: 'string', desc: 'AI 模型名称 (如 MiniMax-M2.7, DeepSeek-V3)' },
        { name: 'apiBaseUrl', type: 'string', desc: '自定义 API endpoint URL (OpenAI-compatible routers)' },
        { name: 'apiKey', type: 'string', desc: 'API Key' },
        { name: 'timeoutSec', type: 'number', desc: '超时时间(秒)' },
        { name: 'maxTokens', type: 'number', desc: '模型输出 token 限制' },
        { name: 'contextWindow', type: 'number', desc: '模型上下文窗口大小' },
        { name: 'skills', type: 'string[]', desc: '启用的 Skill 列表' },
        { name: 'mcps', type: 'any[]', desc: 'MCP 配置列表' },
        { name: 'env', type: 'Record<string,string>', desc: '传递给 Agent 进程的环境变量' },
        { name: 'scripts', type: 'string[]', desc: '脚本列表' },
        { name: 'preferredWorkerNodeId', type: 'string', desc: '指定 Worker 节点' },
        { name: 'targetProduct', type: 'string', desc: '目标产品名称' },
        { name: 'toolId', type: 'string', desc: 'Tool 标识符（启用 tool 调度模式）' },
        { name: 'toolPath', type: 'string', desc: 'Tool 可执行路径 (toolId 填写时有效)' },
        { name: 'toolWorkDir', type: 'string', desc: 'Tool 工作根目录 (TOOL_WORK_DIR)' },
      ], response: [
        { name: 'taskId', type: 'string', desc: '任务 ID' },
        { name: 'toolTaskId', type: 'string', desc: 'Tool 任务组合 ID (tool 模式返回)' },
        { name: 'workspacePath', type: 'string', desc: '工作区路径' },
        { name: 'queued', type: 'boolean', desc: '是否已入队' },
      ] },
      { method: 'GET', path: '/api/codeswarm/task/:taskId', desc: '获取任务详情 (含事件)', response: [{ name: 'task', type: 'Task & {events: Event[]}', desc: '任务对象' }] },
      { method: 'DELETE', path: '/api/codeswarm/task/:taskId', desc: '删除任务', response: [{ name: 'success', type: 'boolean', desc: '是否成功' }] },
      { method: 'GET', path: '/api/codeswarm/task/:taskId/stream', desc: 'SSE 实时事件流', response: [{ name: 'SSE', type: 'text/event-stream', desc: '实时事件' }] },
    ],
  },
  {
    category: '节点管理',
    endpoints: [
      { method: 'GET', path: '/api/codeswarm/node/list', desc: '获取 Worker 节点列表', response: [{ name: 'workers', type: 'Worker[]', desc: '节点数组' }] },
      { method: 'GET', path: '/api/codeswarm/node/:nodeId', desc: '获取节点详情', response: [{ name: 'worker', type: 'Worker', desc: '节点对象' }] },
      { method: 'PATCH', path: '/api/codeswarm/node/:nodeId', desc: '更新节点配置', requestBody: [{ name: 'maxConcurrent', type: 'number', desc: '最大并发数 (1-50)' }], response: [{ name: 'success', type: 'boolean', desc: '是否成功' }] },
      { method: 'DELETE', path: '/api/codeswarm/node/:nodeId', desc: '删除节点', response: [{ name: 'success', type: 'boolean', desc: '是否成功' }] },
    ],
  },
  {
    category: 'Worker 回调',
    endpoints: [
      { method: 'POST', path: '/api/codeswarm/worker/heartbeat', desc: 'Worker 心跳上报', requestBody: [
        { name: 'nodeId', type: 'string', required: true, desc: '节点唯一标识' },
        { name: 'maxConcurrent', type: 'number', desc: '最大并发数' },
        { name: 'currentTasks', type: 'number', desc: '当前任务数' },
        { name: 'address', type: 'string', desc: 'Worker 地址' },
      ]},
      { method: 'POST', path: '/api/codeswarm/worker/event', desc: 'Worker 事件回调', requestBody: [
        { name: 'taskId', type: 'string', required: true, desc: '任务 ID' },
        { name: 'events', type: 'Event[]', required: true, desc: '事件数组' },
      ]},
      { method: 'POST', path: '/api/codeswarm/worker/result', desc: 'Worker 结果回调', requestBody: [
        { name: 'taskId', type: 'string', required: true, desc: '任务 ID' },
        { name: 'status', type: 'string', required: true, desc: '状态 (completed/failed)' },
        { name: 'result', type: 'object', desc: '执行结果' },
      ]},
    ],
  },
];

export default function App() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const { data: tasksData, refetch: refetchTasks } = useApiFetch<TasksResponse>('/api/codeswarm/task/list');
  const { data: workersData } = useApiFetch<WorkersResponse>('/api/codeswarm/node/list');

  const handleTaskCreated = (taskId: string) => {
    setSelectedTaskId(taskId);
    setActiveTab('tasks');
    refetchTasks();
  };

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: '概览', icon: <Activity className="w-4 h-4" /> },
    { key: 'debug', label: '任务调试', icon: <Play className="w-4 h-4" /> },
    { key: 'workers', label: 'Worker 节点', icon: <Server className="w-4 h-4" /> },
    { key: 'tasks', label: '任务列表', icon: <List className="w-4 h-4" /> },
    { key: 'logs', label: '日志查看', icon: <Terminal className="w-4 h-4" /> },
    { key: 'api', label: '接口文档', icon: <BookOpen className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Header */}
      <div className="border-b border-gray-700/50 bg-dark-surface px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-100">CodeSwarm Debug</h1>
              <p className="text-sm text-gray-400">分布式任务调度 — 调试控制台</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-xs text-gray-500">
            <Wifi className="w-3 h-3" />
            <span>Scheduler API</span>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="px-6 pt-4">
        <div className="flex space-x-1 bg-dark-surface-hover p-1 rounded-lg w-fit">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
                activeTab === tab.key
                  ? 'bg-dark-surface shadow text-blue-400'
                  : 'text-gray-400 hover:text-gray-100'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <StatsCards tasks={tasksData?.tasks || []} workers={workersData?.workers || []} />
            <TaskResultViewer selectedTaskId={selectedTaskId} onTaskSelect={setSelectedTaskId} onRefresh={refetchTasks} />
          </div>
        )}
        {activeTab === 'debug' && <TaskDebugPanel onTaskCreated={handleTaskCreated} />}
        {activeTab === 'workers' && <WorkerNodesTable />}
        {activeTab === 'tasks' && <TaskResultViewer selectedTaskId={selectedTaskId} onTaskSelect={setSelectedTaskId} onRefresh={refetchTasks} />}
        {activeTab === 'logs' && <WorkerLogsPage />}
        {activeTab === 'api' && (
          <div className="bg-dark-surface rounded-lg">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold">CodeSwarm API 文档</h2>
              <p className="text-sm text-gray-500 mt-1">点击接口查看详细参数说明</p>
            </div>
            <div className="p-6 space-y-6">
              {API_DOCS.map((section) => (
                <div key={section.category}>
                  <h3 className="text-sm font-medium text-gray-300 mb-3 uppercase tracking-wide">{section.category}</h3>
                  <div className="space-y-2">
                    {section.endpoints.map((ep) => (
                      <ApiDocCard key={`${ep.method}-${ep.path}`} endpoint={ep} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
