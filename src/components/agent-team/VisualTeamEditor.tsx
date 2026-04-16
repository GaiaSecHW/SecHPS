'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
  MarkerType,
  Panel,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Save,
  Play,
  Users,
  Brain,
  Settings,
  X,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Crown,
  Zap,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Layers,
  Grid3X3,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { AgentNode, AgentNodeData, SidebarAgentItem } from './AgentNode';
import { RalphLoopConfigPanel } from './RalphLoopConfigPanel';
import type { RalphLoopConfig } from '@/types/ralph-loop-config';
import { DEFAULT_RALPH_LOOP_CONFIG } from '@/types/ralph-loop-config';

// ============ Types ============

interface AgentDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  model: string;
  allowedTools: string[];
  skills: string[];
  mcpServers: any[];
  isBuiltin: boolean;
  isActive: boolean;
}

interface TeamMemberConfig {
  id: string;
  agentId: string;
  agent?: AgentDefinition;
  role: 'lead' | 'teammate';
  overrideModel: string | null;
  overrideTools: string[] | null;
  dependsOn: string[];
}

interface VisualTeamEditorProps {
  teamId?: string | null;
  initialData?: {
    name: string;
    description: string;
    leadAgentId: string;
    taskStrategy: string;
    maxTeammates: number;
    members: TeamMemberConfig[];
    ralphConfig?: RalphLoopConfig;
  };
  onSave: (data: {
    name: string;
    description: string;
    leadAgentId: string;
    taskStrategy: string;
    maxTeammates: number;
    members: TeamMemberConfig[];
    dependencies: { from: string; to: string }[];
    ralphConfig: RalphLoopConfig | null;
  }) => Promise<void>;
  onExecute?: () => Promise<void>;
  canExecute?: boolean;
  canSave?: boolean;
}

// ============ Helper Functions ============

