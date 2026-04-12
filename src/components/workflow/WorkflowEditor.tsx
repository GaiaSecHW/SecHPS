'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  useReactFlow,
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import '@xyflow/react/dist/style.css';
import { Save, Undo, Redo, ZoomIn, ZoomOut, Maximize, Settings, Trash2, Eye, X, Power, PowerOff, Sparkles, Loader2, Edit2, Check } from 'lucide-react';
import NodePalette from './NodePalette';
import { nodeTypes } from './CustomNodes';
import { FlowNode, FlowEdge, NodeData, NodeTypeDefinition, WorkflowData, NODE_TYPE_MAP, WorkflowNodeType } from '@/types/workflow';
import { useTechStackOptions } from '@/hooks/useTechStackOptions';

interface WorkflowEditorProps {
  workflowId?: string;
  initialData?: WorkflowData;
  onSave?: (data: WorkflowData) => Promise<void>;
  onExecute?: () => Promise<void>;
  readOnly?: boolean;
  isEnabled?: boolean;
  onToggleEnabled?: () => void;
}

function WorkflowEditorContent({
  workflowId,
  initialData,
  onSave,
  onExecute,
  readOnly = false,
  isEnabled = true,
  onToggleEnabled,
}: WorkflowEditorProps) {
  const { zoomIn, zoomOut, fitView, screenToFlowPosition, setViewport, getViewport } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialData?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(initialData?.edges || []);
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<FlowEdge | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<WorkflowData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'node' | 'edge', id: string } | null>(null);
const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  
  // 使用 Hook 获取技术栈选项
  const { options: techStackOptions, loading: loadingTechStack } = useTechStackOptions();
  
  // 预测任务
  const [predictionTasks, setPredictionTasks] = useState<Array<{
    id: string;
    taskName: string;
    taskDescription: string;
    nodeId: string | null;
    topK: number;
    status: string;
    progress: number;
    errorMessage: string | null;
    matches: Array<{
      skillId: string;
      skillName: string;
      displayName: string;
      category: string;
      techStack: string[];
      relevance: number;
      reason: string;
    }> | null;
    method: string | null;
    matchCount: number | null;
    startedAt: string | null;
    completedAt: string | null;
    duration: number | null;
    createdAt: string;
    workflowId: string | null;
  }>>([]);
  const [showPredictionTasks, setShowPredictionTasks] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [pollingTaskId, setPollingTaskId] = useState<string | null>(null);
  
  // 当前查看预测任务的节点 ID
  const [viewingNodeId, setViewingNodeId] = useState<string | null>(null);
  
  // 工作流信息编辑模态框
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTechStack, setEditTechStack] = useState<string[]>([]);
  const [techStackSearch, setTechStackSearch] = useState('');
  const [showTechStackDropdown, setShowTechStackDropdown] = useState(false);
  const [updatingInfo, setUpdatingInfo] = useState(false);
  
  // 工作流配置（从系统配置读取）
  const [workflowConfig, setWorkflowConfig] = useState<{
    startNodeLabel: string;
    startNodeDescription: string;
    endNodeLabel: string;
    endNodeDescription: string;
  }>({
    startNodeLabel: '开始',
    startNodeDescription: '工作流的起始点',
    endNodeLabel: '结束',
    endNodeDescription: '工作流的结束点',
  });

  // 加载工作流配置
  useEffect(() => {
    const fetchWorkflowConfig = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/workflows/config', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const config = await response.json();
          console.log('[WorkflowEditor] Loaded workflowConfig:', config);
          setWorkflowConfig(config);
        } else {
          console.error('[WorkflowEditor] Failed to load workflowConfig, status:', response.status);
        }
      } catch (error) {
        console.error('Failed to fetch workflow config:', error);
      }
    };

    fetchWorkflowConfig();
  }, []);

