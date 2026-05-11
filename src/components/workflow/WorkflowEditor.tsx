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
import { Save, Undo, Redo, ZoomIn, ZoomOut, Maximize, Settings, Trash2, Eye, X, Power, PowerOff, Sparkles, Loader2, Edit2, Check, ChevronDown, ChevronRight, Users, Plus, Palette } from 'lucide-react';
import NodePalette from './NodePalette';
import { nodeTypes } from './CustomNodes';
import { FlowNode, FlowEdge, NodeData, NodeTypeDefinition, WorkflowData, NODE_TYPE_MAP, WorkflowNodeType } from '@/types/workflow';
import { useTechStackOptions, useTechStackOptionsWithIds } from '@/hooks/useTechStackOptions';
import { useVulnerabilityPatterns } from '@/hooks/useVulnerabilityPatterns';
import toast from 'react-hot-toast';

// FSM 阶段标签
const FSM_PHASE_LABELS: Record<string, string> = {
  'P1': '项目理解',
  'P2': 'DFD分析',
  'P3': '信任边界',
  'P4': '安全评估',
  'P5': 'STRIDE',
  'P6': '报告生成',
};

// 生成 FSM 工作流缩略图（SVG）
function generateFSMThumbnail(nodes: FlowNode[]): string {
  // P1-P6 固定阶段节点（完整名称）
  const phaseNodes: { phase: string; label: string }[] = [
    { phase: 'P1', label: '项目理解' },
    { phase: 'P2', label: 'DFD分析' },
    { phase: 'P3', label: '信任边界' },
    { phase: 'P4', label: '安全评审' },
    { phase: 'P5', label: 'STRIDE' },
    { phase: 'P6', label: '报告生成' },
  ];
  
  // 提取用户添加的自定义节点（非阶段节点）
  const customNodes: { label: string }[] = [];
  nodes.forEach(node => {
    if (!node.data?.phase && node.type === 'task') {
      customNodes.push({
        label: node.data?.label || 'Agent',
      });
    }
  });
  
  // 节点尺寸（框小，文字小）
  const nodeWidth = 44;
  const nodeHeight = 14;
  const padding = 10;
  const spacing = 3;
  
  // 布局：P1-P5 一行，自定义节点 + P6 第二行
  const row1Nodes = phaseNodes.filter(n => n.phase !== 'P6');
  const row2Nodes = [...customNodes.map(n => ({ label: n.label })), { phase: 'P6', label: '报告生成' }];
  
  const row1Width = row1Nodes.length * (nodeWidth + spacing) - spacing;
  const row2Width = row2Nodes.length * (nodeWidth + spacing) - spacing;
  const maxRowWidth = Math.max(row1Width, row2Width, 180);
  
  const svgWidth = maxRowWidth + padding * 2;
  const svgHeight = 64;  // 画布大一点
  
  // 生成节点 SVG
  const row1Y = 10;
  const row2Y = 38;
  
  let row1X = (svgWidth - row1Width) / 2;
  let row2X = (svgWidth - row2Width) / 2;
  
  let nodesSvg = '';
  let arrowsSvg = '';
  
  // 第一行节点 (P1-P5)
  let prevX = 0;
  row1Nodes.forEach((node, i) => {
    const x = row1X + i * (nodeWidth + spacing);
    nodesSvg += `<rect x="${x}" y="${row1Y}" width="${nodeWidth}" height="${nodeHeight}" rx="2" fill="#3b82f6"/>`;
    nodesSvg += `<text x="${x + nodeWidth/2}" y="${row1Y + 10}" text-anchor="middle" font-family="sans-serif" font-size="4" fill="white">${node.phase}-${node.label}</text>`;
    if (i > 0) {
      arrowsSvg += `<line x1="${prevX + nodeWidth}" y1="${row1Y + nodeHeight/2}" x2="${x}" y2="${row1Y + nodeHeight/2}" stroke="#cbd5e1" stroke-width="0.5"/>`;
    }
    prevX = x;
  });
  
  // 连接线从第一行到第二行
  if (row1Nodes.length > 0 && row2Nodes.length > 0) {
    const lastRow1X = row1X + (row1Nodes.length - 1) * (nodeWidth + spacing);
    arrowsSvg += `<path d="M${lastRow1X + nodeWidth/2} ${row1Y + nodeHeight} L${lastRow1X + nodeWidth/2} ${row1Y + nodeHeight + 6} L${row2X + nodeWidth/2} ${row1Y + nodeHeight + 6} L${row2X + nodeWidth/2} ${row2Y}" stroke="#cbd5e1" stroke-width="0.5" fill="none"/>`;
  }
  
  // 第二行节点 (自定义 + P6)
  prevX = 0;
  row2Nodes.forEach((node, i) => {
    const x = row2X + i * (nodeWidth + spacing);
    const isP6 = 'phase' in node && node.phase === 'P6';
    const fillColor = isP6 ? '#8b5cf6' : '#f59e0b';
    const text = isP6 ? `${node.phase}-${node.label}` : node.label;
    
    nodesSvg += `<rect x="${x}" y="${row2Y}" width="${nodeWidth}" height="${nodeHeight}" rx="2" fill="${fillColor}"/>`;
    nodesSvg += `<text x="${x + nodeWidth/2}" y="${row2Y + 10}" text-anchor="middle" font-family="sans-serif" font-size="4" fill="white">${text}</text>`;
    if (i > 0) {
      arrowsSvg += `<line x1="${prevX + nodeWidth}" y1="${row2Y + nodeHeight/2}" x2="${x}" y2="${row2Y + nodeHeight/2}" stroke="#cbd5e1" stroke-width="0.5"/>`;
    }
    prevX = x;
  });
  
  // 完整 SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}">
    <rect width="${svgWidth}" height="${svgHeight}" fill="#f1f5f9"/>
    ${arrowsSvg}
    ${nodesSvg}
  </svg>`;
  
  // 使用浏览器端的 base64 编码
  return btoa(unescape(encodeURIComponent(svg)));
}

interface WorkflowEditorProps {
  workflowId?: string;
  initialData?: WorkflowData;
  workflowTechStack?: string | string[];  // 工作流级别的技术栈（JSON 数组字符串或已解析数组）
  onSave?: (data: WorkflowData) => Promise<void>;
  onExecute?: () => Promise<void>;
  readOnly?: boolean;
  isEnabled?: boolean;
  onToggleEnabled?: () => void;
  hideTriggers?: boolean;  // 隐藏触发器节点（用于 FSM 渗透测试区）
  onRolesChange?: () => void;  // 角色列表变化时的回调
  isFSM?: boolean;  // 是否是 FSM 工作流（使用固定缩略图）
}

function WorkflowEditorContent({
  workflowId,
  initialData,
  workflowTechStack,
  onSave,
  onExecute,
  readOnly = false,
  isEnabled = true,
  onToggleEnabled,
  hideTriggers = false,
  onRolesChange,
  isFSM = false,
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
  
  // 使用 Hook 获取技术栈选项（带 ID，用于匹配）
  const { options: techStackOptionsWithIds, loading: loadingTechStack } = useTechStackOptionsWithIds();
  // 获取漏洞分类列表（用于 vulnerability 模式多选）
  const { categories: vulnCategories } = useVulnerabilityPatterns();

  /**
   * 匹配 Skills 的逻辑：
   * 1. 必须是 isActive=true（API 已筛选）
   * 2. 漏洞类型必须匹配（如果节点设置了漏洞类型）
   * 3. 技术栈匹配规则：
   *    - 工作流有技术栈：Skill 技术栈匹配 OR Skill 没有技术栈
   *    - 工作流没技术栈：所有 Skills 都能匹配
   */
  const filterMatchedSkills = (skills: typeof availableSkills, categoryIds: string[]) => {
    // 解析工作流技术栈为 ID 数组
    let workflowTechStackIds: string[] = [];
    if (workflowTechStack) {
      let rawItems: unknown[];
      if (Array.isArray(workflowTechStack)) {
        rawItems = workflowTechStack;
      } else {
        try {
          const parsed = JSON.parse(workflowTechStack as string);
          rawItems = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          rawItems = [workflowTechStack];
        }
      }
      workflowTechStackIds = rawItems.map(String).filter(Boolean);
    }

    return skills.filter(skill => {
      // 1. 漏洞分类匹配（多选）
      if (categoryIds.length > 0 && !categoryIds.includes(skill.vulnerabilityPatternCategory || '')) {
        return false;
      }

      // 2. 技术栈匹配（编排和 skill 都存 ID，直接比较）
      if (workflowTechStackIds.length > 0) {
        if (skill.techStackId && !workflowTechStackIds.includes(skill.techStackId)) {
          return false;
        }
        // skill 无技术栈 = 通用，不过滤
      }

      return true;
    });
  };
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
  
  // 预测按钮禁用状态（防止重复点击）
  const [predictionDisabled, setPredictionDisabled] = useState(false);
  const [predictionCountdown, setPredictionCountdown] = useState(0);
  
  // 展开的预测任务 ID 集合
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  
  // 角色管理相关状态
  const [roles, setRoles] = useState<any[]>([]);
  const [showRolePanel, setShowRolePanel] = useState(false);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#3B82F6');
  
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

  // Skill 加载模式相关状态
  type SkillLoadingMode = 'description' | 'manual' | 'vulnerability';
  const [availableSkills, setAvailableSkills] = useState<Array<{
    id: string;
    name: string;
    displayName: string;
    vulnerabilityPatternCategory: string | null;
    vulnerabilityPatternId: string | null;
    techStackId: string | null;
  }>>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [skillCategories, setSkillCategories] = useState<Array<{ value: string; label: string; count: number }>>([]);
  const [loadingSkillCategories, setLoadingSkillCategories] = useState(false);

  // Skills 分组展示相关状态
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillCategoryFilter, setSkillCategoryFilter] = useState('');

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

  // 获取角色列表
  const fetchRoles = async () => {
    if (!workflowId) return;
    try {
      setLoadingRoles(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/workflows/${workflowId}/roles`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setRoles(data.roles || []);
      }
    } catch (err) {
      console.error('获取角色失败:', err);
    } finally {
      setLoadingRoles(false);
    }
  };

  // workflowId 变化时刷新角色列表
  useEffect(() => {
    if (workflowId) {
      fetchRoles();
    }
  }, [workflowId]);

  // 获取 Skills 列表
  const fetchAvailableSkills = async () => {
    try {
      setLoadingSkills(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills?isActive=true&scope=all&limit=500', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const skillsList = data.data || data.skills || [];
        setAvailableSkills(skillsList);
      }
    } catch (err) {
      console.error('获取 Skills 列表失败:', err);
    } finally {
      setLoadingSkills(false);
    }
  };

  // 获取 Skill 分类列表
  const fetchSkillCategories = async () => {
    try {
      setLoadingSkillCategories(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/categories', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setSkillCategories(data.categories?.map((c: any) => ({ value: c.name, label: c.label, count: c.count || 0 })) || []);
      }
    } catch (err) {
      console.error('获取 Skill 分类列表失败:', err);
    } finally {
      setLoadingSkillCategories(false);
    }
  };

