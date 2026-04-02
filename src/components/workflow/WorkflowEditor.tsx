'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
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
import '@xyflow/react/dist/style.css';
import { Save, Undo, Redo, ZoomIn, ZoomOut, Maximize, Settings, Trash2, Eye, X, Power, PowerOff } from 'lucide-react';
import NodePalette from './NodePalette';
import { nodeTypes } from './CustomNodes';
import { FlowNode, FlowEdge, NodeData, NodeTypeDefinition, WorkflowData, NODE_TYPE_MAP } from '@/types/workflow';

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
  const { zoomIn, zoomOut, fitView, screenToFlowPosition } = useReactFlow();
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
      // 1. 开始节点只能连接到任务节点（左侧输入）
      if (sourceType === 'start' && targetType !== 'task') {
        alert('开始节点只能连接到任务节点');
        return;
      }
      
      // 2. 结束节点只能被任务节点连接（右侧输出）
      if (targetType === 'end' && sourceType !== 'task') {
        alert('只有任务节点可以连接到结束节点');
        return;
      }
      
      // 3. 任务节点连接规则
      if (sourceType === 'task') {
        // 从右侧输出连接到任务节点（左侧输入）或结束节点
        if (sourceHandle === 'out' || !sourceHandle) {
          if (targetType !== 'task' && targetType !== 'end') {
            alert('任务节点的右侧输出只能连接到任务节点或结束节点');
            return;
          }
          // 目标节点应该通过左侧输入句柄连接
          if (targetHandle && targetHandle !== 'in') {
            alert('请连接到任务节点的左侧输入');
            return;
          }
        }
        // 从底部子任务输出连接到子任务节点（顶部输入）
        else if (sourceHandle === 'subtask') {
          if (targetType !== 'subtask') {
            alert('任务节点的底部输出只能连接到子任务节点');
            return;
          }
          // 目标节点应该通过顶部输入句柄连接
          if (targetHandle && targetHandle !== 'in') {
            alert('请连接到子任务节点的顶部输入');
            return;
          }
        }
      }
      
      // 4. 子任务节点可以连接到子任务节点（上下连接）
      if (sourceType === 'subtask' && targetType !== 'subtask') {
        alert('子任务节点只能连接到子任务节点');
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
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        const newNode: FlowNode = {
          id: `node-${Date.now()}`,
          type: nodeData.type,
          position,
          data: {
            label: nodeData.label,
            description: nodeData.description,
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

  // 处理删除键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.shiftKey) {
        if (selectedNode) {
          e.preventDefault();
          handleDeleteNode();
        } else if (selectedEdge) {
          e.preventDefault();
          handleDeleteEdge();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNode, selectedEdge, handleDeleteNode, handleDeleteEdge]);

  // 保存工作流
  const handleSave = async () => {
    if (!onSave) return;

    try {
      setSaving(true);
      const data: WorkflowData = {
        nodes,
        edges,
        viewport: undefined,
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
      const nodeType = NODE_TYPE_MAP[node.type as any];
      
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
      const nodeType = NODE_TYPE_MAP[type as any];
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
            nodes={nodes}
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
            defaultViewport={{ x: 0, y: 0, zoom: 0.33 }}
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    节点名称
                  </label>
                  <input
                    type="text"
                    value={selectedNode.data.label}
                    onChange={(e) => {
                      const updatedNodes = nodes.map((n) =>
                        n.id === selectedNode.id
                          ? { ...n, data: { ...n.data, label: e.target.value } }
                          : n
                      );
                      setNodes(updatedNodes);
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
                      const updatedNodes = nodes.map((n) =>
                        n.id === selectedNode.id
                          ? { ...n, data: { ...n.data, description: e.target.value } }
                          : n
                      );
                      setNodes(updatedNodes);
                    }}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

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
