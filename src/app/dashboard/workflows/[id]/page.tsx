'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, AlertCircle, Loader2, Eye, Edit2, Lock } from 'lucide-react';
import WorkflowEditor from '@/components/workflow/WorkflowEditor';
import { WorkflowData } from '@/types/workflow';
import '@xyflow/react/dist/style.css';

// 自定义句柄样式
const handleStyles = `
  .react-flow__handle {
    opacity: 1 !important;
  }
  .react-flow__handle-left {
    left: -8px !important;
  }
  .react-flow__handle-right {
    right: -8px !important;
  }
  .react-flow__handle:hover {
    transform: scale(1.3);
    box-shadow: 0 0 8px rgba(59, 130, 246, 0.5);
  }
  .react-flow__edge-path {
    stroke-width: 2;
  }
  .react-flow__edge.selected .react-flow__edge-path {
    stroke: #3b82f6;
    stroke-width: 3;
  }
`;

interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: string;
  thumbnail?: string;
  userId?: string;
  userName?: string;
  userUsername?: string;
  isPublic?: boolean;
  workflowType?: string;
  techStack?: string;
}

// 角色接口
interface Role {
  id: string;
  name: string;
  description?: string;
  color?: string;
}

// P 阶段标签
const phaseLabels: Record<string, string> = {
  'P1': '项目理解',
  'P2': 'DFD分析',
  'P3': '信任边界',
  'P4': '安全评估',
  'P5': 'STRIDE分析',
  'P6': '报告生成',
};

// P 阶段描述
const phaseDescriptions: Record<string, string> = {
  'P1': '理解项目结构、技术栈',
  'P2': '绘制数据流图',
  'P3': '定义信任边界',
  'P4': '安全设计评审',
  'P5': '识别潜在威胁',
  'P6': '生成威胁建模报告',
};

