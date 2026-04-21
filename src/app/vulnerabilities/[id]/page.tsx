'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  FileCode,
  Clock,
  User,
  MapPin,
  Code,
  Sparkles,
  Wrench,
  MessageSquare,
  Loader2,
  Shield,
  Ban,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoading } from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

interface Vulnerability {
  id: string;
  projectId: string;
  evaluationId: string | null;
  skillExecutionId: string | null;
  title: string;
  description: string;
  type: string;
  cwe: string | null;
  severity: string;
  skill: string | null;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  codeSnippet: string | null;
  details: any | null;
  aiAnalysis: string | null;
  fixSuggestion: string | null;
  status: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  fixedBy: string | null;
  fixedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  Project?: {
    id: string;
    name: string;
  };
  SkillExecution?: {
    id: string;
    skillId: string;
    Skill?: {
      id: string;
      name: string;
      displayName: string;
    };
  };
}

// Severity color mapping
const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  high: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  low: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  info: { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' },
};

// Status color mapping
const statusColors: Record<string, { bg: string; text: string }> = {
  new: { bg: 'bg-purple-100', text: 'text-purple-700' },
  confirmed: { bg: 'bg-green-100', text: 'text-green-700' },
  false_positive: { bg: 'bg-gray-100', text: 'text-gray-600' },
  ignored: { bg: 'bg-gray-100', text: 'text-gray-500' },
  fixed: { bg: 'bg-blue-100', text: 'text-blue-700' },
  verified: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

// Status display names
const statusNames: Record<string, string> = {
  new: '新发现',
  confirmed: '已确认',
  false_positive: '误报',
  ignored: '已忽略',
  fixed: '已修复',
  verified: '已验证',
};

export default function VulnerabilityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const vulnId = params.id as string;

  const [vulnerability, setVulnerability] = useState<Vulnerability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Confirmation dialogs
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    action: 'confirmed' | 'false_positive' | 'ignored' | null;
    loading: boolean;
  }>({ isOpen: false, action: null, loading: false });

  // Fetch vulnerability data
  const fetchVulnerability = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/vulnerabilities/${vulnId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('漏洞不存在');
        }
        throw new Error('获取漏洞详情失败');
      }

      const data = await response.json();
      setVulnerability(data.vulnerability);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVulnerability();
  }, [vulnId]);

  // Handle status change
  const handleStatusChange = async () => {
    if (!vulnerability || !confirmDialog.action) return;

    setConfirmDialog((prev) => ({ ...prev, loading: true }));

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/vulnerabilities/${vulnId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: confirmDialog.action,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }

      toast.success(`漏洞状态已更新为: ${statusNames[confirmDialog.action]}`);
      setConfirmDialog({ isOpen: false, action: null, loading: false });
      fetchVulnerability();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败');
      setConfirmDialog((prev) => ({ ...prev, loading: false }));
    }
  };

  // Open confirmation dialog
  const openConfirmDialog = (action: 'confirmed' | 'false_positive' | 'ignored') => {
    setConfirmDialog({ isOpen: true, action, loading: false });
  };

  // Render code snippet with line numbers
  const renderCodeSnippet = () => {
    if (!vulnerability?.codeSnippet) return null;

    const lines = vulnerability.codeSnippet.split('\n');
    const startLine = vulnerability.lineStart || 1;

    return (
      <div className="bg-gray-900 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Code size={16} className="text-gray-400" />
            <span className="text-sm text-gray-300 font-mono">
              {vulnerability.filePath || '代码片段'}
            </span>
          </div>
          <span className="text-xs text-gray-500">
            行 {vulnerability.lineStart || '-'} - {vulnerability.lineEnd || '-'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <pre className="p-0 m-0">
            <code className="block">
              {lines.map((line, index) => {
                const lineNumber = startLine + index;
                const isHighlighted =
                  vulnerability.lineStart &&
                  vulnerability.lineEnd &&
                  lineNumber >= vulnerability.lineStart &&
                  lineNumber <= vulnerability.lineEnd;

                return (
                  <div
                    key={index}
                    className={`flex px-4 py-1 ${
                      isHighlighted
                        ? 'bg-yellow-900/30 border-l-2 border-yellow-500'
                        : ''
                    }`}
                  >
                    <span className="w-8 text-right pr-4 text-gray-500 select-none font-mono text-sm">
                      {lineNumber}
                    </span>
                    <span className="text-gray-100 font-mono text-sm whitespace-pre">
                      {line || ' '}
                    </span>
                  </div>
                );
              })}
            </code>
          </pre>
        </div>
      </div>
    );
  };

  // Loading state
  if (loading) {
    return <PageLoading text="加载漏洞详情..." />;
  }

  // Error state
  if (error || !vulnerability) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertTriangle size={20} />
          <span>{error || '漏洞不存在'}</span>
        </div>
        <button
          onClick={() => router.back()}
          className="mt-4 inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={16} className="mr-2" />
          返回
        </button>
      </div>
    );
  }

  const severityStyle = severityColors[vulnerability.severity] || severityColors.info;
  const statusStyle = statusColors[vulnerability.status] || statusColors.new;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors mt-1"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-gray-900">
                {vulnerability.title}
              </h1>
              <span
                className={`px-2.5 py-1 rounded-full text-sm font-medium ${severityStyle.bg} ${severityStyle.text}`}
              >
                {vulnerability.severity.toUpperCase()}
              </span>
              <span
                className={`px-2.5 py-1 rounded-full text-sm font-medium ${statusStyle.bg} ${statusStyle.text}`}
              >
                {statusNames[vulnerability.status] || vulnerability.status}
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <Shield size={14} />
                {vulnerability.type}
              </span>
              {vulnerability.cwe && (
                <span className="flex items-center gap-1">
                  <AlertTriangle size={14} />
                  CWE-{vulnerability.cwe}
                </span>
              )}
              {vulnerability.Project && (
                <span className="flex items-center gap-1">
                  <FileCode size={14} />
                  项目: {vulnerability.Project.name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {vulnerability.status === 'new' && (
            <>
              <button
                onClick={() => openConfirmDialog('confirmed')}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <CheckCircle size={16} className="mr-2" />
                确认漏洞
              </button>
              <button
                onClick={() => openConfirmDialog('false_positive')}
                className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                <XCircle size={16} className="mr-2" />
                标记误报
              </button>
              <button
                onClick={() => openConfirmDialog('ignored')}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Ban size={16} className="mr-2" />
                忽略
              </button>
            </>
          )}
          {vulnerability.status === 'confirmed' && (
            <>
              <button
                onClick={() => openConfirmDialog('false_positive')}
                className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                <XCircle size={16} className="mr-2" />
                标记误报
              </button>
              <button
                onClick={() => openConfirmDialog('ignored')}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Ban size={16} className="mr-2" />
                忽略
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MessageSquare size={18} />
              漏洞描述
            </h2>
            <p className="text-gray-700 leading-relaxed">{vulnerability.description}</p>
          </div>

          {/* Code snippet */}
          {vulnerability.codeSnippet && (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Code size={18} />
                代码片段
              </h2>
              {renderCodeSnippet()}
            </div>
          )}

          {/* AI Analysis */}
          {vulnerability.aiAnalysis && (
            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg shadow border border-purple-200 p-6">
              <h2 className="text-lg font-semibold text-purple-900 mb-4 flex items-center gap-2">
                <Sparkles size={18} />
                AI 分析
              </h2>
              <div className="text-purple-800 leading-relaxed whitespace-pre-wrap">
                {vulnerability.aiAnalysis}
              </div>
            </div>
          )}

          {/* Fix suggestion */}
          {vulnerability.fixSuggestion && (
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg shadow border border-green-200 p-6">
              <h2 className="text-lg font-semibold text-green-900 mb-4 flex items-center gap-2">
                <Wrench size={18} />
                修复建议
              </h2>
              <div className="text-green-800 leading-relaxed whitespace-pre-wrap">
                {vulnerability.fixSuggestion}
              </div>
            </div>
          )}

          {/* Notes */}
          {vulnerability.notes && (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <MessageSquare size={18} />
                备注
              </h2>
              <p className="text-gray-700 leading-relaxed">{vulnerability.notes}</p>
            </div>
          )}
        </div>

        {/* Right column - Info panel */}
        <div className="space-y-6">
          {/* Basic info */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">基本信息</h2>
            <div className="space-y-4">
              {/* Severity */}
              <div>
                <label className="text-sm text-gray-500">严重程度</label>
                <div className="mt-1">
                  <span
                    className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium ${severityStyle.bg} ${severityStyle.text} ${severityStyle.border} border`}
                  >
                    <AlertTriangle size={14} className="mr-1.5" />
                    {vulnerability.severity.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Type */}
              <div>
                <label className="text-sm text-gray-500">漏洞类型</label>
                <p className="mt-1 text-gray-900 font-medium">{vulnerability.type}</p>
              </div>

              {/* CWE */}
              {vulnerability.cwe && (
                <div>
                  <label className="text-sm text-gray-500">CWE 编号</label>
                  <p className="mt-1 text-gray-900">
                    <a
                      href={`https://cwe.mitre.org/data/definitions/${vulnerability.cwe}.html`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 underline"
                    >
                      CWE-{vulnerability.cwe}
                    </a>
                  </p>
                </div>
              )}

              {/* Skill */}
              {vulnerability.skill && (
                <div>
                  <label className="text-sm text-gray-500">检测 Skill</label>
                  <p className="mt-1 text-gray-900">{vulnerability.skill}</p>
                </div>
              )}

              {/* SkillExecution */}
              {vulnerability.SkillExecution?.Skill && (
                <div>
                  <label className="text-sm text-gray-500">关联 Skill</label>
                  <button
                    onClick={() =>
                      router.push(`/dashboard/skills/${vulnerability.SkillExecution!.Skill!.id}`)
                    }
                    className="mt-1 text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {vulnerability.SkillExecution.Skill.displayName}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Location info */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MapPin size={18} />
              位置信息
            </h2>
            <div className="space-y-4">
              {/* File path */}
              {vulnerability.filePath && (
                <div>
                  <label className="text-sm text-gray-500">文件路径</label>
                  <p className="mt-1 text-gray-900 font-mono text-sm bg-gray-50 px-2 py-1 rounded">
                    {vulnerability.filePath}
                  </p>
                </div>
              )}

              {/* Line numbers */}
              <div>
                <label className="text-sm text-gray-500">行号范围</label>
                <p className="mt-1 text-gray-900">
                  {vulnerability.lineStart && vulnerability.lineEnd
                    ? `${vulnerability.lineStart} - ${vulnerability.lineEnd}`
                    : vulnerability.lineStart
                    ? `第 ${vulnerability.lineStart} 行`
                    : '未指定'}
                </p>
              </div>
            </div>
          </div>

          {/* History */}
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Clock size={18} />
              标记历史
            </h2>
            <div className="space-y-3">
              {/* Created */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                  <Eye size={14} className="text-purple-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">发现漏洞</p>
                  <p className="text-xs text-gray-500">
                    {new Date(vulnerability.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Confirmed */}
              {vulnerability.confirmedAt && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle size={14} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">确认漏洞</p>
                    <p className="text-xs text-gray-500">
                      {new Date(vulnerability.confirmedAt).toLocaleString()}
                      {vulnerability.confirmedBy && (
                        <span className="ml-2 flex items-center gap-1">
                          <User size={12} />
                          {vulnerability.confirmedBy}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {/* Fixed */}
              {vulnerability.fixedAt && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <Wrench size={14} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">修复漏洞</p>
                    <p className="text-xs text-gray-500">
                      {new Date(vulnerability.fixedAt).toLocaleString()}
                      {vulnerability.fixedBy && (
                        <span className="ml-2 flex items-center gap-1">
                          <User size={12} />
                          {vulnerability.fixedBy}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {/* Verified */}
              {vulnerability.verifiedAt && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                    <Shield size={14} className="text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">验证修复</p>
                    <p className="text-xs text-gray-500">
                      {new Date(vulnerability.verifiedAt).toLocaleString()}
                      {vulnerability.verifiedBy && (
                        <span className="ml-2 flex items-center gap-1">
                          <User size={12} />
                          {vulnerability.verifiedBy}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {/* Last updated */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <Clock size={14} className="text-gray-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">最后更新</p>
                  <p className="text-xs text-gray-500">
                    {new Date(vulnerability.updatedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ isOpen: false, action: null, loading: false })}
        onConfirm={handleStatusChange}
        title="确认操作"
        message={
          confirmDialog.action === 'confirmed'
            ? '确定要将此漏洞标记为"已确认"吗？'
            : confirmDialog.action === 'false_positive'
            ? '确定要将此漏洞标记为"误报"吗？标记后将不再追踪此漏洞。'
            : '确定要忽略此漏洞吗？忽略后将不再显示在漏洞列表中。'
        }
        confirmText={
          confirmDialog.action === 'confirmed'
            ? '确认漏洞'
            : confirmDialog.action === 'false_positive'
            ? '标记误报'
            : '忽略'
        }
        variant={
          confirmDialog.action === 'confirmed' ? 'info' : 'warning'
        }
        loading={confirmDialog.loading}
      />
    </div>
  );
}