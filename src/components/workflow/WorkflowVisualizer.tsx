'use client';

import { useEffect, useState, useRef } from 'react';
import {
  Play,
  Square,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  Circle,
} from 'lucide-react';

interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label?: string;
    description?: string;
    [key: string]: any;
  };
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string | null;
  completedAt?: string | null;
  order: number;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}

interface WorkflowData {
  workflow: {
    id: string;
    name: string;
    description?: string;
  } | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  executions: any[];
}

interface WorkflowVisualizerProps {
  evaluationId: string;
  opencodeSessionId?: string | null;
}

const statusConfig = {
  pending: {
    icon: Circle,
    color: '#9CA3AF',
    bgColor: '#F3F4F6',
    borderColor: '#D1D5DB',
    label: '待执行',
  },
  running: {
    icon: Loader2,
    color: '#3B82F6',
    bgColor: '#EFF6FF',
    borderColor: '#93C5FD',
    label: '执行中',
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    color: '#10B981',
    bgColor: '#ECFDF5',
    borderColor: '#6EE7B7',
    label: '已完成',
  },
  failed: {
    icon: AlertCircle,
    color: '#EF4444',
    bgColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    label: '失败',
  },
  skipped: {
    icon: Square,
    color: '#F59E0B',
    bgColor: '#FFFBEB',
    borderColor: '#FCD34D',
    label: '已跳过',
  },
};

const nodeTypeConfig = {
  start: {
    icon: Play,
    color: '#10B981',
    bgColor: '#ECFDF5',
    label: '开始',
  },
  end: {
    icon: Square,
    color: '#EF4444',
    bgColor: '#FEF2F2',
    label: '结束',
  },
  task: {
    icon: Clock,
    color: '#3B82F6',
    bgColor: '#EFF6FF',
    label: '任务',
  },
  subtask: {
    icon: Clock,
    color: '#8B5CF6',
    bgColor: '#F5F3FF',
    label: '子任务',
  },
};

export function WorkflowVisualizer({ evaluationId, opencodeSessionId }: WorkflowVisualizerProps) {
  const [workflowData, setWorkflowData] = useState<WorkflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchWorkflowData();
  }, [evaluationId]);

  useEffect(() => {
    // 定期刷新节点状态（如果会话正在运行）
    if (opencodeSessionId) {
      const interval = setInterval(fetchWorkflowData, 5000);
      return () => clearInterval(interval);
    }
  }, [opencodeSessionId]);

  const fetchWorkflowData = async () => {
    if (!evaluationId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/evaluations/${evaluationId}/nodes`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '获取工作流数据失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      setWorkflowData(data);
      setLoading(false);
    } catch (err) {
      console.error('Fetch workflow data error:', err);
      setError('');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-500">?..</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-4 text-red-500">
        <AlertCircle className="h-6 w-6 mx-auto mb-2" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!workflowData?.workflow) {
    return null; // ?  }

  const { workflow, nodes, edges } = workflowData;

  // 
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // ?  const outEdges = new Map<string, WorkflowEdge[]>();
  edges.forEach(e => {
    if (!outEdges.has(e.source)) {
      outEdges.set(e.source, []);
    }
    outEdges.get(e.source)!.push(e);
  });

  // 
  const startNode = nodes.find(n => n.type === 'start');
  const endNode = nodes.find(n => n.type === 'end');

  // ?BFS ?  const sortedNodes: WorkflowNode[] = [];
  const visited = new Set<string>();

  if (startNode) {
    const queue: string[] = [startNode.id];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = nodeMap.get(nodeId);
      // 
      if (node && node.type !== 'end') {
        sortedNodes.push(node);
      }

      const children = outEdges.get(nodeId) || [];
      children.forEach(edge => {
        if (!visited.has(edge.target)) {
          queue.push(edge.target);
        }
      });
    }
  }

  // 
  nodes.forEach(n => {
    if (!visited.has(n.id) && n.type !== 'end') {
      sortedNodes.push(n);
    }
  });

  // ?  if (endNode) {
    sortedNodes.push(endNode);
  }

  // 
  const completedCount = nodes.filter(n => n.status === 'completed').length;
  const totalCount = nodes.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // ?  const runningNode = nodes.find(n => n.status === 'running');

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{workflow.name}</h3>
            {workflow.description && (
              <p className="text-xs text-gray-500 mt-0.5">{workflow.description}</p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-gray-500">
              {completedCount}/{totalCount} 
            </span>
            <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs font-medium text-gray-700">{progress}%</span>
          </div>
        </div>
      </div>

      {/* Workflow Graph */}
      <div className="p-4 overflow-x-auto">
        <div className="flex items-center justify-start space-x-2 min-w-max">
          {sortedNodes.map((node, index) => {
            const status = statusConfig[node.status] || statusConfig.pending;
            const nodeType = nodeTypeConfig[node.type as keyof typeof nodeTypeConfig] || nodeTypeConfig.task;
            const StatusIcon = status.icon;
            const TypeIcon = nodeType.icon;

            return (
              <div key={node.id} className="flex items-center">
                {/* Node */}
                <div
                  className={`relative flex flex-col items-center p-3 rounded-xl border-2 transition-all duration-300 min-w-[120px]`}
                  style={{
                    backgroundColor: status.bgColor,
                    borderColor: status.borderColor,
                    boxShadow: node.status === 'running' ? `0 0 0 2px ${status.color}40` : 'none',
                  }}
                >
                  {/* Status Icon */}
                  <div
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: status.color }}
                  >
                    {status.animate ? (
                      <StatusIcon size={14} className="text-white animate-spin" />
                    ) : (
                      <StatusIcon size={14} className="text-white" />
                    )}
                  </div>

                  {/* Node Type Icon */}
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                    style={{ backgroundColor: `${nodeType.color}30` }}
                  >
                    <TypeIcon size={20} style={{ color: nodeType.color }} />
                  </div>

                  {/* Node Label */}
                  <p className="text-sm font-medium text-gray-900 text-center truncate max-w-[100px]">
                    {node.data?.label || nodeType.label}
                  </p>

                  {/* Status Label */}
                  <span
                    className="text-xs mt-1 px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${status.color}20`, color: status.color }}
                  >
                    {status.label}
                  </span>

                  {/* Node Type */}
                  <span className="text-xs text-gray-400 mt-1">
                    {nodeType.label}
                  </span>
                </div>

                {/* Arrow to next node */}
                {index < sortedNodes.length - 1 && (
                  <div className="flex items-center mx-2">
                    <div
                      className="w-8 h-0.5"
                      style={{ backgroundColor: '#D1D5DB' }}
                    />
                    <div
                      className="w-0 h-0 border-t-4 border-b-4 border-l-6 border-transparent"
                      style={{ borderLeftColor: '#D1D5DB' }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Current Running Task */}
      {runningNode && (
        <div className="px-4 py-3 border-t border-gray-200 bg-blue-50">
          <div className="flex items-center space-x-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span className="text-sm text-blue-700">
              : <strong>{runningNode.data?.label || ''}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
