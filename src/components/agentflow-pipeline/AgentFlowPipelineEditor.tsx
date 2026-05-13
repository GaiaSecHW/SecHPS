'use client';

import { useState, useCallback } from 'react';
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
import { Save, Undo, Redo, ZoomIn, ZoomOut, Maximize, Settings, Trash2, Play, Loader2 } from 'lucide-react';
import AgentFlowNode from '@/components/agentflow-editor/AgentFlowNode';
import NodePalette from '@/components/agentflow-editor/NodePalette';
import NodeConfigPanel from '@/components/agentflow-editor/NodeConfigPanel';
import type { AgentFlowNodeData, AgentFlowNode as AgentFlowNodeType } from '@/types/workflow';
import toast from 'react-hot-toast';

const nodeTypes = {
  agentFlowNode: AgentFlowNode,
};

interface AgentFlowPipelineEditorProps {
  pipelineId: string;
  initialNodes: Node[];
  initialEdges: Edge[];
  onSave: (nodes: Node[], edges: Edge[]) => Promise<any>;
}

function AgentFlowPipelineEditorContent({
  pipelineId,
  initialNodes,
  initialEdges,
  onSave,
}: AgentFlowPipelineEditorProps) {
  const { zoomIn, zoomOut, fitView, screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const saveToHistory = useCallback(() => {
    const currentState = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(currentState);
    if (newHistory.length > 50) {
      newHistory.shift();
    }
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [nodes, edges, history, historyIndex]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevState = history[historyIndex - 1];
      setNodes(prevState.nodes);
      setEdges(prevState.edges);
      setHistoryIndex(historyIndex - 1);
    }
  }, [history, historyIndex, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setNodes(nextState.nodes);
      setEdges(nextState.edges);
      setHistoryIndex(historyIndex + 1);
    }
  }, [history, historyIndex, setNodes, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdge: Edge = {
        ...connection,
        id: `edge-${Date.now()}`,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#3B82F6', strokeWidth: 2 },
      };
      setEdges((eds) => addEdge(newEdge, eds));
      saveToHistory();
    },
    [setEdges, saveToHistory]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      try {
        const nodeType = event.dataTransfer.getData('application/agentflow');
        if (!nodeType) return;

        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        const newNode: Node = {
          id: `node-${Date.now()}`,
          type: 'agentFlowNode',
          position,
          data: {
            nodeType,
            taskId: '',
          } as unknown as Record<string, unknown>,
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

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleDeleteNode = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
    saveToHistory();
  }, [selectedNode, setNodes, setEdges, saveToHistory]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSave(nodes, edges);
      toast.success('保存成功');
    } catch (error: any) {
      toast.error(error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleNodeUpdate = useCallback((nodeId: string, data: Partial<AgentFlowNodeData>) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)));
    setSelectedNode((prev) => prev ? { ...prev, data: { ...prev.data, ...data } } : null);
    saveToHistory();
  }, [setNodes, saveToHistory]);

  // Build typed nodes/edges for NodeConfigPanel
  const typedNodes = nodes.map((n) => ({
    id: n.id,
    type: 'agentFlowNode' as const,
    position: n.position,
    data: (n.data as unknown) as AgentFlowNodeData,
  })) as AgentFlowNodeType[];

  const typedEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: e.data as { isFailure: boolean } | undefined,
  }));

  const selectedTypedNode = selectedNode ? {
    id: selectedNode.id,
    type: 'agentFlowNode' as const,
    position: selectedNode.position,
    data: (selectedNode.data as unknown) as AgentFlowNodeData,
  } as AgentFlowNodeType : null;

  return (
    <div className="flex h-full">
      {/* 左侧节点面板 */}
      <div className="w-72 flex-shrink-0">
        <NodePalette onAddNode={(nodeType) => {
          const newNode: Node = {
            id: `node-${Date.now()}`,
            type: 'agentFlowNode',
            position: { x: 250, y: 250 },
            data: { nodeType, taskId: '' } as unknown as Record<string, unknown>,
          };
          setNodes((nds) => [...nds, newNode]);
        }} />
      </div>

      {/* 中间画布区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 工具栏 */}
        <div className="h-14 bg-dark-surface border-b border-gray-700/50 flex items-center justify-between px-4">
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <Save size={16} />
              <span>{saving ? '保存中...' : '保存'}</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="撤销"
            >
              <Undo size={18} />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="重做"
            >
              <Redo size={18} />
            </button>
            <button
              onClick={() => zoomIn()}
              className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded"
              title="放大"
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={() => zoomOut()}
              className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded"
              title="缩小"
            >
              <ZoomOut size={18} />
            </button>
            <button
              onClick={() => fitView()}
              className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded"
              title="适应视图"
            >
              <Maximize size={18} />
            </button>
          </div>
        </div>

        {/* React Flow 画布 */}
        <div className="flex-1 bg-[#0F172A] relative overflow-hidden" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
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
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            style={{ width: '100%', height: '100%' }}
          >
            <Background color="#aaa" gap={16} />
            <Controls showZoom={true} showFitView={true} showInteractive={true} />
            <MiniMap
              nodeColor={(node) => {
                const nodeData = node.data as unknown as AgentFlowNodeData;
                const colors: Record<string, string> = {
                  codex: '#3B82F6', claude: '#F97316', kimi: '#10B981',
                  opencode: '#EF4444', pi: '#8B5CF6', python_node: '#06B6D4',
                  shell: '#9CA3AF', sync: '#EAB308', custom: '#7C3AED',
                  fanout: '#06B6D4', merge: '#F59E0B', evolve: '#EC4899',
                };
                return colors[nodeData.nodeType] || '#6B7280';
              }}
              nodeStrokeWidth={3}
              zoomable={true}
              pannable={true}
              className="!bg-dark-surface !border-2 !border-gray-600 !rounded-lg !shadow-lg"
              style={{ width: 200, height: 150 }}
              maskColor="rgba(0, 0, 0, 0.1)"
            />
          </ReactFlow>

          <div className="absolute bottom-4 left-4 bg-dark-surface px-3 py-1.5 rounded-lg shadow-md text-xs text-gray-500 border border-gray-700/50 z-10">
            从左侧拖拽节点到画布，点击节点配置属性
          </div>
        </div>
      </div>

      {/* 右侧属性面板 */}
      {selectedTypedNode && (
        <div className="w-80 flex-shrink-0 bg-dark-surface border-l border border-gray-700/50 overflow-y-auto">
          <div className="p-4 border-b border-gray-700/50 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
              <Settings size={20} />
              节点配置
            </h3>
            <button
              onClick={handleDeleteNode}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 rounded-md"
            >
              <Trash2 size={16} />
              删除
            </button>
          </div>

          <div className="p-4">
            <NodeConfigPanel
              node={selectedTypedNode}
              allNodes={typedNodes}
              edges={typedEdges}
              onUpdate={handleNodeUpdate}
              availableModels={[]}
              availableSkills={[]}
              availableMcps={[]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgentFlowPipelineEditor(props: AgentFlowPipelineEditorProps) {
  return (
    <ReactFlowProvider>
      <AgentFlowPipelineEditorContent {...props} />
    </ReactFlowProvider>
  );
}