'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Layers,
  Edit,
  FileText,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';
import { useAuth } from '@/hooks/useAuth';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorAlert } from '@/components/ui/Alert';

interface FSMTemplate {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  skillPath: string | null;
  version: string;
  isActive: boolean;
}

const phaseLabels: Record<string, string> = {
  'P1': '项目理解',
  'P2': 'DFD分析',
  'P3': '信任边界',
  'P4': '安全评估',
  'P5': 'STRIDE分析',
  'P6': '报告生成',
};

const phaseDescriptions: Record<string, string> = {
  'P1': '理解项目结构、技术栈、模块划分、入口点',
  'P2': '绘制数据流图(DFD)，识别数据流向和存储',
  'P3': '定义信任边界，识别跨边界数据流',
  'P4': '安全设计评审，识别安全缺口',
  'P5': 'STRIDE威胁分析，识别潜在威胁',
  'P6': '生成完整威胁建模报告',
};

export default function FSMTemplatesPage() {
  return (
    <AdminGuard>
      <FSMTemplatesPageContent />
    </AdminGuard>
  );
}

function FSMTemplatesPageContent() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [template, setTemplate] = useState<FSMTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTemplate();
  }, []);

  const loadTemplate = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/fsm-templates', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('获取 FSM 模板失败');

      const data = await response.json();
      const threatModelingTemplate = (data.templates || data || []).find(
        (t: FSMTemplate) => t.name === 'threat-modeling'
      );
      
      if (threatModelingTemplate) {
        setTemplate(threatModelingTemplate);
      } else {
        setError('未找到威胁建模模板');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取 FSM 模板失败');
    } finally {
      setLoading(false);
    }
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
        <h1 className="text-2xl font-bold text-gray-900">威胁建模工作流配置</h1>
        <ErrorAlert>{error || '未找到威胁建模模板'}</ErrorAlert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">威胁建模配置</h1>
        <p className="mt-1 text-sm text-gray-600">
          编辑各阶段的 Skill 内容，定制威胁建模分析行为
        </p>
      </div>

      {/* 固定流程 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Layers size={20} className="mr-2" />
          固定工作流程
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          系统理解 → 安全评估 → 威胁分析 → 渗透测试 → 报告生成（顺序固定，不可修改）
        </p>

        {/* 流程可视化 */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {/* 1. 系统理解 */}
          <div className="p-4 border border-blue-200 rounded-lg bg-blue-50 text-center min-w-[120px]">
            <div className="text-xl font-bold text-blue-600 mb-1">1</div>
            <div className="font-medium text-gray-900 text-sm">系统理解</div>
            <div className="text-xs text-gray-500 mt-1">P1 + P2</div>
          </div>
          
          <span className="text-gray-400 text-xl">→</span>
          
          {/* 2. 安全评估 */}
          <div className="p-4 border border-blue-200 rounded-lg bg-blue-50 text-center min-w-[120px]">
            <div className="text-xl font-bold text-blue-600 mb-1">2</div>
            <div className="font-medium text-gray-900 text-sm">安全评估</div>
            <div className="text-xs text-gray-500 mt-1">P3 + P4</div>
          </div>
          
          <span className="text-gray-400 text-xl">→</span>
          
          {/* 3. 威胁分析 */}
          <div className="p-4 border border-blue-200 rounded-lg bg-blue-50 text-center min-w-[120px]">
            <div className="text-xl font-bold text-blue-600 mb-1">3</div>
            <div className="font-medium text-gray-900 text-sm">威胁分析</div>
            <div className="text-xs text-gray-500 mt-1">P5</div>
          </div>
          
          <span className="text-gray-400 text-xl">→</span>
          
          {/* N. 渗透测试 */}
          <div className="p-4 border border-purple-300 rounded-lg bg-purple-50 text-center min-w-[120px]">
            <div className="text-xl font-bold text-purple-600 mb-1">N</div>
            <div className="font-medium text-gray-900 text-sm">渗透测试</div>
            <div className="text-xs text-gray-500 mt-1">Pentest</div>
          </div>
          
          <span className="text-gray-400 text-xl">→</span>
          
          {/* N+1. 报告生成 */}
          <div className="p-4 border border-blue-200 rounded-lg bg-blue-50 text-center min-w-[120px]">
            <div className="text-xl font-bold text-blue-600 mb-1">N+1</div>
            <div className="font-medium text-gray-900 text-sm">报告生成</div>
            <div className="text-xs text-gray-500 mt-1">P6</div>
          </div>
        </div>
        
        {/* 说明 */}
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
          <strong>渗透测试 (N)</strong>：STRIDE威胁分析后，执行渗透测试验证发现的威胁，测试完成后进入报告生成阶段。
        </div>
      </div>

      {/* 阶段内容编辑 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <FileText size={20} className="mr-2" />
          阶段内容编辑
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          点击阶段按钮编辑该阶段的 Skill 定义内容
        </p>
        
        <div className="grid grid-cols-2 gap-4">
          {['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((phase) => (
            <button
              key={phase}
              onClick={() => router.push(`/dashboard/admin/fsm-templates/${template.id}?editPhase=${phase}`)}
              disabled={!isAdmin}
              className="flex items-start p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold mr-3 group-hover:bg-blue-200">
                {phase}
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">{phaseLabels[phase]}</div>
                <div className="text-xs text-gray-500 mt-1">{phaseDescriptions[phase]}</div>
              </div>
              <Edit size={16} className="flex-shrink-0 text-gray-400 group-hover:text-blue-600 mt-1" />
            </button>
          ))}
        </div>
      </div>

      {/* 模板信息 */}
      <div className="text-sm text-gray-500">
        模板: {template.name} | 版本: {template.version} | Skill 路径: {template.skillPath || '未配置'}
      </div>
    </div>
  );
}