// 初始化加载 Skills 和分类
  useEffect(() => {
    fetchAvailableSkills();
    fetchSkillCategories();
  }, []);

  // 按工作流技术栈过滤后的 Skills（不过滤漏洞分类，用于手工模式展示）
  const techStackFilteredSkills = useMemo(
    () => filterMatchedSkills(availableSkills, []),
    [availableSkills, workflowTechStack]
  );

  // 按 vulnerabilityPatternCategory 分组 Skills（已按技术栈过滤）
  const groupedSkills = useMemo(() => {
    const base = techStackFilteredSkills;
    // 先按类别过滤
    const categoryFiltered = skillCategoryFilter
      ? base.filter(skill => (skill.vulnerabilityPatternCategory || '') === skillCategoryFilter)
      : base;
    // 再根据搜索词过滤
    const filtered = skillSearchQuery.trim()
      ? categoryFiltered.filter(skill =>
          skill.displayName.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
          skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
          (skill.vulnerabilityPatternCategory || '').toLowerCase().includes(skillSearchQuery.toLowerCase())
        )
      : categoryFiltered;

    // 按 vulnerabilityPatternCategory 分组
    const groups: Record<string, typeof availableSkills> = {};
    for (const skill of filtered) {
      const category = skill.vulnerabilityPatternCategory || 'uncategorized';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(skill);
    }

    // 按 category 名称排序
    const sortedCategories = Object.keys(groups).sort();
    return sortedCategories.map(category => ({
      category,
      skills: groups[category],
      count: groups[category].length,
    }));
  }, [techStackFilteredSkills, skillSearchQuery, skillCategoryFilter]);

  // 按技术栈过滤后的各类别实际数量（用于下拉框括号里的数字）
  const filteredCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const skill of techStackFilteredSkills) {
      const cat = skill.vulnerabilityPatternCategory || '';
      if (cat) counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [techStackFilteredSkills]);

  // 切换分组展开状态
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // 全选/取消全选某个类别的 Skills
  const toggleCategorySkills = (category: string, skills: typeof availableSkills, selectAll: boolean) => {
    if (!selectedNode) return;
    const currentSkills: string[] = selectedNode.data.skills
      ? JSON.parse(selectedNode.data.skills)
      : [];
    const categorySkillIds = skills.map(s => s.id);

    let newSkills: string[];
    if (selectAll) {
      // 添加该类别所有未选中的 Skills
      newSkills = [...new Set([...currentSkills, ...categorySkillIds])];
    } else {
      // 移除该类别所有已选中的 Skills
      newSkills = currentSkills.filter(id => !categorySkillIds.includes(id));
    }

    const updatedNode = {
      ...selectedNode,
      data: {
        ...selectedNode.data,
        skills: newSkills.length > 0 ? JSON.stringify(newSkills) : undefined,
      }
    };
    setNodes((nds) =>
      nds.map((n) => n.id === selectedNode.id ? updatedNode : n)
    );
    setSelectedNode(updatedNode);
  };

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
          setPredictionTasks(prev => {
            const existingIndex = prev.findIndex(t => t.id === task.id);
            if (existingIndex >= 0) {
              // 任务已存在，更新它
              return prev.map(t => t.id === task.id ? task : t);
            } else {
              // 任务不存在，添加它
              return [task, ...prev];
            }
          });
          
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
  
  // 预测按钮倒计时
  useEffect(() => {
    if (predictionCountdown <= 0) return;
    
    const timer = setInterval(() => {
      setPredictionCountdown(prev => {
        if (prev <= 1) {
          setPredictionDisabled(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [predictionCountdown]);
  
  // 初始加载预测任务
  useEffect(() => {
    if (workflowId) {
      fetchPredictionTasks();
    }
  }, [workflowId]);

  // 为节点添加 workflowConfig 和角色颜色
  const nodesWithConfig = useMemo(() => {
    return nodes.map(node => {
      const nodeData = node.data as NodeData;
      let roleColor = undefined;
      let inheritedRoleId = undefined;
      let inheritedRoleColor = undefined;
      
      // 非 Subtask 节点：根据 roleId 查找角色颜色
      if (node.type !== 'subtask' && nodeData.roleId) {
        const role = roles.find(r => r.id === nodeData.roleId);
        roleColor = role?.color;
      }
      
      // Subtask 节点：继承父 Task 的角色颜色
      if (node.type === 'subtask') {
        const parentEdge = edges.find(e => e.target === node.id && e.source);
        const parentNode = parentEdge ? nodes.find(n => n.id === parentEdge.source && n.type === 'task') : null;
        if (parentNode) {
          const parentRoleId = (parentNode.data as NodeData).roleId;
          if (parentRoleId) {
            inheritedRoleId = parentRoleId;
            const parentRole = roles.find(r => r.id === parentRoleId);
            inheritedRoleColor = parentRole?.color;
          }
        }
      }
      
      return {
        ...node,
        data: {
          ...node.data,
          workflowConfig,
          roleColor,
          inheritedRoleId,
          inheritedRoleColor,
        },
      };
    });
  }, [nodes, workflowConfig, roles, edges]);

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
    setSkillCategoryFilter('');
    setSkillSearchQuery('');
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
        // 修复 font undefined 错误：设置默认字体
        fontEmbedCSS: '',
        skipFonts: true,
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
      
      // 生成缩略图（FSM 工作流使用动态生成的流程图）
      const thumbnail = isFSM ? generateFSMThumbnail(nodes) : await generateThumbnail();
      
      // 处理 Subtask 的 roleId - Subtask 不存储 roleId，运行时动态继承
      const processedNodes = nodes.map(node => {
        if (node.type === 'subtask') {
          return {
            ...node,
            data: { ...node.data, roleId: null }
          };
        }
        return node;
      });
      
      const data: WorkflowData = {
        nodes: processedNodes,
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

  // 生成预览内容（用户提示词，发送给大模型）
  const generatePreviewContent = () => {
    // 按拓扑顺序排序节点
    const nodeOrder = new Map<string, number>();
    let order = 0;
    const startNode = nodes.find(n => n.type === 'start');
    if (startNode) {
      nodeOrder.set(startNode.id, order++);
      const queue = [startNode.id];
      const visited = new Set([startNode.id]);
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const currentOrder = nodeOrder.get(currentId)!;
        edges.filter(e => e.source === currentId).forEach(edge => {
          if (!visited.has(edge.target)) {
            visited.add(edge.target);
            nodeOrder.set(edge.target, currentOrder + 1);
            queue.push(edge.target);
          }
        });
      }
    }
    nodes.forEach(node => { if (!nodeOrder.has(node.id)) nodeOrder.set(node.id, order++); });

    const sortedNodes = [...nodes].sort((a, b) => (nodeOrder.get(a.id) ?? 999) - (nodeOrder.get(b.id) ?? 999));

    // 生成用户提示词
    let userPrompt = '';
    
    // 计算总任务数（所有节点数量）
    const totalTasks = sortedNodes.length;
    
    // 计算任务编号（排除 start 和 end 后的实际任务数）
    let taskIndex = 0;

    sortedNodes.forEach((node) => {
      const nodeData = node.data as NodeData;
      
      // 开始节点 - 使用系统配置的描述
      if (node.type === 'start') {
        userPrompt += `## 任务 1：${workflowConfig.startNodeLabel || '开始'}\n\n`;
        if (workflowConfig.startNodeDescription) {
          userPrompt += `${workflowConfig.startNodeDescription}\n\n`;
        }
        userPrompt += '---\n\n';
        return;
      }
      
      // 结束节点 - 使用系统配置的描述
      if (node.type === 'end') {
        userPrompt += `## 任务 ${totalTasks}：${workflowConfig.endNodeLabel || '结束'}\n\n`;
        if (workflowConfig.endNodeDescription) {
          userPrompt += `${workflowConfig.endNodeDescription}\n\n`;
        }
        userPrompt += '---\n\n';
        return;
      }

      // 其他任务节点
      taskIndex++;
      userPrompt += `## 任务 ${taskIndex + 1}：${nodeData.label}\n\n`;
      
      // 节点描述
      if (nodeData.description) {
        userPrompt += `${nodeData.description}\n\n`;
      }

      // Skill 加载模式
      const mode = nodeData.skillLoadingMode || 'description';
      
      if (mode === 'manual') {
        // 模式2：手工指定 Skills
        const skillIds: string[] = nodeData.skills ? JSON.parse(nodeData.skills) : [];
        if (skillIds.length > 0) {
          userPrompt += `请执行以下安全检查任务，必须执行下面指定的所有 Skills：\n\n`;
          skillIds.forEach((id, i) => {
            const skill = availableSkills.find(s => s.id === id);
            userPrompt += `${i + 1}. ${skill ? (skill.displayName || skill.name) : id}\n`;
          });
          userPrompt += '\n请确保以上所有 Skills 都被执行，不要遗漏。\n\n';
		  userPrompt += '### 重要，必须严格按下面的要求执行。\n';
          userPrompt += '请将任务分解成TODO列表，每个TODO用子代理（Subagent）执行，每个Subagent要独立运行，你的任务只有创建Subagent与监督Subagent进展，你禁止与项目经理干不相关的事，Subagent没有达到的你设定的目标，必须让Subagent重新执行。';
        }
      } else if (mode === 'vulnerability') {
        // 模式3：漏洞分类
        const cats: string[] = nodeData.vulnerabilityCategories || [];
        if (cats.length > 0) {
          const matched = filterMatchedSkills(techStackFilteredSkills, cats);
          if (matched.length > 0) {
            userPrompt += `请执行以下安全检查任务，必须执行下面指定的所有 Skills：\n\n`;
            matched.forEach((s, i) => {
              userPrompt += `${i + 1}. ${s.displayName || s.name}\n`;
            });
            userPrompt += '\n请确保以上所有 Skills 都被执行，不要遗漏。\n\n';
		  userPrompt += '### 重要，必须严格按下面的要求执行。\n';
          userPrompt += '请将任务分解成TODO列表，每个TODO用子代理（Subagent）执行，每个Subagent要独立运行，你的任务只有创建Subagent与监督Subagent进展，你禁止与项目经理干不相关的事，Subagent没有达到的你设定的目标，必须让Subagent重新执行。';
          }
        }
      }
      // 模式1：自定义描述 - 只有描述，不需要额外提示

      userPrompt += '---\n\n';
    });

    return userPrompt;
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
          <NodePalette onNodeDragStart={handleNodeDragStart} hideTriggers={hideTriggers} />
        </div>
      )}

      {/* 中间画布区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 工具栏 */}
        <div className="h-14 bg-dark-surface border-b border-gray-700/50 flex items-center justify-between px-4">
          <div className="flex items-center space-x-2">
            {!readOnly && (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
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
                <button
                  onClick={() => {
                    fetchRoles();
                    setShowRolePanel(true);
                  }}
                  className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  <Users size={16} />
                  <span>角色管理</span>
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
                    : 'bg-gray-400 text-white hover:bg-dark-surface-hover0'
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
                  className="p-1.5 text-gray-600 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="撤销"
                >
                  <Undo size={18} />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                  className="p-1.5 text-gray-600 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="重做"
                >
                  <Redo size={18} />
                </button>
              </>
            )}
            <button
              onClick={() => zoomIn()}
              className="p-1.5 text-gray-600 hover:bg-dark-surface-hover rounded"
              title="放大"
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={() => zoomOut()}
              className="p-1.5 text-gray-600 hover:bg-dark-surface-hover rounded"
              title="缩小"
            >
              <ZoomOut size={18} />
            </button>
            <button
              onClick={() => fitView()}
              className="p-1.5 text-gray-600 hover:bg-dark-surface-hover rounded"
              title="适应视图"
            >
              <Maximize size={18} />
            </button>
          </div>
        </div>

        {/* React Flow 画布 */}
        <div className="flex-1 bg-[#0F172A] relative overflow-hidden" onDrop={onDrop} onDragOver={onDragOver}>
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
              className="!bg-dark-surface !border-2 !border-gray-600 !rounded-lg !shadow-lg"
              style={{ width: 200, height: 150 }}
              maskColor="rgba(0, 0, 0, 0.1)"
            />
          </ReactFlow>

          {/* 缩放提示 */}
          <div className="absolute bottom-4 left-4 bg-dark-surface px-3 py-1.5 rounded-lg shadow-md text-xs text-gray-500 border border-gray-700/50 z-10">
            💡 提示：右下角小地图可快速导航，滚轮缩放，拖拽平移
          </div>
        </div>
      </div>

      {/* 右侧属性面板 */}
      {(selectedNode || selectedEdge) && (
        <div className="w-80 flex-shrink-0 bg-dark-surface border-l border border-gray-700/50 overflow-y-auto">
          <div className="p-4 border-b border-gray-700/50 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
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
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-400 hover:bg-red-50 rounded-md"
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
                    {/* 角色选择器 - 在节点名称之前 */}
                    {selectedNode.type !== 'subtask' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          角色
                        </label>
                        <select
                          value={selectedNode.data.roleId || ''}
                          onChange={(e) => {
                            const updatedNode = {
                              ...selectedNode,
                              data: { ...selectedNode.data, roleId: e.target.value || null }
                            };
                            setNodes((nds) =>
                              nds.map((n) => n.id === selectedNode.id ? updatedNode : n)
                            );
                            setSelectedNode(updatedNode);
                          }}
                          className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">默认角色</option>
                          {roles.map((role: any) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                        {/* 显示角色颜色标识 */}
                        {selectedNode.data.roleId && (
                          <div className="mt-2 flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{
                                backgroundColor: roles.find(r => r.id === selectedNode.data.roleId)?.color || '#3B82F6'
                              }}
                            />
                            <span className="text-xs text-gray-400">
                              {roles.find(r => r.id === selectedNode.data.roleId)?.name || '默认角色'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    
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
                        className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    {/* 描述输入框 - 仅在 description 模式下显示 */}
                    {(selectedNode.data.skillLoadingMode || 'description') === 'description' && (
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
                          className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}

                    {/* Skill 加载模式配置 */}
                    <div className="pt-4 border-t border-gray-700/50">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Skill 加载模式
                      </label>
                      <select
                        value={selectedNode.data.skillLoadingMode || 'description'}
                        onChange={(e) => {
                          const newMode = e.target.value as SkillLoadingMode;
                          const updatedNode = {
                            ...selectedNode,
                            data: {
                              ...selectedNode.data,
                              skillLoadingMode: newMode,
                              // 清除其他模式的配置
                              vulnerabilityCategories: newMode === 'vulnerability' ? selectedNode.data.vulnerabilityCategories : undefined,
                              skills: newMode === 'manual' ? selectedNode.data.skills : undefined,
                            }
                          };
                          setNodes((nds) =>
                            nds.map((n) => n.id === selectedNode.id ? updatedNode : n)
                          );
                          setSelectedNode(updatedNode);
                        }}
                        className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="description">自定义描述（默认）</option>
                        <option value="manual">手工指定 Skills</option>
                        <option value="vulnerability">漏洞类别</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        选择如何为该节点加载 Skills
                      </p>
                    </div>

{/* 漏洞类别模式 - 多选漏洞分类 */}
                     {(selectedNode.data.skillLoadingMode || 'description') === 'vulnerability' && (
                       <div className="bg-orange-900/20 border border-orange-500/20 rounded-md p-3 mt-3">
                         <p className="text-sm text-orange-300 font-medium mb-2">
                           漏洞分类配置
                         </p>
                         <div className="space-y-2">
                           <label className="block text-xs text-gray-600 mb-1">
                             选择漏洞分类（可多选）
                           </label>
                           {vulnCategories.length === 0 ? (
                             <p className="text-xs text-gray-400">加载中...</p>
                           ) : (
                             <div className="bg-dark-surface rounded-md border border-gray-700/50 max-h-48 overflow-y-auto">
                               {vulnCategories.map((cat) => {
                                 const selected: string[] = selectedNode.data.vulnerabilityCategories || [];
                                 const isChecked = selected.includes(cat.value);
                                 const matchCount = filterMatchedSkills(techStackFilteredSkills, [cat.value]).length;
                                 if (matchCount === 0 && !isChecked) return null;
                                 return (
                                   <label
                                     key={cat.value}
                                     className="flex items-center gap-2 px-3 py-2 hover:bg-orange-50 cursor-pointer border-b border-gray-100 last:border-0"
                                   >
                                     <input
                                       type="checkbox"
                                       checked={isChecked}
                                       onChange={() => {
                                         const next = isChecked
                                           ? selected.filter(v => v !== cat.value)
                                           : [...selected, cat.value];
                                         const updatedNode = {
                                           ...selectedNode,
                                           data: { ...selectedNode.data, vulnerabilityCategories: next },
                                         };
                                         setNodes(nds => nds.map(n => n.id === selectedNode.id ? updatedNode : n));
                                         setSelectedNode(updatedNode);
                                       }}
                                       className="accent-orange-600"
                                     />
                                     <span className="text-sm text-gray-700 flex-1">{cat.label}</span>
                                     <span className="text-xs text-gray-400">{matchCount} skills</span>
                                   </label>
                                 );
                               })}
                             </div>
                           )}
                           {/* 已选分类的匹配 Skills 预览 */}
                           {(selectedNode.data.vulnerabilityCategories || []).length > 0 && (() => {
                             const matched = filterMatchedSkills(techStackFilteredSkills, selectedNode.data.vulnerabilityCategories || []);
                             return (
                               <div className="mt-2 space-y-1">
                                 <p className="text-xs text-gray-500">
                                   共匹配 {matched.length} 个 Skills（已按技术栈过滤）
                                 </p>
                                 {matched.length > 0 && (
                                   <div className="bg-dark-surface rounded border border-gray-700/50 max-h-32 overflow-y-auto">
                                     {matched.map(s => (
                                       <div key={s.id} className="px-2 py-1 text-xs text-gray-700 border-b border-gray-100 last:border-0">
                                         {s.displayName || s.name}
                                       </div>
                                     ))}
                                   </div>
                                 )}
                               </div>
                             );
                           })()}
                         </div>
                       </div>
                     )}

{/* 手工指定模式 - 显示 Skills 多选器 */}
                    {(selectedNode.data.skillLoadingMode || 'description') === 'manual' && (
                      <div className="bg-green-900/20 border border-green-500/20 rounded-md p-3 mt-3">
                        <p className="text-sm text-green-300 font-medium mb-2">
                          手工指定 Skills
                        </p>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">
                              选择 Skills
                            </label>
                            {loadingSkills ? (
                              <div className="flex items-center justify-center py-2">
                                <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {/* 快捷操作按钮 */}
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    onClick={() => {
                                      // 全选（仅技术栈匹配的）
                                      const allSkillIds = techStackFilteredSkills.map(s => s.id);
                                      const updatedNode = {
                                        ...selectedNode,
                                        data: {
                                          ...selectedNode.data,
                                          skills: JSON.stringify(allSkillIds),
                                        }
                                      };
                                      setNodes((nds) =>
                                        nds.map((n) => n.id === selectedNode.id ? updatedNode : n)
                                      );
                                      setSelectedNode(updatedNode);
                                    }}
                                    className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                                  >
                                    全选
                                  </button>
                                  <button
                                    onClick={() => {
                                      // 清空
                                      const updatedNode = {
                                        ...selectedNode,
                                        data: {
                                          ...selectedNode.data,
                                          skills: undefined,
                                        }
                                      };
                                      setNodes((nds) =>
                                        nds.map((n) => n.id === selectedNode.id ? updatedNode : n)
                                      );
                                      setSelectedNode(updatedNode);
                                    }}
                                    className="px-2 py-1 text-xs bg-[#0F172A]0 text-white rounded hover:bg-gray-600 transition-colors"
                                  >
                                    清空
                                  </button>
                                  {/* 按类别选择下拉框 */}
                                  <select
                                    value={skillCategoryFilter}
                                    onChange={(e) => {
                                      setSkillCategoryFilter(e.target.value);
                                    }}
                                    className="px-2 py-1 text-xs border border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                                  >
                                    <option value="">按类别选择...</option>
                                    {skillCategories
                                      .filter((cat) => (filteredCategoryCounts[cat.value] || 0) > 0)
                                      .map((cat) => (
                                        <option key={cat.value} value={cat.value}>
                                          {cat.label} ({filteredCategoryCounts[cat.value] || 0})
                                        </option>
                                      ))}
                                  </select>
                                </div>
                                {/* Skills 搜索框 */}
                                <div className="relative mb-2">
                                  <input
                                    type="text"
                                    placeholder="搜索 Skills..."
                                    value={skillSearchQuery}
                                    onChange={(e) => setSkillSearchQuery(e.target.value)}
                                    className="w-full px-3 py-1.5 text-sm border border-gray-600 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  />
                                  {skillSearchQuery && (
                                    <button
                                      onClick={() => setSkillSearchQuery('')}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-400"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                                {/* Skills 分组列表 */}
                                <div className="bg-dark-surface rounded-md border border-gray-700/50 max-h-64 overflow-y-auto">
                                  {groupedSkills.length === 0 ? (
                                    <div className="px-3 py-4 text-center text-sm text-gray-500">
                                      {skillSearchQuery ? '没有匹配的 Skills' : '暂无可用 Skills'}
                                    </div>
                                  ) : (
                                    groupedSkills.map((group) => {
                                      const isExpanded = expandedCategories.has(group.category);
                                      const selectedSkills: string[] = selectedNode.data.skills
                                        ? JSON.parse(selectedNode.data.skills)
                                        : [];
                                      const selectedInCategory = group.skills.filter(s => selectedSkills.includes(s.id)).length;
                                      const allSelected = selectedInCategory === group.skills.length;
                                      const someSelected = selectedInCategory > 0 && !allSelected;

                                      return (
                                        <div key={group.category} className="border-b border-gray-100 last:border-b-0">
                                          {/* 分组标题 */}
                                          <div
                                            className="flex items-center justify-between px-3 py-2 bg-[#0F172A] cursor-pointer hover:bg-dark-surface-hover"
                                            onClick={() => toggleCategory(group.category)}
                                          >
                                            <div className="flex items-center gap-2">
                                              {isExpanded ? (
                                                <ChevronDown className="w-4 h-4 text-gray-500" />
                                              ) : (
                                                <ChevronRight className="w-4 h-4 text-gray-500" />
                                              )}
                                              <span className="text-sm font-medium text-gray-300">{group.category}</span>
                                              <span className="text-xs text-gray-500">({group.count})</span>
                                            </div>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleCategorySkills(group.category, group.skills, !allSelected);
                                              }}
                                              className="text-xs px-2 py-0.5 rounded border border-gray-600 hover:bg-dark-surface-hover text-gray-400"
                                            >
                                              {allSelected ? '取消全选' : '全选'}
                                            </button>
                                          </div>
                                          {/* 分组内容 */}
                                          {isExpanded && (
                                            <div className="divide-y divide-gray-50">
                                              {group.skills.map((skill) => {
                                                const isSelected = selectedSkills.includes(skill.id);
                                                return (
                                                  <div
                                                    key={skill.id}
                                                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-dark-surface-hover ${
                                                      isSelected ? 'bg-green-50' : ''
                                                    }`}
                                                    onClick={() => {
                                                      const currentSkills: string[] = selectedNode.data.skills
                                                        ? JSON.parse(selectedNode.data.skills)
                                                        : [];
                                                      const newSkills = isSelected
                                                        ? currentSkills.filter(id => id !== skill.id)
                                                        : [...currentSkills, skill.id];
                                                      const updatedNode = {
                                                        ...selectedNode,
                                                        data: {
                                                          ...selectedNode.data,
                                                          skills: newSkills.length > 0 ? JSON.stringify(newSkills) : undefined,
                                                        }
                                                      };
                                                      setNodes((nds) =>
                                                        nds.map((n) => n.id === selectedNode.id ? updatedNode : n)
                                                      );
                                                      setSelectedNode(updatedNode);
                                                    }}
                                                  >
                                                    <div className={`w-4 h-4 rounded border ${
                                                      isSelected
                                                        ? 'bg-green-600 border-green-600'
                                                        : 'border-gray-600'
                                                    } flex items-center justify-center`}>
                                                      {isSelected && (
                                                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                        </svg>
                                                      )}
                                                    </div>
                                                    <div className="flex-1">
                                                      <span className="text-sm text-gray-100">{skill.displayName}</span>
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                                {/* 已选择的 Skills 数量 */}
                                <div className="text-xs text-gray-400">
                                  已选择 {selectedNode.data.skills ? JSON.parse(selectedNode.data.skills).length : 0} 个 Skills
                                </div>
                              </div>
                            )}
                          </div>
                          {/* 显示已选择的 Skills 列表 */}
                          {selectedNode.data.skills && JSON.parse(selectedNode.data.skills).length > 0 && (
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">
                                已选择的 Skills
                              </label>
<div className="bg-dark-surface rounded-md p-2 border border-gray-700/50">
                                {JSON.parse(selectedNode.data.skills || '[]').map((skillId: string) => {
                                  const skill = availableSkills.find(s => s.id === skillId);
return (
                                    <div key={skillId} className="flex items-center justify-between py-1">
                                      <span className="text-xs text-gray-300">
                                        {skill?.displayName || skillId}
                                      </span>
                                      <button
                                        onClick={() => {
                                          const currentSkills: string[] = JSON.parse(selectedNode.data.skills || '[]');
                                          const newSkills = currentSkills.filter(id => id !== skillId);
                                          const updatedNode = {
                                            ...selectedNode,
                                            data: {
                                              ...selectedNode.data,
                                              skills: newSkills.length > 0 ? JSON.stringify(newSkills) : undefined,
                                            }
                                          };
                                          setNodes((nds) =>
                                            nds.map((n) => n.id === selectedNode.id ? updatedNode : n)
                                          );
                                          setSelectedNode(updatedNode);
                                        }}
                                        className="text-xs text-red-400 hover:text-red-800"
                                      >
                                        移除
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                           )}
                         </div>
                       </div>
                     )}
                  </>
                ) : (
                  <>
                    {/* 角色选择器 - 开始/结束节点也需要 */}
                    {selectedNode.type !== 'subtask' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          角色
                        </label>
                        <select
                          value={selectedNode.data.roleId || ''}
                          onChange={(e) => {
                            const updatedNode = {
                              ...selectedNode,
                              data: { ...selectedNode.data, roleId: e.target.value || null }
                            };
                            setNodes((nds) =>
                              nds.map((n) => n.id === selectedNode.id ? updatedNode : n)
                            );
                            setSelectedNode(updatedNode);
                          }}
                          className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">默认角色</option>
                          {roles.map((role: any) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                        {/* 显示角色颜色标识 */}
                        {selectedNode.data.roleId && (
                          <div className="mt-2 flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{
                                backgroundColor: roles.find(r => r.id === selectedNode.data.roleId)?.color || '#3B82F6'
                              }}
                            />
                            <span className="text-xs text-gray-400">
                              {roles.find(r => r.id === selectedNode.data.roleId)?.name || '默认角色'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="bg-blue-900/20 border border-blue-500/20 rounded-md p-3 mb-4">
                      <p className="text-sm text-blue-300 font-medium mb-2">
                        系统节点配置
                      </p>
                      <p className="text-xs text-blue-400">
                        此节点为系统节点，名称和描述由系统配置管理
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        节点名称
                      </label>
                      <div className="px-3 py-2 bg-[#0F172A] rounded-md text-sm text-gray-100">
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
                      <div className="px-3 py-2 bg-[#0F172A] rounded-md text-sm text-gray-100 whitespace-pre-wrap">
                        {selectedNode.type === 'start' 
                          ? workflowConfig.startNodeDescription 
                          : selectedNode.type === 'end' 
                            ? workflowConfig.endNodeDescription 
                            : selectedNode.data.description || '无描述'}
                      </div>
                    </div>
                  </>
                )}

                {/* Subtask 继承角色显示 */}
                {selectedNode.type === 'subtask' && (
                  <div className="bg-purple-900/20 border border-purple-500/20 rounded-md p-3">
                    <p className="text-sm text-purple-300 font-medium mb-2">
                      角色继承
                    </p>
                    {(() => {
                      // 查找父 Task 节点
                      const parentEdge = edges.find(e => e.target === selectedNode.id && e.source);
                      const parentNode = parentEdge ? nodes.find(n => n.id === parentEdge.source && n.type === 'task') : null;
                      const parentRoleId = parentNode?.data?.roleId;
                      const parentRole = parentRoleId ? roles.find(r => r.id === parentRoleId) : null;
                      
                      if (parentRole) {
                        return (
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: parentRole.color || '#3B82F6' }} />
<span className="text-sm text-purple-400">
                               继承自 {parentNode?.data?.label}: {parentRole.name}
                            </span>
                          </div>
                        );
                      } else {
                        return (
                          <span className="text-sm text-gray-400">
                            继承自 {parentNode?.data?.label || '父节点'}: 默认角色
                          </span>
                        );
                      }
                    })()}
                    <p className="text-xs text-purple-400 mt-2">
                      Subtask 自动继承父 Agent 的角色配置
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    节点类型
                  </label>
                  <div className="px-3 py-2 bg-[#0F172A] rounded-md text-sm text-gray-400">
                    {selectedNode.type}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    节点 ID
                  </label>
                  <div className="px-3 py-2 bg-[#0F172A] rounded-md text-sm text-gray-600 font-mono">
                    {selectedNode.id}
                  </div>
                </div>

                {/* Skill 预测 - 仅在 description 模式下显示 */}
                {(selectedNode.type === 'task' || selectedNode.type === 'subtask') && 
                 (selectedNode.data.skillLoadingMode || 'description') === 'description' && (
                  <div className="pt-4 border-t border-gray-700/50">
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
                            // 禁用按钮 60 秒
                            setPredictionDisabled(true);
                            setPredictionCountdown(60);
                          }
                        }}
                        disabled={predictionDisabled}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-sm disabled:bg-gray-400 disabled:cursor-not-allowed"
                      >
                        <Sparkles size={14} />
                        {predictionDisabled ? `请等待 ${predictionCountdown} 秒` : '预测匹配'}
                      </button>
                      
                      <button
                        onClick={() => {
                          // 设置当前查看的节点，并显示弹窗
                          setViewingNodeId(selectedNode.id);
                          setShowPredictionTasks(true);
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-dark-surface-hover text-gray-700 rounded-md hover:bg-dark-surface-hover transition-colors text-sm"
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
                    className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    边 ID
                  </label>
                  <div className="px-3 py-2 bg-[#0F172A] rounded-md text-sm text-gray-600 font-mono">
                    {selectedEdge.id}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    源节点
                  </label>
                  <div className="px-3 py-2 bg-[#0F172A] rounded-md text-sm text-gray-600 font-mono">
                    {selectedEdge.source}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    目标节点
                  </label>
                  <div className="px-3 py-2 bg-[#0F172A] rounded-md text-sm text-gray-600 font-mono">
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
          <div className="bg-dark-surface rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
            {/* 头部 */}
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-100">工作流预览</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-400"
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
                    return <hr key={index} className="my-4 border-gray-600" />;
                  }
                  if (line.startsWith('- **')) {
                    return <p key={index} className="text-sm text-gray-600 mb-1">{line}</p>;
                  }
                  if (line.startsWith('- ')) {
                    return <p key={index} className="text-sm text-gray-700 ml-4 mb-1">{line.slice(2)}</p>;
                  }
                  if (line.startsWith('**')) {
                    return <p key={index} className="text-sm font-medium text-gray-100 mb-1">{line}</p>;
                  }
                  if (line.trim() === '') {
                    return <br key={index} />;
                  }
                  return <p key={index} className="text-sm text-gray-700 mb-1">{line}</p>;
                })}
              </div>
            </div>

            {/* 底部 */}
            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end">
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
          <div className="bg-dark-surface rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
            {/* 头部 */}
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                <Sparkles size={20} />
                预测任务
              </h3>
              <button
                onClick={() => setShowPredictionTasks(false)}
                className="text-gray-400 hover:text-gray-400"
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
                    <div key={task.id} className="border border-gray-700/50 rounded-lg">
                      {/* 标题和时间 - 可点击展开/收缩 */}
                       <div 
                         className="flex items-start justify-between p-4 cursor-pointer hover:bg-dark-surface-hover"
                         onClick={() => {
                           setExpandedTasks(prev => {
                             const next = new Set(prev);
                             if (next.has(task.id)) {
                               next.delete(task.id);
                             } else {
                               next.add(task.id);
                             }
                             return next;
                           });
                         }}
                       >
                         <div className="flex items-start gap-2 flex-1">
                           {expandedTasks.has(task.id) ? (
                             <ChevronDown size={16} className="text-gray-400 mt-1 flex-shrink-0" />
                           ) : (
                             <ChevronRight size={16} className="text-gray-400 mt-1 flex-shrink-0" />
                           )}
                           <div className="flex-1">
                             <h4 className="font-semibold text-gray-100">{task.taskName}</h4>
                             <p className="text-sm text-gray-600 mt-1 line-clamp-2">{task.taskDescription}</p>
                             {task.nodeId && (
                               <p className="text-xs text-gray-400 mt-1 font-mono">节点: {task.nodeId}</p>
                             )}
                           </div>
                         </div>
                        <div className="text-right ml-4">
                          <div className="text-xs text-gray-500">
                            {new Date(task.createdAt).toLocaleString('zh-CN')}
                          </div>
                          {/* 状态标签 */}
                          <div className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full mt-1 ${
                            task.status === 'completed' ? 'bg-green-500/15 text-green-400' :
                            task.status === 'running' ? 'bg-blue-900/30 text-blue-400' :
                            task.status === 'failed' ? 'bg-red-500/15 text-red-400' :
                            task.status === 'cancelled' ? 'bg-gray-100 text-gray-200' :
                            'bg-yellow-900/20 text-yellow-400'
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
                              <div className="w-full bg-gray-700 rounded-full h-1.5">
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
                      
                      {/* 展开内容 */}
                      {expandedTasks.has(task.id) && (
                        <div className="px-4 pb-4 border-t border-gray-100">
                          {/* 错误信息 */}
                          {task.errorMessage && (
                            <div className="bg-red-900/20 border border-red-500/20 rounded-md p-3 mt-3">
                              <p className="text-sm text-red-400">{task.errorMessage}</p>
                            </div>
                          )}
                          
                          {/* 匹配结果 */}
                          {task.status === 'completed' && task.matches && Array.isArray(task.matches) && (
                            <div className="space-y-2 mt-3">
                              <h5 className="text-sm font-medium text-gray-300">
                                匹配的 Skills ({task.matchCount}) - {task.method === 'llm' ? 'AI 匹配' : '关键词匹配'}
                              </h5>
                              <div className="grid grid-cols-1 gap-2">
                                {task.matches.map((match, idx) => (
                                  <div key={idx} className="bg-[#0F172A] rounded-md p-3">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="font-medium text-sm text-gray-100">{match.displayName}</span>
                                      <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded-full">
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelTask(task.id);
                                }}
                                className="text-sm text-red-400 hover:text-red-300 hover:bg-red-50 px-3 py-1.5 rounded-md transition-colors"
                              >
                                取消任务
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                   ))}
                </div>
                  );
                })()}
            </div>

            {/* 底部 */}
            <div className="px-6 py-4 border-t border-gray-700/50 flex justify-between">
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

      {/* 角色管理面板 */}
      {showRolePanel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-dark-surface rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-100">角色管理</h3>
              <button onClick={() => setShowRolePanel(false)} className="text-gray-400 hover:text-gray-400">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6">
              {/* 角色列表 */}
              {loadingRoles ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : (
                <div className="space-y-3">
                  {roles.map((role: any) => (
                    <div key={role.id} className="flex items-center justify-between p-3 bg-[#0F172A] rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: role.color || '#3B82F6' }} />
                        <span className="font-medium text-gray-100">{role.name}</span>
                        <span className="text-xs text-gray-500">({role.nodes?.length || 0} 个节点)</span>
                      </div>
                      <button
                         onClick={async () => {
                           const token = localStorage.getItem('token');
                           await fetch(`/api/workflows/${workflowId}/roles/${role.id}`, {
                             method: 'DELETE',
                             headers: { Authorization: `Bearer ${token}` },
                           });
                           fetchRoles();
                           onRolesChange?.();
                         }}
                         className="text-red-400 hover:text-red-800"
                       >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  
                  {roles.length === 0 && (
                    <p className="text-center text-gray-500">暂无角色，请创建</p>
                  )}
                </div>
              )}
              
              {/* 创建新角色 */}
              <div className="mt-6 pt-6 border-t border-gray-700/50">
                <h4 className="text-sm font-medium text-gray-700 mb-2">创建新角色</h4>
                <p className="text-xs text-gray-500 mb-3">
                  角色颜色用于标识节点归属，节点左侧会显示角色颜色条
                </p>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder="角色名称（如：分析员、审计员）"
                    className="w-full px-3 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500"
                  />
                  
                  {/* 预制颜色选择 */}
                  <div>
                    <label className="block text-xs text-gray-600 mb-2">选择颜色</label>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        '#3B82F6', // 蓝色
                        '#10B981', // 绿色
                        '#F59E0B', // 黄色
                        '#EF4444', // 红色
                        '#8B5CF6', // 紫色
                        '#EC4899', // 粉色
                        '#06B6D4', // 青色
                        '#F97316', // 橙色
                        '#6366F1', // 靛蓝
                        '#84CC16', // 草绿
                        '#64748B', // 灰色
                        '#1E293B', // 深灰
                      ].map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewRoleColor(color)}
                          className={`w-6 h-6 rounded-full transition-all ${
                            newRoleColor === color 
                              ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' 
                              : 'hover:scale-105'
                          }`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                  
                  <button
                    onClick={async () => {
                      if (!newRoleName.trim()) {
                        toast.error('请输入角色名称');
                        return;
                      }
                      const token = localStorage.getItem('token');
                      await fetch(`/api/workflows/${workflowId}/roles`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ name: newRoleName, color: newRoleColor }),
                      });
                      setNewRoleName('');
                       setNewRoleColor('#3B82F6');
                       fetchRoles();
                       onRolesChange?.();
                       toast.success('角色创建成功');
                    }}
                    disabled={!newRoleName.trim()}
                    className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    创建角色
                  </button>
                </div>
              </div>
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