export default function WorkflowEditPage() {
  const router = useRouter();
  const params = useParams();
  const workflowId = params.id as string;

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [initialData, setInitialData] = useState<WorkflowData | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; roles?: string[] } | null>(null);
  
  // 角色列表（复用 WorkflowEditor 的角色 API）
  const [roles, setRoles] = useState<Role[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  
  // FSM 阶段角色配置（P1-P6 各选一个角色）
  const [phaseRoles, setPhaseRoles] = useState<Record<string, string>>({});

  // 初始化用户信息
  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const userData = JSON.parse(userStr);
      setCurrentUser(userData);
    }
  }, []);

  useEffect(() => {
    fetchWorkflowData();
  }, [workflowId, currentUser]);

  // 获取角色列表
  useEffect(() => {
    if (workflow?.workflowType === 'fsm' && workflowId) {
      fetchRoles();
    }
  }, [workflow?.workflowType, workflowId]);

  const fetchWorkflowData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const workflowResponse = await fetch(`/api/workflows/${workflowId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!workflowResponse.ok) {
        const data = await workflowResponse.json();
        setError(data.error || '获取Agent编排失败');
        setLoading(false);
        return;
      }

      const workflowData = await workflowResponse.json();
      setWorkflow(workflowData.workflow);

      if (currentUser) {
        const isAdmin = currentUser.roles?.includes('admin') || false;
        const isOwner = workflowData.workflow?.userId === currentUser.id;
        setCanEdit(isAdmin || isOwner);
      }

      const dataResponse = await fetch(`/api/workflows/${workflowId}/data`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (dataResponse.ok) {
        const data = await dataResponse.json();
        setInitialData({
          nodes: data.nodes || [],
          edges: data.edges || [],
          viewport: data.viewport,
        });
        
        // 从节点数据中提取阶段角色配置
        const phaseRoleMap: Record<string, string> = {};
        (data.nodes || []).forEach((node: any) => {
          if (node.data?.phase && node.data?.roleId) {
            phaseRoleMap[node.data.phase] = node.data.roleId;
          }
        });
        setPhaseRoles(phaseRoleMap);
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

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

  // 处理阶段角色变更
  const handlePhaseRoleChange = (phase: string, roleId: string) => {
    setPhaseRoles(prev => ({
      ...prev,
      [phase]: roleId,
    }));
  };

  // 保存（包含角色配置）
  const handleSave = async (data: WorkflowData) => {
    try {
      setSaving(true);
      const token = localStorage.getItem('token');

      // FSM 工作流：将阶段角色配置合并到节点数据
      let nodesToSave = data.nodes;
      if (workflow?.workflowType === 'fsm') {
        nodesToSave = data.nodes.map((node: any) => {
          if (node.data?.phase && phaseRoles[node.data.phase]) {
            return {
              ...node,
              data: {
                ...node.data,
                roleId: phaseRoles[node.data.phase],
              },
            };
          }
          return node;
        });
      }

      const response = await fetch(`/api/workflows/${workflowId}/data`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nodes: nodesToSave,
          edges: data.edges,
          viewport: data.viewport,
        }),
      });

      if (!response.ok) {
        const respData = await response.json();
        if (respData.details && Array.isArray(respData.details)) {
          let message = respData.error || '验证失败';
          message += '\n\n';
          respData.details.forEach((err: string) => {
            message += `❌ ${err}\n`;
          });
          throw new Error(message);
        }
        throw new Error(respData.error || '保存失败');
      }

      setSuccessMessage('保存成功');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Save error:', err);
      alert(err instanceof Error ? err.message : '保存失败');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb" />
          <p className="text-gray-600 mt-4">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">加载失败</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button onClick={() => router.back()} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            返回
          </button>
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">不存在</h2>
          <button onClick={() => router.push('/dashboard/workflows')} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            返回列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <style jsx global>{handleStyles}</style>

      {/* 顶部导航栏 */}
      <div className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center space-x-4">
          <button onClick={() => router.push('/dashboard/workflows')} className="flex items-center space-x-1 text-gray-600 hover:text-gray-900">
            <ArrowLeft size={20} />
            <span>返回</span>
          </button>
          <div className="h-6 w-px bg-gray-200"></div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-gray-900">{workflow.name}</h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                workflow.workflowType === 'fsm' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {workflow.workflowType === 'fsm' ? '威胁建模固定编排' : '用户自由编排'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {workflow.description && <p className="text-xs text-gray-500 truncate max-w-md">{workflow.description}</p>}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                canEdit ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {canEdit ? <Edit2 size={12} /> : <Eye size={12} />}
                {canEdit ? '编辑模式' : '查看模式'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {successMessage && <div className="bg-green-50 text-green-800 px-3 py-1.5 rounded-md text-sm">{successMessage}</div>}
        </div>
      </div>

      {/* 内容区 */}
      {workflow.workflowType === 'fsm' ? (
        <div className="flex-1 flex flex-col">
          {/* 固定流程概览 */}
          <div className="bg-gray-50 border-b border-gray-200 p-4">
            <div className="flex items-center justify-center gap-2">
              <div className="px-3 py-2 border border-blue-200 rounded bg-blue-50 text-center">
                <span className="text-sm font-medium text-blue-700">1. 系统理解</span>
                <span className="text-xs text-gray-500 ml-1">(P1+P2)</span>
              </div>
              <span className="text-gray-400">→</span>
              <div className="px-3 py-2 border border-blue-200 rounded bg-blue-50 text-center">
                <span className="text-sm font-medium text-blue-700">2. 安全评估</span>
                <span className="text-xs text-gray-500 ml-1">(P3+P4)</span>
              </div>
              <span className="text-gray-400">→</span>
              <div className="px-3 py-2 border border-blue-200 rounded bg-blue-50 text-center">
                <span className="text-sm font-medium text-blue-700">3. 威胁分析</span>
                <span className="text-xs text-gray-500 ml-1">(P5)</span>
              </div>
              <span className="text-gray-400">→</span>
              <div className="px-3 py-2 border border-purple-300 rounded bg-purple-100 text-center">
                <span className="text-sm font-medium text-purple-700">N. 渗透测试</span>
                <span className="text-xs text-purple-500 ml-1">(可编辑)</span>
              </div>
              <span className="text-gray-400">→</span>
              <div className="px-3 py-2 border border-blue-200 rounded bg-blue-50 text-center">
                <span className="text-sm font-medium text-blue-700">N+1. 报告生成</span>
                <span className="text-xs text-gray-500 ml-1">(P6)</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden relative">
            {/* 左侧：阶段角色配置 */}
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-white border-r border-gray-200 flex flex-col">
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <h3 className="font-semibold text-gray-900">阶段角色配置</h3>
                <p className="text-xs text-gray-500 mt-0.5">角色通过工具栏「角色管理」创建</p>
              </div>
              
              <div className="flex-1 overflow-auto p-3 space-y-2">
                {loadingRoles ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : (
                  <>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">前置阶段</div>
                    {['P1', 'P2', 'P3', 'P4', 'P5'].map((phase) => (
                      <div key={phase} className="p-2 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Lock size={12} className="text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">{phase}</span>
                          <span className="text-xs text-gray-500">{phaseLabels[phase]}</span>
                        </div>
                        <div className="text-xs text-gray-500 mb-2">{phaseDescriptions[phase]}</div>
                        <select
                          value={phaseRoles[phase] || ''}
                          onChange={(e) => handlePhaseRoleChange(phase, e.target.value)}
                          disabled={!canEdit}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded disabled:bg-gray-100"
                        >
                          <option value="">默认角色</option>
                          {roles.map((role) => (
                            <option key={role.id} value={role.id}>{role.name}</option>
                          ))}
                        </select>
                        {phaseRoles[phase] && (
                          <div className="mt-1.5 h-1 rounded" style={{ backgroundColor: roles.find(r => r.id === phaseRoles[phase])?.color || '#gray' }} />
                        )}
                      </div>
                    ))}
                    
                    <div className="text-xs font-medium text-purple-600 uppercase tracking-wide mt-4 mb-2">渗透测试区</div>
                    <div className="p-2 bg-purple-50 rounded-lg border border-purple-200">
                      <div className="text-sm font-medium text-purple-700 mb-1">渗透测试</div>
                      <div className="text-xs text-purple-600">添加自定义测试节点</div>
                    </div>
                    
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mt-4 mb-2">后置阶段</div>
                    <div className="p-2 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Lock size={12} className="text-gray-400" />
                        <span className="text-sm font-medium text-gray-900">P6</span>
                        <span className="text-xs text-gray-500">{phaseLabels['P6']}</span>
                      </div>
                      <div className="text-xs text-gray-500 mb-2">{phaseDescriptions['P6']}</div>
                      <select
                        value={phaseRoles['P6'] || ''}
                        onChange={(e) => handlePhaseRoleChange('P6', e.target.value)}
                        disabled={!canEdit}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded disabled:bg-gray-100"
                      >
                        <option value="">默认角色</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>{role.name}</option>
                        ))}
                      </select>
                      {phaseRoles['P6'] && (
                        <div className="mt-1.5 h-1 rounded" style={{ backgroundColor: roles.find(r => r.id === phaseRoles['P6'])?.color || '#gray' }} />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            
            {/* 右侧：节点编辑器 */}
            <div className="ml-64 h-full">
              <WorkflowEditor
                workflowId={workflowId}
                initialData={initialData}
                workflowTechStack={workflow?.techStack}
                onSave={canEdit ? handleSave : undefined}
                readOnly={!canEdit}
                hideTriggers={true}
                onRolesChange={fetchRoles}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <WorkflowEditor
            workflowId={workflowId}
            initialData={initialData}
            workflowTechStack={workflow?.techStack}
            onSave={canEdit ? handleSave : undefined}
            readOnly={!canEdit}
          />
        </div>
      )}
    </div>
  );
}
