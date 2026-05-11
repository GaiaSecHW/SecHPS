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
  location: string | null;       // 问题代码位置
  POC: string | null;            // POC 验证代码
  vulnerable: boolean | null;    // 是否为真实漏洞
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
    userId?: string;
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
  EvaluationSession?: {
    id: string;
    projectId: string;
    Project?: {
      userId: string;
    };
  };
}

// Severity color mapping
const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  low: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  info: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
};

// Status color mapping
const statusColors: Record<string, { bg: string; text: string }> = {
  new: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  confirmed: { bg: 'bg-green-500/20', text: 'text-green-400' },
  'false-positive': { bg: 'bg-gray-500/20', text: 'text-gray-400' },
  false_positive: { bg: 'bg-gray-500/20', text: 'text-gray-400' }, // 兼容旧格式
  ignored: { bg: 'bg-gray-500/20', text: 'text-gray-500' },
  fixed: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  verified: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
};

const statusNames: Record<string, string> = {
  new: '新发现',
  confirmed: '已确认',
  'false-positive': '误报',
  false_positive: '误报', // 兼容旧格式
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
    action: 'confirmed' | 'false-positive' | 'ignored' | null;
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
      
      // 调用对应的专用 API
      const apiPath = confirmDialog.action === 'confirmed' 
        ? `/api/vulnerabilities/${vulnId}/confirm`
        : confirmDialog.action === 'false-positive'
        ? `/api/vulnerabilities/${vulnId}/false-positive`
        : `/api/vulnerabilities/${vulnId}`;

      const response = await fetch(apiPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
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
  const openConfirmDialog = (action: 'confirmed' | 'false-positive' | 'ignored') => {
    setConfirmDialog({ isOpen: true, action, loading: false });
  };

  // Loading state
  if (loading) {
    return <PageLoading text="加载漏洞详情..." />;
  }

  // Error state
  if (error || !vulnerability) {
    return (
      <div className="min-h-screen bg-[#0F172A] p-6">
        <div className="max-w-5xl mx-auto">
          <div className="bg-red-900/20 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertTriangle size={20} />
            <span>{error || '漏洞不存在'}</span>
          </div>
          <button
            onClick={() => router.back()}
            className="mt-4 inline-flex items-center px-4 py-2 bg-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
          >
            <ArrowLeft size={16} className="mr-2" />
            返回
          </button>
        </div>
      </div>
    );
  }

  const severityStyle = severityColors[vulnerability.severity] || severityColors.info;
  const statusStyle = statusColors[vulnerability.status] || statusColors.new;

  return (
    <div className="min-h-screen bg-[#0F172A] p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-dark-surface-hover rounded-lg transition-colors mt-1"
            >
              <ArrowLeft size={20} className="text-gray-400" />
            </button>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-gray-100">
                  {vulnerability.title}
                </h1>
                <span
                  className={`px-2.5 py-1 rounded-full text-sm font-medium border ${severityStyle.bg} ${severityStyle.text} ${severityStyle.border}`}
                >
                  {vulnerability.severity.toUpperCase()}
                </span>
                <span
                  className={`px-2.5 py-1 rounded-full text-sm font-medium ${statusStyle.bg} ${statusStyle.text}`}
                >
                  {statusNames[vulnerability.status] || vulnerability.status}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-400">
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
                  onClick={() => openConfirmDialog('false-positive')}
                  className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  <XCircle size={16} className="mr-2" />
                  标记误报
                </button>
                <button
                  onClick={() => openConfirmDialog('ignored')}
                  className="inline-flex items-center px-4 py-2 border border-gray-600 text-gray-300 rounded-lg hover:bg-dark-surface-hover transition-colors"
                >
                  <Ban size={16} className="mr-2" />
                  忽略
                </button>
              </>
            )}
            {vulnerability.status === 'confirmed' && (
              <>
                <button
                  onClick={() => openConfirmDialog('false-positive')}
                  className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  <XCircle size={16} className="mr-2" />
                  标记误报
                </button>
                <button
                  onClick={() => openConfirmDialog('ignored')}
                  className="inline-flex items-center px-4 py-2 border border-gray-600 text-gray-300 rounded-lg hover:bg-dark-surface-hover transition-colors"
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
          <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6">
            <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <MessageSquare size={18} />
              漏洞描述
            </h2>
            <p className="text-gray-300 leading-relaxed">{vulnerability.description}</p>
          </div>

          {/* Code snippet / Location */}
          {vulnerability.location && (
            <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6">
              <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <Code size={18} />
                问题代码位置
              </h2>
              <pre className="text-sm bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                {vulnerability.location}
              </pre>
            </div>
          )}

          {/* POC */}
          {vulnerability.POC && (
            <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6">
              <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <Code size={18} />
                POC 验证代码
              </h2>
              <pre className="text-sm bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                {vulnerability.POC}
              </pre>
            </div>
          )}

          {/* Fix suggestion */}
          {vulnerability.fixSuggestion && (
            <div className="bg-gradient-to-br from-green-900/30 to-emerald-900/30 rounded-lg shadow border border-green-500/30 p-6">
              <h2 className="text-lg font-semibold text-green-300 mb-4 flex items-center gap-2">
                <Wrench size={18} />
                修复建议
              </h2>
              <div className="text-gray-200 leading-relaxed whitespace-pre-wrap">
                {vulnerability.fixSuggestion}
              </div>
            </div>
          )}

          {/* Notes */}
          {vulnerability.notes && (
            <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6">
              <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <MessageSquare size={18} />
                备注
              </h2>
              <p className="text-gray-300 leading-relaxed">{vulnerability.notes}</p>
            </div>
          )}
        </div>

        {/* Right column - Info panel */}
        <div className="space-y-6">
          {/* Basic info */}
          <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6">
            <h2 className="text-lg font-semibold text-gray-100 mb-4">基本信息</h2>
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
                <p className="mt-1 text-gray-100 font-medium">{vulnerability.type}</p>
              </div>

              {/* CWE */}
              {vulnerability.cwe && (
                <div>
                  <label className="text-sm text-gray-500">CWE 编号</label>
                  <p className="mt-1 text-gray-100">
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
                  <p className="mt-1 text-gray-100">{vulnerability.skill}</p>
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
          <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6">
            <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <MapPin size={18} />
              位置信息
            </h2>
            <div className="space-y-4">
              {/* Vulnerable status */}
              <div>
                <label className="text-sm text-gray-500">漏洞状态</label>
                <p className="mt-1 text-gray-100">
                  {vulnerability.vulnerable ? '真实漏洞' : '待确认'}
                </p>
              </div>
            </div>
          </div>

          {/* History */}
          <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6">
            <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <Clock size={18} />
              标记历史
            </h2>
            <div className="space-y-3">
              {/* Created */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <Eye size={14} className="text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-100">发现漏洞</p>
                  <p className="text-xs text-gray-500">
                    {new Date(vulnerability.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Confirmed */}
              {vulnerability.confirmedAt && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                    <CheckCircle size={14} className="text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-100">确认漏洞</p>
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
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <Wrench size={14} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-100">修复漏洞</p>
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
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Shield size={14} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-100">验证修复</p>
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
                <div className="w-8 h-8 rounded-full bg-gray-500/20 flex items-center justify-center">
                  <Clock size={14} className="text-gray-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-100">最后更新</p>
                  <p className="text-xs text-gray-500">
                    {new Date(vulnerability.updatedAt).toLocaleString()}
                  </p>
                </div>
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
            : confirmDialog.action === 'false-positive'
            ? '确定要将此漏洞标记为"误报"吗？标记后将不再追踪此漏洞。'
            : '确定要忽略此漏洞吗？忽略后将不再显示在漏洞列表中。'
        }
        confirmText={
          confirmDialog.action === 'confirmed'
            ? '确认漏洞'
            : confirmDialog.action === 'false-positive'
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