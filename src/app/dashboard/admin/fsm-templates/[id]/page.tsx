'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Save,
  RefreshCw,
  FileText,
  Users,
  Settings,
  Lock,
  Edit3,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';
import { useAuth } from '@/hooks/useAuth';
import { apiGet, apiPut } from '@/lib/api-client';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorAlert } from '@/components/ui/Alert';

// 新结构：每个 P 阶段单独一个节点
interface FSMNode {
  id: string;
  label: string;
  phase: string | null;  // 'P1' | 'P2' | ... | null (渗透测试区)
  fsmPhase: number;
  fsmFixed: boolean;
  fsmOrder: number;
  skillPath: string | null;
  description: string;
  roleId?: string;
}

interface FSMRole {
  id: string;
  name: string;
  description: string;
  color: string;
  order: number;
}

interface FSMTemplate {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  skillPath: string | null;
  version: string;
  nodeCount: number;
  nodes: FSMNode[];
  defaultRoles: FSMRole[] | null;
}

// P 阶段标签
const phaseLabels: Record<string, string> = {
  'P1': '项目理解',
  'P2': 'DFD分析',
  'P3': '信任边界',
  'P4': '安全设计评审',
  'P5': 'STRIDE分析',
  'P6': '报告生成',
};

// P 阶段描述
const phaseDescriptions: Record<string, string> = {
  'P1': '理解项目结构、技术栈、模块划分、入口点',
  'P2': '绘制数据流图(DFD)，识别数据流向和存储',
  'P3': '定义信任边界，识别跨边界数据流',
  'P4': '安全设计评审，识别安全缺口',
  'P5': 'STRIDE威胁分析，识别潜在威胁',
  'P6': '生成完整威胁建模报告',
};

export default function FSMTemplateDetailPage() {
  return (
    <AdminGuard>
      <FSMTemplateDetailPageContent />
    </AdminGuard>
  );
}

function FSMTemplateDetailPageContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const templateId = params.id as string;
  const editPhaseParam = searchParams.get('editPhase');
  const { isAdmin } = useAuth();

  const [template, setTemplate] = useState<FSMTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 阶段内容编辑状态
  const [editingPhase, setEditingPhase] = useState<string | null>(editPhaseParam);
  const [phaseContent, setPhaseContent] = useState('');
  const [phaseLoading, setPhaseLoading] = useState(false);
  const [phaseSaving, setPhaseSaving] = useState(false);
  
  // 角色配置状态
  const [nodes, setNodes] = useState<FSMNode[]>([]);
  const [roles, setRoles] = useState<FSMRole[]>([]);
  const [rolesSaving, setRolesSaving] = useState(false);
  const [showRoleConfig, setShowRoleConfig] = useState(true);  // 默认显示角色配置

  useEffect(() => {
    loadTemplate();
  }, [templateId]);

  useEffect(() => {
    // 如果 URL 有 editPhase 参数，自动加载该阶段并切换到 Skill 编辑
    if (editPhaseParam && template) {
      setShowRoleConfig(false);
      loadPhaseContent(editPhaseParam);
    }
  }, [editPhaseParam, template]);

  const loadTemplate = async () => {
    setLoading(true);
    setError(null);
    
    const result = await apiGet<{ template: FSMTemplate }>(`/api/admin/fsm-templates/${templateId}`);
    
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      const tmpl = result.data.template;
      setTemplate(tmpl);
      setNodes(tmpl.nodes || []);
      setRoles(tmpl.defaultRoles || []);
    }
    
    setLoading(false);
  };

  const loadPhaseContent = async (phase: string) => {
    setPhaseLoading(true);
    setEditingPhase(phase);
    setPhaseContent('');
    
    const result = await apiGet<{ content: string }>(`/api/admin/fsm-templates/${templateId}/phases/${phase}`);
    
    if (result.error) {
      toast.error(result.error);
      setPhaseContent('');
    } else if (result.data) {
      setPhaseContent(result.data.content);
    }
    
    setPhaseLoading(false);
  };

  const savePhaseContent = async () => {
    if (!editingPhase) return;
    
    setPhaseSaving(true);
    
    const result = await apiPut(`/api/admin/fsm-templates/${templateId}/phases/${editingPhase}`, {
      content: phaseContent,
    });
    
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`阶段 ${editingPhase} 内容已保存`);
    }
    
    setPhaseSaving(false);
  };

  const saveRoleConfig = async () => {
    if (!template) return;
    
    setRolesSaving(true);
    
    // 更新 nodes 中的 roleId 和 defaultRoles
    const result = await apiPut<{ template: FSMTemplate }>(`/api/admin/fsm-templates/${templateId}`, {
      nodes: nodes,
      defaultRoles: roles,
    });
    
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success('角色配置已保存');
      // 更新本地状态
      if (result.data?.template) {
        setNodes(result.data.template.nodes || []);
        setRoles(result.data.template.defaultRoles || []);
      }
    }
    
    setRolesSaving(false);
  };

  const handlePhaseSelect = (phase: string) => {
    setEditingPhase(phase);
    setShowRoleConfig(false);
    router.push(`/dashboard/admin/fsm-templates/${templateId}?editPhase=${phase}`);
    loadPhaseContent(phase);
  };

  const handleNodeRoleChange = (nodeId: string, newRoleId: string) => {
    setNodes(nodes.map(node => 
      node.id === nodeId ? { ...node, roleId: newRoleId } : node
    ));
  };

  const handleRoleChange = (roleIndex: number, field: keyof FSMRole, value: string) => {
    setRoles(roles.map((role, index) => 
      index === roleIndex ? { ...role, [field]: value } : role
    ));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push('/dashboard/admin/fsm-templates')}
          className="inline-flex items-center text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回
        </button>
        <ErrorAlert>{error || '模板不存在'}</ErrorAlert>
      </div>
    );
  }

  // 过滤出 P 阶段节点和渗透测试节点
  const phaseNodes = nodes.filter(n => n.phase !== null);
  const penetrationNode = nodes.find(n => n.phase === null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.push('/dashboard/admin/fsm-templates')}
            className="inline-flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={20} className="mr-2" />
            返回
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">威胁建模配置</h1>
            <p className="mt-1 text-sm text-gray-600">
              {template.displayName} (v{template.version})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(editingPhase || showRoleConfig) && (
            <button
              onClick={editingPhase ? savePhaseContent : saveRoleConfig}
              disabled={(editingPhase ? phaseSaving : rolesSaving) || !isAdmin}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {editingPhase ? phaseSaving : rolesSaving ? (
                <RefreshCw size={20} className="mr-2 animate-spin" />
              ) : (
                <Save size={20} className="mr-2" />
              )}
              保存
            </button>
          )}
        </div>
      </div>

      {/* 功能切换标签 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setShowRoleConfig(true); setEditingPhase(null); }}
            className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showRoleConfig
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Users size={16} className="mr-2" />
            阶段角色配置
          </button>
          <button
            onClick={() => setShowRoleConfig(false)}
            className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !showRoleConfig && editingPhase
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <FileText size={16} className="mr-2" />
            Skill 内容编辑
          </button>
        </div>
      </div>

      {/* 角色配置界面 */}
      {showRoleConfig ? (
        <div className="space-y-6">
          {/* 角色定义 */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center mb-4">
              <Users size={20} className="mr-2" />
              默认角色定义
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              定义工作流的默认角色。启动评估时，管理员可以为每个角色配置对应的执行模型。
            </p>
            
            {roles.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                暂无角色定义
              </div>
            ) : (
              <div className="space-y-3">
                {roles.map((role, index) => (
                  <div key={role.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                    <div 
                      className="w-4 h-4 rounded-full flex-shrink-0" 
                      style={{ backgroundColor: role.color }}
                    />
                    <input
                      type="text"
                      value={role.name}
                      onChange={(e) => handleRoleChange(index, 'name', e.target.value)}
                      disabled={!isAdmin}
                      className="w-32 px-3 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
                      placeholder="角色名称"
                    />
                    <input
                      type="text"
                      value={role.description || ''}
                      onChange={(e) => handleRoleChange(index, 'description', e.target.value)}
                      disabled={!isAdmin}
                      className="flex-1 px-3 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100"
                      placeholder="角色描述"
                    />
                    <input
                      type="color"
                      value={role.color}
                      onChange={(e) => handleRoleChange(index, 'color', e.target.value)}
                      disabled={!isAdmin}
                      className="w-8 h-8 rounded cursor-pointer disabled:cursor-not-allowed"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* P 阶段角色配置 */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center mb-4">
              <Settings size={20} className="mr-2" />
              P 阶段角色分配
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              为每个 P 阶段分配执行角色。每个 P 阶段相当于一个固定的 Agent，角色决定执行时的模型配置。
            </p>
            
            <div className="space-y-2">
              {phaseNodes.map((node) => {
                const phase = node.phase!;
                return (
                  <div key={node.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                    {/* 阶段标识 */}
                    <div className="flex-shrink-0 flex items-center gap-2 w-20">
                      <Lock size={14} className="text-gray-400" />
                      <span className="text-sm font-semibold text-gray-900">{phase}</span>
                    </div>
                    
                    {/* 阶段名称和描述 */}
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">{phaseLabels[phase] || node.label}</div>
                      <div className="text-xs text-gray-500">{phaseDescriptions[phase] || node.description}</div>
                    </div>
                    
                    {/* 角色选择 */}
                    <div className="flex-shrink-0 w-40">
                      <select
                        value={node.roleId || ''}
                        onChange={(e) => handleNodeRoleChange(node.id, e.target.value)}
                        disabled={!isAdmin}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100"
                      >
                        <option value="">选择角色...</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    {/* 当前角色颜色 */}
                    {node.roleId && (
                      <div 
                        className="w-4 h-4 rounded-full flex-shrink-0"
                        style={{ backgroundColor: roles.find(r => r.id === node.roleId)?.color || '#999' }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 渗透测试区（用户自由编排） */}
          {penetrationNode && (
            <div className="bg-purple-50 rounded-lg shadow border border-purple-200 p-6">
              <h2 className="text-lg font-semibold text-purple-900 flex items-center mb-4">
                <Edit3 size={20} className="mr-2" />
                渗透测试区（用户自由编排）
              </h2>
              <p className="text-sm text-purple-700 mb-4">
                此阶段为用户自由编排区，用户可添加自定义的渗透测试 Agent。管理员可配置默认角色。
              </p>
              
              <div className="flex items-center gap-4 p-3 bg-white rounded-lg">
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">{penetrationNode.label}</div>
                  <div className="text-xs text-gray-500">{penetrationNode.description}</div>
                </div>
                
                <div className="flex-shrink-0 w-40">
                  <select
                    value={penetrationNode.roleId || ''}
                    onChange={(e) => handleNodeRoleChange(penetrationNode.id, e.target.value)}
                    disabled={!isAdmin}
                    className="w-full px-3 py-2 border border-purple-300 rounded-md text-sm disabled:bg-gray-100"
                  >
                    <option value="">选择角色...</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                {penetrationNode.roleId && (
                  <div 
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: roles.find(r => r.id === penetrationNode.roleId)?.color || '#999' }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* 阶段选择 */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
            <div className="flex flex-wrap gap-2">
              {['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((phase) => (
                <button
                  key={phase}
                  onClick={() => handlePhaseSelect(phase)}
                  className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    editingPhase === phase
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {phase} ({phaseLabels[phase]})
                </button>
              ))}
            </div>
          </div>

          {/* 编辑器区域 */}
          {editingPhase ? (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <FileText size={20} className="mr-2" />
                  {editingPhase} - {phaseLabels[editingPhase]}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {phaseDescriptions[editingPhase]}
                </p>
              </div>
              
              {phaseLoading ? (
                <div className="flex items-center justify-center h-64">
                  <LoadingSpinner size="lg" />
                </div>
              ) : (
                <textarea
                  value={phaseContent}
                  onChange={(e) => setPhaseContent(e.target.value)}
                  disabled={!isAdmin}
                  rows={25}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm disabled:bg-gray-50 disabled:text-gray-500"
                  placeholder="阶段定义内容..."
                />
              )}
              
              <div className="mt-4 text-xs text-gray-500">
                文件路径: {template.skillPath}/phases/{editingPhase}-*.md
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-12 text-center">
              <FileText size={48} className="mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600">请选择要编辑的阶段</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
