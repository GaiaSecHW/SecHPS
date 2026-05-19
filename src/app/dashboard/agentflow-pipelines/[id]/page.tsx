'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ReactFlow, ReactFlowProvider, Background, Controls, useNodesState, useEdgesState, addEdge, type Connection, type Edge, type Node, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng } from 'html-to-image';
import { ArrowLeft } from 'lucide-react';
import NodePalette from '@/components/agentflow-editor/NodePalette';
import NodeConfigPanel from '@/components/agentflow-editor/NodeConfigPanel';
import AgentFlowNodeComponent from '@/components/agentflow-editor/AgentFlowNode';
import type { AgentFlowNodeData, AgentFlowNode, AgentFlowEdge } from '@/types/workflow';

const nodeTypes = {
  agentFlowNode: AgentFlowNodeComponent,
};

function EditorContent() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string>('draft');
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; displayName: string }>>([]);
  const [availableSkills, setAvailableSkills] = useState<Array<{ name: string; displayName: string }>>([]);
  const [availableMcps, setAvailableMcps] = useState<Array<{ name: string }>>([]);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  useEffect(() => {
    const fetchPipeline = async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/agentflow-pipelines/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setName(data.pipeline.name);
        setStatus(data.pipeline.status);
        setNodes(data.pipeline.nodes || []);
        setEdges(data.pipeline.edges || []);
      }
    };

    const fetchResources = async () => {
      const token = localStorage.getItem('token');
      const [modelsRes, skillsRes, mcpsRes] = await Promise.all([
        fetch('/api/models', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/skills', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/mcp-servers', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (modelsRes.ok) {
        const data = await modelsRes.json();
        setAvailableModels((data.models || []).map((m: any) => ({ name: m.name, displayName: m.name })));
      }
      if (skillsRes.ok) {
        const data = await skillsRes.json();
        setAvailableSkills(data.data || []);
      }
      if (mcpsRes.ok) {
        const data = await mcpsRes.json();
        setAvailableMcps(data.servers || []);
      }
    };

    fetchPipeline();
    fetchResources();
  }, [id, setNodes, setEdges]);

  const generateThumbnail = async (): Promise<string | undefined> => {
    try {
      const container = document.querySelector('.react-flow') as HTMLElement;
      if (!container) return undefined;
      fitView({ padding: 0.1, duration: 0 });
      await new Promise(resolve => setTimeout(resolve, 300));
      const dataUrl = await toPng(container, {
        quality: 0.9,
        pixelRatio: 2,
        backgroundColor: '#0F172A',
        fontEmbedCSS: '',
        skipFonts: true,
      });
      return dataUrl.split(',')[1];
    } catch {
      return undefined;
    }
  };

  useEffect(() => {
    if (!isDirty) return;

    setSaveStatus('unsaved');

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      const token = localStorage.getItem('token');
      const thumbnail = await generateThumbnail();
      const res = await fetch(`/api/agentflow-pipelines/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, nodes, edges, thumbnail }),
      });

      if (res.ok) {
        setSaveStatus('saved');
        setIsDirty(false);
      } else {
        setSaveStatus('unsaved');
      }
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [isDirty, name, nodes, edges, id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedNodeId) {
        setNodes(nodes.filter(n => n.id !== selectedNodeId));
        setEdges(edges.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
        setSelectedNodeId(null);
        setIsDirty(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        setSaveStatus('saving');
        const saveImmediately = async () => {
          const token = localStorage.getItem('token');
          const thumbnail = await generateThumbnail();
          const res = await fetch(`/api/agentflow-pipelines/${id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name, nodes, edges, thumbnail }),
          });
          if (res.ok) {
            setSaveStatus('saved');
            setIsDirty(false);
          } else {
            setSaveStatus('unsaved');
          }
        };
        saveImmediately();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, nodes, edges, name, id, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    const edge: AgentFlowEdge = {
      id: `${connection.source}-${connection.target}`,
      source: connection.source!,
      target: connection.target!,
    };
    setEdges((eds) => addEdge(edge as Edge, eds) as typeof eds);
    setIsDirty(true);
  }, [setEdges]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData('application/agentflow');
    if (!nodeType) return;

    const position = screenToFlowPosition({
      x: e.clientX,
      y: e.clientY,
    });

    const newNode = {
      id: `${nodeType}_${Date.now().toString(36)}`,
      type: 'agentFlowNode' as const,
      position,
      data: {
        nodeType: nodeType as AgentFlowNodeData['nodeType'],
        taskId: `${nodeType}_${Date.now().toString(36).slice(-4)}`,
        prompt: '',
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNode.id);
    setIsDirty(true);
  }, [screenToFlowPosition, setNodes]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setContextMenu(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setContextMenu(null);
  }, []);

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      edgeId: edge.id,
    });
  }, []);

  const handleEdgeAction = (action: 'toggle-failure' | 'delete') => {
    if (!contextMenu) return;

    if (action === 'toggle-failure') {
      setEdges(eds => eds.map(e =>
        e.id === contextMenu.edgeId
          ? { ...e, data: { ...e.data, isFailure: !e.data?.isFailure } }
          : e
      ));
    } else if (action === 'delete') {
      setEdges(eds => eds.filter(e => e.id !== contextMenu.edgeId));
    }

    setIsDirty(true);
    setContextMenu(null);
  };

  const handlePublish = async () => {
    if (!window.confirm('确认发布此 Pipeline？')) return;

    const token = localStorage.getItem('token');
    const res = await fetch(`/api/agentflow-pipelines/${id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      setStatus('published');
      alert(`发布成功！\nAgent App: ${data.agentAppName}\nGitea URL: ${data.giteaUrl || '未配置'}`);
    } else {
      alert('发布失败');
    }
  };

  const handleSaveDraft = async () => {
    setSaveStatus('saving');
    const token = localStorage.getItem('token');
    const thumbnail = await generateThumbnail();
    const res = await fetch(`/api/agentflow-pipelines/${id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, nodes, edges, thumbnail }),
    });

    if (res.ok) {
      setSaveStatus('saved');
      setIsDirty(false);
    } else {
      setSaveStatus('unsaved');
    }
  };

  const handleNodeUpdate = (nodeId: string, newData: Partial<AgentFlowNodeData>) => {
    setNodes(nds => nds.map(n =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, ...newData } }
        : n
    ));
    setIsDirty(true);
  };

  const handleGoBack = () => {
    if (isDirty || saveStatus === 'unsaved') {
      if (!window.confirm('有未保存的修改，确认离开？')) {
        return;
      }
    }
    router.push('/dashboard/agentflow-pipelines');
  };

  const getEdgeStyle = (edge: Edge) => {
    const edgeData = edge.data as { isFailure?: boolean } | undefined;
    if (edgeData?.isFailure) {
      return { stroke: '#EF4444', strokeWidth: 2, strokeDasharray: '6 3' };
    }
    return { stroke: '#3B82F6', strokeWidth: 2 };
  };

  const styledEdges = edges.map(e => ({ ...e, style: getEdgeStyle(e as Edge) }));

  const saveStatusText = {
    saved: '已保存',
    saving: '保存中...',
    unsaved: '未保存',
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <button
            onClick={handleGoBack}
            className="flex items-center gap-1 px-2 py-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 rounded-md transition-colors"
          >
            <ArrowLeft size={18} />
            <span className="text-sm">返回</span>
          </button>
          <div className="h-5 w-px bg-gray-700" />
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setIsDirty(true); }}
            className="bg-transparent text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
            placeholder="Pipeline 名称"
          />
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-sm ${saveStatus === 'unsaved' ? 'text-yellow-500' : 'text-gray-400'}`}>
            {saveStatusText[saveStatus]}
          </span>
          <span className="text-sm text-gray-400">
            状态: {status === 'published' ? '已发布' : '草稿'}
          </span>
          <button
            onClick={handleSaveDraft}
            disabled={saveStatus === 'saving'}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            保存草稿
          </button>
          <button
            onClick={handlePublish}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
          >
            发布
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <NodePalette onAddNode={() => {}} />

        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={styledEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onEdgeContextMenu={onEdgeContextMenu}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={{ animated: false }}
            fitView
          >
            <Background color="#374151" gap={16} />
            <Controls />
          </ReactFlow>

          {contextMenu && (
            <div
              className="absolute bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => handleEdgeAction('toggle-failure')}
                className="block w-full px-4 py-2 text-left hover:bg-gray-700 text-sm"
              >
                {edges.find(e => e.id === contextMenu.edgeId)?.data?.isFailure
                  ? '切换为普通边'
                  : '切换为失败回退边'}
              </button>
              <button
                onClick={() => handleEdgeAction('delete')}
                className="block w-full px-4 py-2 text-left hover:bg-gray-700 text-sm text-red-400"
              >
                删除边
              </button>
            </div>
          )}
        </div>

        <NodeConfigPanel
          node={selectedNode ? { ...selectedNode, data: selectedNode.data as unknown as AgentFlowNodeData } as unknown as AgentFlowNode : null}
          allNodes={nodes.map(n => ({ ...n, data: n.data as unknown as AgentFlowNodeData })) as unknown as AgentFlowNode[]}
          edges={edges.map(e => ({ ...e, data: e.data as unknown as AgentFlowEdge['data'] })) as unknown as AgentFlowEdge[]}
          onUpdate={handleNodeUpdate}
          availableModels={availableModels}
          availableSkills={availableSkills}
          availableMcps={availableMcps}
        />
      </div>
    </div>
  );
}

export default function PipelineEditorPage() {
  return (
    <ReactFlowProvider>
      <EditorContent />
    </ReactFlowProvider>
  );
}