// 保存当前状态到历史记录
  const saveToHistory = useCallback(() => {
    const currentState: WorkflowData = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
      viewport: undefined,
    };
 
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(currentState);
 
    if (newHistory.length > 50) {
      newHistory.shift();
    }
 
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [nodes, edges, history, historyIndex]);
 
  // 收集 Agent 及其子 Agent 的内容
  const collectAgentContent = (agentNodeId: string): string => {
    const agentNode = nodes.find(n => n.id === agentNodeId);
    if (!agentNode) return '';
    
    const parts: string[] = [];
    
    // 添加主 Agent 内容
    parts.push(`【Agent】${agentNode.data.label}`);
    if (agentNode.data.description) {
      parts.push(agentNode.data.description);
    }
    
    // 查找所有直接连接的子 Agent（通过边连接的 subtask 节点）
    const childEdges = edges.filter(e => e.source === agentNodeId);
    for (const edge of childEdges) {
      const childNode = nodes.find(n => n.id === edge.target && n.type === 'subtask');
      if (childNode) {
        parts.push(`\n【子Agent】${childNode.data.label}`);
        if (childNode.data.description) {
          parts.push(childNode.data.description);
        }
      }
    }
    
    return parts.join('\n');
  };
 
  // 创建预测任务（异步）
  const createPredictionTask = async (nodeName: string, nodeDescription: string, nodeId: string) => {
    if (!workflowId || !nodeName) return;
    
    try {
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/skills/predict-tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          taskName: nodeName,
          taskDescription: nodeDescription || '',
          workflowId,
          nodeId,
          topK: 5,
        }),
      });
      
      if (!response.ok) {
        throw new Error('创建预测任务失败');
      }
      
      const data = await response.json();
      console.log('[WorkflowEditor] 预测任务已创建:', data.task);
      
      // 刷新任务列表
      fetchPredictionTasks();
      
      // 开始轮询任务状态
      setPollingTaskId(data.task.id);
    } catch (error) {
      console.error('创建预测任务失败:', error);
      alert('创建预测任务失败');
    }
  };
  
  // 加载预测任务列表
  const fetchPredictionTasks = async (nodeId?: string) => {
    if (!workflowId) return;
    
    try {
      setLoadingTasks(true);
      const token = localStorage.getItem('token');
      const nodeIdParam = nodeId ? `&nodeId=${nodeId}` : '';
      const response = await fetch(`/api/skills/predict-tasks?workflowId=${workflowId}${nodeIdParam}&limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setPredictionTasks(data.tasks || []);
      }
    } catch (error) {
      console.error('加载预测任务失败:', error);
    } finally {
      setLoadingTasks(false);
    }
  };
  
  // 取消任务
  const cancelTask = async (taskId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/predict-tasks/${taskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        // 刷新任务列表
        fetchPredictionTasks();
      } else {
        alert('取消任务失败');
      }
    } catch (error) {
      console.error('取消任务失败:', error);
      alert('取消任务失败');
    }
  };
  
  // 轮询任务状态
  useEffect(() => {
    if (!pollingTaskId) return;
    
    const pollInterval = setInterval(async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/skills/predict-tasks/${pollingTaskId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (response.ok) {
          const data = await response.json();
          const task = data.task;
          
          // 更新任务列表中的状态
          setPredictionTasks(prev =>
            prev.map(t => t.id === task.id ? task : t)
          );
          
          // 如果任务完成或失败，停止轮询
          if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
            setPollingTaskId(null);
            clearInterval(pollInterval);
          }
        }
      } catch (error) {
        console.error('轮询任务状态失败:', error);
      }
    }, 2000); // 每 2 秒轮询一次
    
    return () => clearInterval(pollInterval);
  }, [pollingTaskId]);
  
  // 初始加载预测任务
  useEffect(() => {
    if (workflowId) {
      fetchPredictionTasks();
    }
  }, [workflowId]);

  // 为节点添加 workflowConfig
  const nodesWithConfig = useMemo(() => {
    return nodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        workflowConfig,
      },
    }));
  }, [nodes, workflowConfig]);

  // 初始化历史记录
  useEffect(() => {
    if (initialData && history.length === 0) {
      saveToHistory();
    }
  }, [initialData, history.length, saveToHistory]);

  // 撤销
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      setNodes(prevState.nodes);
      setEdges(prevState.edges);
      setHistoryIndex(historyIndex - 1);
    }
  }, [history, historyIndex, setNodes, setEdges]);

  // 重做
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setNodes(nextState.nodes);
      setEdges(nextState.edges);
      setHistoryIndex(historyIndex + 1);
    }
  }, [history, historyIndex, setNodes, setEdges]);

  // 连接节点 - 带规则验证
  const onConnect = useCallback(
    (connection: Connection) => {
      // 获取源节点和目标节点
      const sourceNode = nodes.find(n => n.id === connection.source);
      const targetNode = nodes.find(n => n.id === connection.target);
      
      if (!sourceNode || !targetNode) {
        console.warn('无法找到源节点或目标节点');
        return;
      }
      
      const sourceType = sourceNode.type;
      const targetType = targetNode.type;
      const sourceHandle = connection.sourceHandle;
      const targetHandle = connection.targetHandle;
      
      // 连接规则验证
      // 1. 开始节点只能连接到Agent节点（左侧输入）
      if (sourceType === 'start' && targetType !== 'task') {
        alert('开始节点只能连接到Agent节点');
        return;
      }
      
      // 2. 结束节点只能被Agent节点连接（右侧输出）
      if (targetType === 'end' && sourceType !== 'task') {
        alert('只有Agent节点可以连接到结束节点');
        return;
      }
      
      // 3. Agent节点连接规则
      if (sourceType === 'task') {
        // 从右侧输出连接到Agent节点（左侧输入）或结束节点
        if (sourceHandle === 'out' || !sourceHandle) {
          if (targetType !== 'task' && targetType !== 'end') {
            alert('Agent节点的右侧输出只能连接到Agent节点或结束节点');
            return;
          }
          // 目标节点应该通过左侧输入句柄连接
          if (targetHandle && targetHandle !== 'in') {
            alert('请连接到Agent节点的左侧输入');
            return;
          }
        }
        // 从底部子Agent输出连接到子Agent节点（顶部输入）
        else if (sourceHandle === 'subtask') {
          if (targetType !== 'subtask') {
            alert('Agent节点的底部输出只能连接到子Agent节点');
            return;
          }
          // 目标节点应该通过顶部输入句柄连接
          if (targetHandle && targetHandle !== 'in') {
            alert('请连接到子Agent节点的顶部输入');
            return;
          }
        }
      }
      
      // 4. 子Agent节点可以连接到子Agent节点（上下连接）
      if (sourceType === 'subtask' && targetType !== 'subtask') {
        alert('子Agent节点只能连接到子Agent节点');
        return;
      }
      
      // 检查是否已存在相同的连接
      const existingEdge = edges.find(
        e => e.source === connection.source && 
             e.target === connection.target &&
             e.sourceHandle === connection.sourceHandle &&
             e.targetHandle === connection.targetHandle
      );
      if (existingEdge) {
        alert('该连接已存在');
        return;
      }
      
      const newEdge: FlowEdge = {
        ...connection,
        id: `edge-${Date.now()}`,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#3B82F6', strokeWidth: 2 },
      };
      setEdges((eds) => addEdge(newEdge, eds));
      saveToHistory();
    },
    [nodes, edges, setEdges, saveToHistory]
  );

  // 处理节点拖拽开始
  const handleNodeDragStart = useCallback((nodeType: NodeTypeDefinition) => {
    // 数据通过 React Flow 的 drag 事件处理
  }, []);

  // 处理节点放置
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      try {
        const nodeData = JSON.parse(event.dataTransfer.getData('application/reactflow'));

        // 使用 screenToFlowPosition 准确计算位置
        // 注意：需要考虑 React Flow 容器的边界框
        const bounds = (event.target as HTMLElement).getBoundingClientRect();
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        console.log('Drop position:', { 
          clientX: event.clientX, 
          clientY: event.clientY,
          flowX: position.x, 
          flowY: position.y 
        });

        const nodeType = NODE_TYPE_MAP[nodeData.type as WorkflowNodeType];
        
        // 开始和结束节点不保存label和description，实时从系统配置读取
        const isSystemNode = nodeData.type === 'start' || nodeData.type === 'end';
        
        const newNode: FlowNode = {
          id: `node-${Date.now()}`,
          type: nodeData.type,
          position,
          data: {
            label: isSystemNode ? '' : (nodeType?.defaultLabel || nodeData.label),
            description: isSystemNode ? '' : (nodeType?.defaultDescription || nodeData.description),
            config: {},
            inputs: nodeData.inputs,
            outputs: nodeData.outputs,
          },
        };

        setNodes((nds) => [...nds, newNode]);
        saveToHistory();
      } catch (error) {
        console.error('Failed to parse node data:', error);
      }
    },
    [setNodes, saveToHistory, screenToFlowPosition]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // 处理节点选择
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node as FlowNode);
    setSelectedEdge(null);
  }, []);

  // 处理边选择
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge as FlowEdge);
    setSelectedNode(null);
  }, []);

  // 处理画布点击
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  // 删除节点
  const handleDeleteNode = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
    saveToHistory();
  }, [selectedNode, setNodes, setEdges, saveToHistory]);

  // 删除边
  const handleDeleteEdge = useCallback(() => {
    if (!selectedEdge) return;
    setEdges((eds) => eds.filter((e) => e.id !== selectedEdge.id));
    setSelectedEdge(null);
    saveToHistory();
  }, [selectedEdge, setEdges, saveToHistory]);

  // 注意：键盘删除功能已禁用
  // 用户只能通过右侧属性面板中的删除按钮删除节点和边
  // 这样可以防止误删，并提供更好的用户体验

  // 生成缩略图
  const generateThumbnail = async (): Promise<string | undefined> => {
    try {
      // 获取 ReactFlow 容器
      const reactFlowContainer = document.querySelector('.react-flow') as HTMLElement;
      if (!reactFlowContainer) {
        console.warn('ReactFlow container not found');
        return undefined;
      }

      // 让所有节点自适应视图大小并居中
      fitView({
        padding: 0.1, // 留一点边距
        duration: 0,
      });

      // 等待视图更新完成
      await new Promise(resolve => setTimeout(resolve, 300));

      // 生成缩略图
      const dataUrl = await toPng(reactFlowContainer, {
        quality: 0.9,
        pixelRatio: 2,
        backgroundColor: '#f9fafb',
        skipAutoScale: false,
        includeQueryParams: true,
      });

      // 提取 Base64 部分（去掉 data:image/png;base64, 前缀）
      const base64Data = dataUrl.split(',')[1];
      return base64Data;
    } catch (error) {
      console.error('Failed to generate thumbnail:', error);
      return undefined;
    }
  };

  // 保存工作流
  const handleSave = async () => {
    if (!onSave) return;

    try {
      setSaving(true);
      
      // 生成缩略图
      const thumbnail = await generateThumbnail();
      
      const data: WorkflowData = {
        nodes,
        edges,
        viewport: undefined,
        thumbnail, // 添加缩略图
      };
      await onSave(data);
    } catch (error) {
      console.error('Failed to save workflow:', error);
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 生成预览内容（Markdown 格式）
  const generatePreviewContent = () => {
    let markdown = '# 工作流预览\n\n';
    
    // 按拓扑顺序排序节点（基于连接关系）
    const nodeOrder = new Map<string, number>();
    let order = 0;
    
    // 找到开始节点
    const startNode = nodes.find(n => n.type === 'start');
    if (startNode) {
      nodeOrder.set(startNode.id, order++);
      
      // BFS 遍历连接
      const queue = [startNode.id];
      const visited = new Set([startNode.id]);
      
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const currentOrder = nodeOrder.get(currentId)!;
        
        // 找到当前节点的所有出边
        const outgoingEdges = edges.filter(e => e.source === currentId);
        
        for (const edge of outgoingEdges) {
          if (!visited.has(edge.target)) {
            visited.add(edge.target);
            nodeOrder.set(edge.target, currentOrder + 1);
            queue.push(edge.target);
          }
        }
      }
    }
    
    // 为未连接的节点分配顺序
    nodes.forEach(node => {
      if (!nodeOrder.has(node.id)) {
        nodeOrder.set(node.id, order++);
      }
    });
    
    // 按顺序输出节点
    const sortedNodes = [...nodes].sort((a, b) => {
      const orderA = nodeOrder.get(a.id) ?? 999;
      const orderB = nodeOrder.get(b.id) ?? 999;
      return orderA - orderB;
    });
    
    sortedNodes.forEach((node, index) => {
      const nodeData = node.data as NodeData;
      const nodeType = NODE_TYPE_MAP[node.type as keyof typeof NODE_TYPE_MAP];
      
      markdown += `## ${index + 1}. ${nodeData.label}\n\n`;
      
      if (nodeData.description) {
        markdown += `**描述**: ${nodeData.description}\n\n`;
      }
      
      markdown += `**类型**: ${nodeType?.label || node.type}\n\n`;
      
      // 显示连接关系
      const incomingEdges = edges.filter(e => e.target === node.id);
      const outgoingEdges = edges.filter(e => e.source === node.id);
      
      if (incomingEdges.length > 0) {
        markdown += `**输入来源**: \n`;
        incomingEdges.forEach(edge => {
          const sourceNode = nodes.find(n => n.id === edge.source);
          if (sourceNode) {
            markdown += `- 来自: ${(sourceNode.data as NodeData).label}\n`;
          }
        });
        markdown += '\n';
      }
      
      if (outgoingEdges.length > 0) {
        markdown += `**输出目标**: \n`;
        outgoingEdges.forEach(edge => {
          const targetNode = nodes.find(n => n.id === edge.target);
          if (targetNode) {
            markdown += `- 到: ${(targetNode.data as NodeData).label}\n`;
          }
        });
        markdown += '\n';
      }
      
      markdown += '---\n\n';
    });
    
    // 添加统计信息
    markdown += '## 统计信息\n\n';
    markdown += `- **节点总数**: ${nodes.length}\n`;
    markdown += `- **连接总数**: ${edges.length}\n`;
    markdown += `- **节点类型分布**:\n`;
    
    const typeCount = new Map<string, number>();
    nodes.forEach(node => {
      const count = typeCount.get(node.type) || 0;
      typeCount.set(node.type, count + 1);
    });
    
    typeCount.forEach((count, type) => {
      const nodeType = NODE_TYPE_MAP[type as keyof typeof NODE_TYPE_MAP];
      markdown += `  - ${nodeType?.label || type}: ${count}\n`;
    });
    
    return markdown;
  };

  // 显示预览
  const handlePreview = () => {
    const content = generatePreviewContent();
    setPreviewContent(content);
    setShowPreview(true);
  };

  return (
    <div className="flex h-full">
      {/* 左侧节点面板 */}
      {!readOnly && (
        <div className="w-72 flex-shrink-0">
          <NodePalette onNodeDragStart={handleNodeDragStart} />
        </div>
      )}

      {/* 中间画布区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 工具栏 */}
        <div className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
          <div className="flex items-center space-x-2">
            {!readOnly && (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <Save size={16} />
                  <span>{saving ? '保存中...' : '保存'}</span>
                </button>
                <button
                  onClick={handlePreview}
                  className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700"
                >
                  <Eye size={16} />
                  <span>预览</span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {/* 启用/禁用状态切换 */}
            {onToggleEnabled && (
              <button
                onClick={onToggleEnabled}
                className={`flex items-center space-x-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
                  isEnabled
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-gray-400 text-white hover:bg-gray-500'
                }`}
                title={isEnabled ? '点击禁用工作流' : '点击启用工作流'}
              >
                {isEnabled ? <Power size={16} /> : <PowerOff size={16} />}
                <span>{isEnabled ? '已启用' : '已禁用'}</span>
              </button>
            )}
            
            {!readOnly && (
              <>
                <button
                  onClick={handleUndo}
                  disabled={historyIndex <= 0}
                  className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="撤销"
                >
                  <Undo size={18} />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                  className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="重做"
                >
                  <Redo size={18} />
                </button>
              </>
            )}
            <button
              onClick={() => zoomIn()}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
              title="放大"
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={() => zoomOut()}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
              title="缩小"
            >
              <ZoomOut size={18} />
            </button>
            <button
              onClick={() => fitView()}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
              title="适应视图"
            >
              <Maximize size={18} />
            </button>
          </div>
        </div>

        {/* React Flow 画布 */}
        <div className="flex-1 bg-gray-50 relative overflow-hidden" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodesWithConfig}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={{
              type: 'smoothstep',
              animated: true,
              style: { stroke: '#3B82F6', strokeWidth: 2 },
            }}
            fitView
            attributionPosition="bottom-left"
            minZoom={0.1}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
            style={{ width: '100%', height: '100%' }}
          >
            <Background color="#aaa" gap={16} />
            <Controls showZoom={true} showFitView={true} showInteractive={true} />
            <MiniMap
              nodeColor={(node) => {
                const nodeData = node.data as NodeData;
                return NODE_TYPE_MAP[nodeData.type || 'task']?.color || '#3B82F6';
              }}
              nodeStrokeWidth={3}
              zoomable={true}
              pannable={true}
              className="!bg-white !border-2 !border-gray-300 !rounded-lg !shadow-lg"
              style={{ width: 200, height: 150 }}
              maskColor="rgba(0, 0, 0, 0.1)"
            />
          </ReactFlow>

          {/* 缩放提示 */}
          <div className="absolute bottom-4 left-4 bg-white px-3 py-1.5 rounded-lg shadow-md text-xs text-gray-500 border border-gray-200 z-10">
            💡 提示：右下角小地图可快速导航，滚轮缩放，拖拽平移
          </div>
        </div>
      </div>

      {/* 右侧属性面板 */}
      {(selectedNode || selectedEdge) && (
        <div className="w-80 flex-shrink-0 bg-white border-l border border-gray-200 overflow-y-auto">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Settings size={20} />
              属性配置
            </h3>
            {!readOnly && (
              <button
                onClick={() => {
                  if (selectedNode) {
                    handleDeleteNode();
                  } else if (selectedEdge) {
                    handleDeleteEdge();
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md"
              >
                <Trash2 size={16} />
                删除
              </button>
            )}
          </div>

          <div className="p-4">
            {selectedNode && (
              <div className="space-y-4">
                {/* 检查节点是否可编辑 */}
                {NODE_TYPE_MAP[selectedNode.type as WorkflowNodeType]?.editable !== false ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        节点名称
                      </label>
                      <input
                        type="text"
                        value={selectedNode.data.label}
                        onChange={(e) => {
                          const updatedNode = { 
                            ...selectedNode, 
                            data: { ...selectedNode.data, label: e.target.value } 
                          };
                          setNodes((nds) =>
                            nds.map((n) =>
                              n.id === selectedNode.id ? updatedNode : n
                            )
                          );
                          setSelectedNode(updatedNode);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        描述
                      </label>
                      <textarea
                        value={selectedNode.data.description || ''}
                        onChange={(e) => {
                          const updatedNode = { 
                            ...selectedNode, 
                            data: { ...selectedNode.data, description: e.target.value } 
                          };
                          setNodes((nds) =>
                            nds.map((n) =>
                              n.id === selectedNode.id ? updatedNode : n
                            )
                          );
                          setSelectedNode(updatedNode);
                        }}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4">
                      <p className="text-sm text-blue-800 font-medium mb-2">
                        系统节点配置
                      </p>
                      <p className="text-xs text-blue-600">
                        此节点为系统节点，名称和描述由系统配置管理
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        节点名称
                      </label>
                      <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-900">
                        {selectedNode.type === 'start' 
                          ? workflowConfig.startNodeLabel 
                          : selectedNode.type === 'end' 
                            ? workflowConfig.endNodeLabel 
                            : selectedNode.data.label}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        描述
                      </label>
                      <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-900 whitespace-pre-wrap">
                        {selectedNode.type === 'start' 
                          ? workflowConfig.startNodeDescription 
                          : selectedNode.type === 'end' 
                            ? workflowConfig.endNodeDescription 
                            : selectedNode.data.description || '无描述'}
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    节点类型
                  </label>
                  <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-600">
                    {selectedNode.type}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    节点 ID
                  </label>
                  <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-600 font-mono">
                    {selectedNode.id}
                  </div>
                </div>

                {/* Skill 预测 - 对 Agent 和子Agent 类型节点显示 */}
                {(selectedNode.type === 'task' || selectedNode.type === 'subtask') && (
                  <div className="pt-4 border-t border-gray-200">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Skill 匹配预测
                    </label>
                    <div className="space-y-2">
                      <button
                        onClick={() => {
                          if (selectedNode.data.label) {
                            // Agent 节点：包含子 Agent 内容
                            // 子 Agent 节点：只预测自己
                            if (selectedNode.type === 'task') {
                              // 收集当前 Agent 及其子 Agent 的内容
                              const agentContent = collectAgentContent(selectedNode.id);
                              createPredictionTask(
                                selectedNode.data.label,
                                agentContent,
                                selectedNode.id
                              );
                            } else {
                              // 子 Agent 只预测自己
                              createPredictionTask(
                                selectedNode.data.label,
                                selectedNode.data.description || '',
                                selectedNode.id
                              );
                            }
                          }
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-sm"
                      >
                        <Sparkles size={14} />
                        预测匹配
                      </button>
                      
                      <button
                        onClick={() => {
                          // 设置当前查看的节点，并显示弹窗
                          setViewingNodeId(selectedNode.id);
                          setShowPredictionTasks(true);
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors text-sm"
                      >
                        <Sparkles size={12} />
                        查看预测 ({predictionTasks.filter(t => t.nodeId === selectedNode.id).length})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedEdge && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    边标签
                  </label>
                  <input
                    type="text"
                    value={selectedEdge.label || ''}
                    onChange={(e) => {
                      const updatedEdges = edges.map((ed) =>
                        ed.id === selectedEdge.id
                          ? { ...ed, label: e.target.value }
                          : ed
                      );
                      setEdges(updatedEdges);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    边 ID
                  </label>
                  <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-600 font-mono">
                    {selectedEdge.id}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    源节点
                  </label>
                  <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-600 font-mono">
                    {selectedEdge.source}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    目标节点
                  </label>
                  <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-600 font-mono">
                    {selectedEdge.target}
                  </div>
                </div>
              </div>
            )}
           </div>
         </div>
       )}

      {/* 预览弹窗 */}
      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
            {/* 头部 */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">工作流预览</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            {/* 内容 */}
            <div className="flex-1 overflow-auto p-6">
              <div className="prose prose-sm max-w-none">
                {previewContent.split('\n').map((line, index) => {
                  // 简单的 Markdown 渲染
                  if (line.startsWith('# ')) {
                    return <h1 key={index} className="text-2xl font-bold mb-4">{line.slice(2)}</h1>;
                  }
                  if (line.startsWith('## ')) {
                    return <h2 key={index} className="text-xl font-semibold mb-3 mt-4">{line.slice(3)}</h2>;
                  }
                  if (line.startsWith('---')) {
                    return <hr key={index} className="my-4 border-gray-300" />;
                  }
                  if (line.startsWith('- **')) {
                    return <p key={index} className="text-sm text-gray-600 mb-1">{line}</p>;
                  }
                  if (line.startsWith('- ')) {
                    return <p key={index} className="text-sm text-gray-700 ml-4 mb-1">{line.slice(2)}</p>;
                  }
                  if (line.startsWith('**')) {
                    return <p key={index} className="text-sm font-medium text-gray-900 mb-1">{line}</p>;
                  }
                  if (line.trim() === '') {
                    return <br key={index} />;
                  }
                  return <p key={index} className="text-sm text-gray-700 mb-1">{line}</p>;
                })}
              </div>
            </div>

            {/* 底部 */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowPreview(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 预测任务弹窗 */}
      {showPredictionTasks && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
            {/* 头部 */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Sparkles size={20} />
                预测任务
              </h3>
              <button
                onClick={() => setShowPredictionTasks(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            {/* 内容 */}
            <div className="flex-1 overflow-auto p-6">
              {loadingTasks ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                </div>
              ) : (() => {
                  // 按当前查看的节点过滤任务
                  const filteredTasks = viewingNodeId 
                    ? predictionTasks.filter(t => t.nodeId === viewingNodeId)
                    : predictionTasks;
                  return filteredTasks.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">
                      暂无预测任务
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {filteredTasks.map((task) => (
                    <div key={task.id} className="border border-gray-200 rounded-lg p-4">
                      {/* 标题和时间 */}
                       <div className="flex items-start justify-between mb-3">
                         <div className="flex-1">
                           <h4 className="font-semibold text-gray-900">{task.taskName}</h4>
                           <p className="text-sm text-gray-600 mt-1">{task.taskDescription}</p>
                           {task.nodeId && (
                             <p className="text-xs text-gray-400 mt-1 font-mono">节点: {task.nodeId}</p>
                           )}
                         </div>
                        <div className="text-right ml-4">
                          <div className="text-xs text-gray-500">
                            {new Date(task.createdAt).toLocaleString('zh-CN')}
                          </div>
                          {/* 状态标签 */}
                          <div className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full mt-1 ${
                            task.status === 'completed' ? 'bg-green-100 text-green-800' :
                            task.status === 'running' ? 'bg-blue-100 text-blue-800' :
                            task.status === 'failed' ? 'bg-red-100 text-red-800' :
                            task.status === 'cancelled' ? 'bg-gray-100 text-gray-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {task.status === 'pending' && '等待中'}
                            {task.status === 'running' && (
                              <>
                                <Loader2 size={10} className="animate-spin" />
                                运行中
                              </>
                            )}
                            {task.status === 'completed' && '已完成'}
                            {task.status === 'failed' && '失败'}
                            {task.status === 'cancelled' && '已取消'}
                          </div>
                          {/* 进度条 */}
                          {(task.status === 'running' || task.status === 'pending') && (
                            <div className="mt-2 w-32">
                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                <div 
                                  className="bg-blue-500 h-1.5 rounded-full transition-all"
                                  style={{ width: `${task.progress}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500">{task.progress}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* 错误信息 */}
                      {task.errorMessage && (
                        <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-3">
                          <p className="text-sm text-red-700">{task.errorMessage}</p>
                        </div>
                      )}
                      
                      {/* 匹配结果 */}
                      {task.status === 'completed' && task.matches && Array.isArray(task.matches) && (
                        <div className="space-y-2">
                          <h5 className="text-sm font-medium text-gray-700">
                            匹配的 Skills ({task.matchCount}) - {task.method === 'llm' ? 'AI 匹配' : '关键词匹配'}
                          </h5>
                          <div className="grid grid-cols-1 gap-2">
                            {task.matches.map((match, idx) => (
                              <div key={idx} className="bg-gray-50 rounded-md p-3">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-medium text-sm text-gray-900">{match.displayName}</span>
                                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                                    {(match.relevance * 100).toFixed(0)}%
                                  </span>
                                </div>
                                <p className="text-xs text-gray-600 mb-1">{match.category}</p>
                                <p className="text-xs text-gray-500">{match.reason}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* 操作按钮 */}
                      {(task.status === 'pending' || task.status === 'running') && (
                        <div className="mt-3">
                          <button
                            onClick={() => cancelTask(task.id)}
                            className="text-sm text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-1.5 rounded-md transition-colors"
                          >
                            取消任务
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                  );
                })()}
            </div>

            {/* 底部 */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
              <span className="text-sm text-gray-500">
                共 {viewingNodeId 
                  ? predictionTasks.filter(t => t.nodeId === viewingNodeId).length 
                  : predictionTasks.length} 个任务
              </span>
              <button
                onClick={() => setShowPredictionTasks(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorContent {...props} />
    </ReactFlowProvider>
  );
}