function generateNodeId(): string {
  return `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function hasCircularDependency(edges: Edge[]): boolean {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (!graph.has(edge.source)) graph.set(edge.source, []);
    graph.get(edge.source)!.push(edge.target);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);
    for (const neighbor of graph.get(node) || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }
    recursionStack.delete(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (!visited.has(node) && dfs(node)) return true;
  }
  return false;
}

// ============ Node Types ============

const nodeTypes: NodeTypes = {
  agentNode: AgentNode,
};

// ============ Main Component ============

function VisualTeamEditorInner({
  teamId,
  initialData,
  onSave,
  onExecute,
  canExecute = false,
  canSave = true,
}: VisualTeamEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Agent definitions
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);

  // Team configuration
  const [teamName, setTeamName] = useState(initialData?.name || '');
  const [teamDescription, setTeamDescription] = useState(initialData?.description || '');
  const [taskStrategy, setTaskStrategy] = useState(initialData?.taskStrategy || 'parallel');
  const [maxTeammates, setMaxTeammates] = useState(initialData?.maxTeammates || 5);
  const [ralphConfig, setRalphConfig] = useState<RalphLoopConfig>(
    initialData?.ralphConfig || DEFAULT_RALPH_LOOP_CONFIG
  );

  // Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // UI state
  const [selectedNode, setSelectedNode] = useState<Node<AgentNodeData> | null>(null);
  const [saving, setSaving] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);

  // Circular dependency check
  const hasCircular = useMemo(() => hasCircularDependency(edges), [edges]);

  // Fetch agents
  useEffect(() => {
    fetchAgents();
  }, []);

  // Initialize nodes from initial data
  useEffect(() => {
    if (initialData?.members && initialData.members.length > 0 && agents.length > 0) {
      const initialNodes: Node<AgentNodeData>[] = initialData.members.map((member, index) => {
        const agent = agents.find(a => a.id === member.agentId);
        return {
          id: member.id,
          type: 'agentNode',
          position: { x: 100 + index * 250, y: member.role === 'lead' ? 50 : 200 },
          data: {
            id: member.id,
            agentId: member.agentId,
            name: agent?.name || '',
            displayName: agent?.displayName || agent?.name || '',
            model: agent?.model || '',
            category: agent?.category || '',
            isLead: member.role === 'lead',
            status: 'idle',
            overrideModel: member.overrideModel,
            onConfigure: (id: string) => {
              const node = nodes.find(n => n.id === id);
              if (node) {
                setSelectedNode(node);
                setConfigPanelOpen(true);
              }
            },
          },
        };
      });

      // Create edges from dependencies
      const initialEdges: Edge[] = [];
      initialData.members.forEach(member => {
        member.dependsOn.forEach(depId => {
          initialEdges.push({
            id: `edge-${member.id}-${depId}`,
            source: member.id,
            target: depId,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        });
      });

      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [initialData, agents]);

  const fetchAgents = async () => {
    try {
      setLoadingAgents(true);
      const token = localStorage.getItem('token');

      const response = await fetch('/api/agent-definitions', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取 Agent 定义失败');
      }

      const data = await response.json();
      setAgents(data.agentDefinitions || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '获取 Agent 定义失败');
    } finally {
      setLoadingAgents(false);
    }
  };

  // Handle connection
  const onConnect = useCallback(
    (params: Connection) => {
      // Prevent self-connection
      if (params.source === params.target) {
        toast.error('不能连接到自己');
        return;
      }

      // Check if connection already exists
      const exists = edges.some(
        (e) => e.source === params.source && e.target === params.target
      );
      if (exists) {
        toast.error('连接已存在');
        return;
      }

      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: '#3b82f6', strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [edges, setEdges]
  );

  // Handle drag over
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Handle drop
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const data = event.dataTransfer.getData('application/json');
      if (!data) return;

      const agent: AgentDefinition = JSON.parse(data);

      // Check if agent is already in the team
      const exists = nodes.some((n) => n.data.agentId === agent.id);
      if (exists) {
        toast.error('Agent 已在团队中');
        return;
      }

      // Check max teammates limit
      const teammateCount = nodes.filter((n) => !n.data.isLead).length;
      const leadCount = nodes.filter((n) => n.data.isLead).length;

      // If this is the first node, make it lead
      const isLead = nodes.length === 0;

      if (!isLead && teammateCount >= maxTeammates) {
        toast.error(`团队成员数量已达上限 (${maxTeammates})`);
        return;
      }

      // Get drop position
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const nodeId = generateNodeId();

      const newNode: Node<AgentNodeData> = {
        id: nodeId,
        type: 'agentNode',
        position,
        data: {
          id: nodeId,
          agentId: agent.id,
          name: agent.name,
          displayName: agent.displayName || agent.name,
          model: agent.model,
          category: agent.category,
          isLead,
          status: 'idle',
          overrideModel: null,
          onConfigure: (id: string) => {
            const node = nodes.find(n => n.id === id) || newNode;
            setSelectedNode(node);
            setConfigPanelOpen(true);
          },
        },
      };

      setNodes((nds) => [...nds, newNode]);
      toast.success(`添加 ${agent.displayName || agent.name} 到团队`);
    },
    [nodes, maxTeammates, screenToFlowPosition, setNodes]
  );

  // Handle node click
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<AgentNodeData>) => {
      setSelectedNode(node);
      setConfigPanelOpen(true);
    },
    []
  );

  // Handle node delete
  const onNodeDelete = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId)
      );
      if (selectedNode?.id === nodeId) {
        setSelectedNode(null);
        setConfigPanelOpen(false);
      }
    },
    [setNodes, setEdges, selectedNode]
  );

  // Update node configuration
  const updateNodeConfig = useCallback(
    (nodeId: string, updates: Partial<AgentNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, ...updates } }
            : n
        )
      );
    },
    [setNodes]
  );

  // Set lead agent
  const setLeadAgent = useCallback(
    (nodeId: string) => {
      // Remove lead from all nodes
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: { ...n.data, isLead: n.id === nodeId },
          position: n.id === nodeId ? { x: n.position.x, y: 50 } : { x: n.position.x, y: 200 },
        }))
      );
      toast.success('已设置 Lead Agent');
    },
    [setNodes]
  );

  // Save team
  const handleSave = async () => {
    if (!teamName.trim()) {
      toast.error('请输入团队名称');
      return;
    }

    if (teamName.trim().length < 2) {
      toast.error('团队名称至少需要2个字符');
      return;
    }

    const leadNode = nodes.find((n) => n.data.isLead);
    if (!leadNode) {
      toast.error('请设置 Lead Agent');
      return;
    }

    if (hasCircular) {
      toast.error('检测到循环依赖，请检查连接');
      return;
    }

    try {
      setSaving(true);

      // Build members data
      const members: TeamMemberConfig[] = nodes.map((n) => ({
        id: n.id,
        agentId: n.data.agentId,
        role: n.data.isLead ? 'lead' : 'teammate',
        overrideModel: n.data.overrideModel ?? null,
        overrideTools: null,
        dependsOn: edges
          .filter((e) => e.source === n.id)
          .map((e) => e.target),
      }));

      // Build dependencies
      const dependencies = edges.map((e) => ({
        from: e.source,
        to: e.target,
      }));

      await onSave({
        name: teamName.trim(),
        description: teamDescription.trim() || '',
        leadAgentId: leadNode.data.agentId,
        taskStrategy,
        maxTeammates,
        members,
        dependencies,
        ralphConfig: ralphConfig.enabled ? ralphConfig : null,
      });

      toast.success('团队保存成功');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // Available models for override
  const availableModels = useMemo(
    () => Array.from(new Set(agents.map((a) => a.model))).sort(),
    [agents]
  );

  // Group agents by category
  const agentsByCategory = useMemo(() => {
    const grouped: Record<string, AgentDefinition[]> = {};
    agents.forEach((agent) => {
      if (!grouped[agent.category]) grouped[agent.category] = [];
      grouped[agent.category].push(agent);
    });
    return grouped;
  }, [agents]);

  return (
    <div className="h-full flex flex-col bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-blue-600" />
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="团队名称"
              className="text-lg font-semibold text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 w-[200px]"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>策略:</span>
            <select
              value={taskStrategy}
              onChange={(e) => setTaskStrategy(e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value="parallel">并行执行</option>
              <option value="sequential">顺序执行</option>
              <option value="hierarchical">层级执行</option>
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>最大成员:</span>
            <input
              type="number"
              value={maxTeammates}
              onChange={(e) => setMaxTeammates(parseInt(e.target.value) || 5)}
              min={1}
              max={10}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasCircular && (
            <div className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-sm">
              <AlertTriangle size={14} />
              <span>循环依赖</span>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            <span>{saving ? '保存中...' : '保存'}</span>
          </button>

          {teamId && canExecute && (
            <button
              onClick={onExecute}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Play size={16} />
              <span>执行</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div
          className={`${sidebarCollapsed ? 'w-12' : 'w-64'} bg-white border-r border-gray-200 flex flex-col transition-all duration-300 flex-shrink-0`}
        >
          {/* Sidebar Header */}
          <div className="p-3 border-b border-gray-200 flex items-center justify-between">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2">
                <Brain size={18} className="text-blue-600" />
                <span className="font-medium text-gray-900">Agent 库</span>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1 rounded hover:bg-gray-100"
            >
              {sidebarCollapsed ? (
                <ChevronRight size={16} className="text-gray-500" />
              ) : (
                <ChevronDown size={16} className="text-gray-500" />
              )}
            </button>
          </div>

          {/* Agent List */}
          {!sidebarCollapsed && (
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {loadingAgents ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-blue-500" />
                </div>
              ) : (
                Object.entries(agentsByCategory).map(([category, categoryAgents]) => (
                  <div key={category}>
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                      {category}
                    </h4>
                    <div className="space-y-2">
                      {categoryAgents.map((agent) => (
                        <SidebarAgentItem
                          key={agent.id}
                          agent={agent}
                          onDragStart={() => {}}
                          isLead={nodes.length === 0}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Instructions */}
          {!sidebarCollapsed && (
            <div className="p-3 border-t border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500">
                拖拽 Agent 到画布添加团队成员。连接节点表示依赖关系。
              </p>
            </div>
          )}
        </div>

        {/* Flow Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            defaultEdgeOptions={{
              type: 'smoothstep',
              animated: true,
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { stroke: '#3b82f6', strokeWidth: 2 },
            }}
            connectionLineStyle={{ stroke: '#3b82f6', strokeWidth: 2 }}
            snapToGrid
            snapGrid={[15, 15]}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
            <Controls className="!bg-white !border-gray-200 !shadow-md" />
            <MiniMap
              className="!bg-white !border-gray-200 !shadow-md"
              nodeColor={(node) => node.data?.isLead ? '#f59e0b' : '#3b82f6'}
              maskColor="rgba(0, 0, 0, 0.1)"
            />

            {/* Canvas Info Panel */}
            <Panel position="top-left" className="!m-2">
              <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 px-3 py-2 flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <Crown size={14} className="text-amber-500" />
                  <span className="text-xs text-gray-600">
                    Lead: {nodes.filter((n) => n.data.isLead).length}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Users size={14} className="text-blue-500" />
                  <span className="text-xs text-gray-600">
                    成员: {nodes.filter((n) => !n.data.isLead).length}/{maxTeammates}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Layers size={14} className="text-gray-500" />
                  <span className="text-xs text-gray-600">
                    连接: {edges.length}
                  </span>
                </div>
              </div>
            </Panel>
          </ReactFlow>

          {/* Empty State */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center bg-white/80 backdrop-blur-sm rounded-xl p-8 shadow-lg border border-gray-200">
                <Brain size={48} className="mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  开始构建您的 Agent 团队
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  从左侧拖拽 Agent 到画布，或点击 Agent 添加
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                  <Grid3X3 size={14} />
                  <span>拖拽添加 · 连接建立依赖 · 点击配置</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Configuration Panel */}
        {configPanelOpen && selectedNode && (
          <div className="w-72 bg-white border-l border-gray-200 flex flex-col flex-shrink-0">
            {/* Panel Header */}
            <div className="p-3 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings size={18} className="text-gray-600" />
                <span className="font-medium text-gray-900">配置</span>
              </div>
              <button
                onClick={() => setConfigPanelOpen(false)}
                className="p-1 rounded hover:bg-gray-100"
              >
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Agent Info */}
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  {selectedNode.data.isLead && (
                    <Crown size={14} className="text-amber-500" />
                  )}
                  <span className="font-medium text-gray-900">
                    {selectedNode.data.displayName}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{selectedNode.data.category}</p>
                <div className="mt-2 flex items-center gap-1">
                  <Zap size={12} className="text-blue-500" />
                  <span className="text-xs text-gray-600">
                    {selectedNode.data.overrideModel || selectedNode.data.model}
                  </span>
                </div>
              </div>

              {/* Role Toggle */}
              {!selectedNode.data.isLead && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    角色
                  </label>
                  <button
                    onClick={() => setLeadAgent(selectedNode.id)}
                    className="w-full px-3 py-2 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 text-sm font-medium transition-colors"
                  >
                    <Crown size={14} className="inline mr-2" />
                    设为 Lead Agent
                  </button>
                </div>
              )}

              {/* Model Override */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  模型覆盖
                </label>
                <select
                  value={selectedNode.data.overrideModel || ''}
                  onChange={(e) =>
                    updateNodeConfig(selectedNode.id, {
                      overrideModel: e.target.value || null,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">使用默认模型</option>
                  {availableModels.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              </div>

              {/* Dependencies */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  依赖关系
                </label>
                <div className="text-xs text-gray-500 mb-2">
                  当前依赖: {edges.filter((e) => e.source === selectedNode.id).length} 个
                </div>
                <div className="space-y-1">
                  {nodes
                    .filter((n) => n.id !== selectedNode.id)
                    .map((n) => {
                      const hasDep = edges.some(
                        (e) => e.source === selectedNode.id && e.target === n.id
                      );
                      return (
                        <button
                          key={n.id}
                          onClick={() => {
                            if (hasDep) {
                              setEdges((eds) =>
                                eds.filter(
                                  (e) =>
                                    !(e.source === selectedNode.id && e.target === n.id)
                                )
                              );
                            } else {
                              const edgeId = `edge-${selectedNode.id}-${n.id}`;
                              setEdges((eds) =>
                                addEdge(
                                  {
                                    id: edgeId,
                                    source: selectedNode.id,
                                    target: n.id,
                                    type: 'smoothstep',
                                    animated: true,
                                    markerEnd: { type: MarkerType.ArrowClosed },
                                  },
                                  eds
                                )
                              );
                            }
                          }}
                          className={`w-full px-3 py-1.5 rounded text-xs text-left transition-colors ${
                            hasDep
                              ? 'bg-blue-100 text-blue-700 border border-blue-200'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {n.data.displayName}
                          {n.data.isLead && (
                            <Crown size={10} className="inline ml-1 text-amber-500" />
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Delete Button */}
              <div className="pt-4 border-t border-gray-200">
                <button
                  onClick={() => onNodeDelete(selectedNode.id)}
                  className="w-full px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm font-medium transition-colors"
                >
                  <X size={14} className="inline mr-2" />
                  移除 Agent
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Ralph Loop Config - Collapsible */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200">
        <button
          onClick={() => setRalphConfig({ ...ralphConfig, enabled: !ralphConfig.enabled })}
          className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <RefreshCw
              size={16}
              className={ralphConfig.enabled ? 'text-blue-500' : 'text-gray-400'}
            />
            <span className="text-sm font-medium text-gray-700">
              Ralph Loop 配置
            </span>
          </div>
          {ralphConfig.enabled ? (
            <ChevronUp size={16} className="text-gray-400" />
          ) : (
            <ChevronDown size={16} className="text-gray-400" />
          )}
        </button>
        {ralphConfig.enabled && (
          <div className="px-4 pb-4">
            <RalphLoopConfigPanel
              config={ralphConfig}
              onChange={setRalphConfig}
              disabled={saving}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Wrap with ReactFlowProvider
export function VisualTeamEditor(props: VisualTeamEditorProps) {
  return (
    <ReactFlowProvider>
      <VisualTeamEditorInner {...props} />
    </ReactFlowProvider>
  );
}

export default VisualTeamEditor;