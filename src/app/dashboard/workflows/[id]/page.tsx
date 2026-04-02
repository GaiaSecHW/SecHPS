'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, AlertCircle, Loader2, Power, PowerOff } from 'lucide-react';
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
}

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
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    fetchWorkflowData();
  }, [workflowId]);

  const fetchWorkflowData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      // 获取工作流基本信息
      const workflowResponse = await fetch(`/api/workflows/${workflowId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!workflowResponse.ok) {
        const data = await workflowResponse.json();
        setError(data.error || '获取工作流失败');
        setLoading(false);
        return;
      }

      const workflowData = await workflowResponse.json();
      setWorkflow(workflowData.workflow);

      // 根据工作流状态设置启用状态
      setIsEnabled(workflowData.workflow.status === 'published');

      // 获取工作流节点和边数据
      const dataResponse = await fetch(`/api/workflows/${workflowId}/data`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (dataResponse.ok) {
        const data = await dataResponse.json();
        setInitialData({
          nodes: data.nodes || [],
          edges: data.edges || [],
          viewport: data.viewport,
        });
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (data: WorkflowData) => {
    try {
      setSaving(true);
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/workflows/${workflowId}/data`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '保存失败');
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

  const handleToggleEnabled = async () => {
    try {
      const token = localStorage.getItem('token');
      const newStatus = !isEnabled ? 'published' : 'draft'; // 启用=published, 禁用=draft

      // 如果要启用工作流，先验证工作流数据
      if (!isEnabled && initialData) {
        // 使用严格模式验证（strict=true）
        const validationResponse = await fetch('/api/workflows/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            nodes: initialData.nodes,
            edges: initialData.edges,
            strict: true, // 启用时使用严格验证
          }),
        });

        if (!validationResponse.ok) {
          const data = await validationResponse.json();
          const errors = data.errors || [];
          const warnings = data.warnings || [];

          let message = '工作流验证失败：\n\n';
          errors.forEach((err: string) => {
            message += `❌ ${err}\n`;
          });
          if (warnings.length > 0) {
            message += '\n警告：\n';
            warnings.forEach((warn: string) => {
              message += `⚠️ ${warn}\n`;
            });
          }

          alert(message);
          return;
        }
      }

      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: newStatus,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '更新状态失败');
        return;
      }

      setIsEnabled(!isEnabled);
      setSuccessMessage(isEnabled ? '工作流已禁用' : '工作流已启用');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Toggle enabled error:', err);
      alert('网络错误，请重试');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb" />
          <p className="text-gray-600 mt-4">加载工作流中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            加载失败
          </h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
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
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            工作流不存在
          </h2>
          <button
            onClick={() => router.push('/dashboard/workflows')}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            返回工作流列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 自定义样式 */}
      <style jsx global>{handleStyles}</style>
      
      {/* 顶部导航栏 */}
      <div className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.push('/dashboard/workflows')}
            className="flex items-center space-x-1 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={20} />
            <span>返回</span>
          </button>

          <div className="h-6 w-px bg-gray-200"></div>

          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {workflow.name}
            </h1>
            {workflow.description && (
              <p className="text-xs text-gray-500 truncate max-w-md">
                {workflow.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {successMessage && (
            <div className="bg-green-50 text-green-800 px-3 py-1.5 rounded-md text-sm">
              {successMessage}
            </div>
          )}

          <button
            onClick={() => {
              // 触发编辑器的保存
              const saveEvent = new CustomEvent('workflow-save');
              window.dispatchEvent(saveEvent);
            }}
            disabled={saving}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <Save size={18} />
            <span>{saving ? '保存中...' : '保存'}</span>
          </button>
        </div>
      </div>

      {/* 工作流编辑器 */}
      <div className="flex-1 overflow-hidden">
        <WorkflowEditor
          workflowId={workflowId}
          initialData={initialData}
          onSave={handleSave}
          readOnly={false}
          isEnabled={isEnabled}
          onToggleEnabled={handleToggleEnabled}
        />
      </div>
    </div>
  );
}
