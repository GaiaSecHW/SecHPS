'use client';

import { useState } from 'react';
import { useApiFetch } from '@/hooks/useApiFetch';
import { WorkerNodesTable } from '@/components/codeswarm/WorkerNodesTable';
import { TaskDebugPanel } from '@/components/codeswarm/TaskDebugPanel';
import { TaskResultViewer } from '@/components/codeswarm/TaskResultViewer';
import { AdminGuard } from '@/components/PermissionGuard';
import { Server, Play, List, BookOpen, ChevronDown, ChevronRight } from 'lucide-react';

interface Task {
  id: string;
  taskId: string;
  state: string;
  instruction: string;
  workerId: string | null;
  createdAt: string;
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

function ApiDocCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center space-x-3 p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
          endpoint.method === 'GET' ? 'bg-green-100 text-green-700' :
          endpoint.method === 'POST' ? 'bg-blue-100 text-blue-700' :
          'bg-red-100 text-red-700'
        }`}>
          {endpoint.method}
        </span>
        <code className="text-sm text-gray-800 font-mono flex-1 text-left">{endpoint.path}</code>
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
                  <tr className="text-left text-gray-600">
                    <th className="pb-1">参数</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">必填</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-700">
                  {endpoint.requestParams.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-600">{p.name}</td>
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
              <pre className="bg-gray-800 text-green-400 p-3 rounded text-xs overflow-x-auto">
{JSON.stringify(
  endpoint.requestBody.reduce((acc, p) => ({ ...acc, [p.name]: p.type }), {}),
  null, 2
)}
              </pre>
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="pb-1">字段</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">必填</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-700">
                  {endpoint.requestBody.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-600">{p.name}</td>
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
              <pre className="bg-gray-800 text-green-400 p-3 rounded text-xs overflow-x-auto">
{JSON.stringify(
  endpoint.response.reduce((acc, p) => ({ ...acc, [p.name]: p.type }), {}),
  null, 2
)}
              </pre>
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="pb-1">字段</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-700">
                  {endpoint.response.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-600">{p.name}</td>
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
  const [activeTab, setActiveTab] = useState<'workers' | 'debug' | 'tasks' | 'api'>('debug');
  const { data: tasksData, refetch: refetchTasks } = useApiFetch<{ tasks: Task[] }>('/api/codeswarm/tasks');

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
      ]
    },
    {
      category: '任务管理',
      endpoints: [
        {
          method: 'GET',
          path: '/api/codeswarm/tasks',
          desc: '获取任务列表',
          requestParams: [
            { name: 'state', type: 'string', required: false, desc: '按状态筛选 (pending/running/completed/failed)' },
          ],
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
            { name: 'projectPath', type: 'string', required: false, desc: '项目路径' },
            { name: 'workspacePath', type: 'string', required: false, desc: '工作空间路径' },
            { name: 'model', type: 'string', required: false, desc: 'AI 模型 (如 anthropic/claude-sonnet-4)' },
            { name: 'apiKey', type: 'string', required: false, desc: 'API Key' },
            { name: 'timeoutSec', type: 'number', required: false, desc: '超时时间(秒)' },
            { name: 'skills', type: 'string[]', required: false, desc: '启用的 Skill 列表' },
            { name: 'mcps', type: 'object', required: false, desc: 'MCP 配置' },
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
            { name: 'nodes', type: 'Worker[]', desc: '节点数组' },
          ]
        },
        {
          method: 'GET',
          path: '/api/codeswarm/nodes/:nodeId',
          desc: '获取节点详情',
          response: [
            { name: 'node', type: 'Worker', desc: '节点对象' },
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Server className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CodeSwarm Worker 管理</h1>
            <p className="text-sm text-gray-600">
              分布式 Agent 执行节点管理 & 手动任务调试
            </p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('debug')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'debug'
              ? 'bg-white shadow text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Play className="w-4 h-4" />
          <span>任务调试</span>
        </button>
        <button
          onClick={() => setActiveTab('workers')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'workers'
              ? 'bg-white shadow text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>Worker 节点</span>
        </button>
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'tasks'
              ? 'bg-white shadow text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <List className="w-4 h-4" />
          <span>任务列表</span>
        </button>
        <button
          onClick={() => setActiveTab('api')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'api'
              ? 'bg-white shadow text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>接口文档</span>
        </button>
      </div>

      {/* Tab Content */}
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

      {activeTab === 'api' && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">CodeSwarm API 文档</h2>
            <p className="text-sm text-gray-500 mt-1">点击接口查看详细参数说明</p>
          </div>
          <div className="p-6 space-y-6">
            {apiDocs.map((section) => (
              <div key={section.category}>
                <h3 className="text-sm font-medium text-gray-700 mb-3 uppercase tracking-wide">
                  {section.category}
                </h3>
                <div className="space-y-2">
                  {section.endpoints.map((ep) => (
                    <ApiDocCard key={ep.path} endpoint={ep} />
                  ))}
                </div>
              </div>
            ))}

            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <h4 className="text-sm font-medium text-blue-800 mb-2">Worker 启动配置示例</h4>
              <pre className="text-xs bg-blue-100 p-3 rounded overflow-x-auto">
{`# 环境变量配置
ORCHESTRATOR_URL=http://your-domain.com   # 指向本服务
NODE_ID=worker-1                           # 唯一节点标识
PORT=8080                                  # Worker HTTP 端口
MAX_CONCURRENT=3                           # 最大并发任务数

# 启动命令
node packages/worker/dist/index.js`}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Callback URLs Info */}
      {activeTab !== 'api' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-yellow-800 mb-2">Worker 配置说明</h3>
          <p className="text-sm text-yellow-700 mb-2">
            Worker 启动时需要配置回调地址指向本服务：
          </p>
          <code className="block bg-yellow-100 p-2 rounded text-xs">
            ORCHESTRATOR_URL=http://localhost:3000 npx tsx packages/worker/src/index.ts
          </code>
          <p className="text-xs text-yellow-600 mt-2">
            Worker 注册后会在此页面显示，心跳间隔 30 秒，超时 90 秒判定离线
          </p>
        </div>
      )}
    </div>
  );
}
