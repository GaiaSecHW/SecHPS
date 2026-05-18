'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Copy,
  FileCode,
  Clock,
  User,
  MapPin,
  Code,
  Wrench,
  MessageSquare,
  Shield,
  ClipboardCopy,
  Check,
  Download,
} from 'lucide-react';
import { PageLoading } from '@/components/ui/LoadingSpinner';
import { AdminGuard } from '@/components/PermissionGuard';
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
  location: string | null;
  POC: string | null;
  vulnerable: boolean | null;
  fixSuggestion: string | null;
  rawReport: string | null;
  filePath: string | null;
  status: string;
  taskId: string | null;
  notes: string | null;
  falsePositiveReason: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  fixedBy: string | null;
  fixedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  Project?: {
    id: string;
    name: string;
    userId?: string;
  };
  TaskInstance?: {
    id: string;
    name: string;
  } | null;
}

// Severity color mapping
const severityColors: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  critical: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', dot: 'bg-red-500' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', dot: 'bg-orange-500' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', dot: 'bg-yellow-500' },
  low: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-500' },
  info: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30', dot: 'bg-gray-500' },
};

// Status color mapping
const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
  new: { bg: 'bg-purple-500/20', text: 'text-purple-400', dot: 'bg-purple-500' },
  confirmed: { bg: 'bg-green-500/20', text: 'text-green-400', dot: 'bg-green-500' },
  'false-positive': { bg: 'bg-gray-500/20', text: 'text-gray-400', dot: 'bg-gray-500' },
  false_positive: { bg: 'bg-gray-500/20', text: 'text-gray-400', dot: 'bg-gray-500' },
  fixed: { bg: 'bg-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-500' },
  verified: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-500' },
};

// Priority color mapping
const priorityColors: Record<string, { bg: string; text: string }> = {
  'P0': { bg: 'bg-red-500', text: 'text-white' },
  'P1': { bg: 'bg-orange-500', text: 'text-white' },
  'P2': { bg: 'bg-yellow-500', text: 'text-black' },
  'P3': { bg: 'bg-blue-500', text: 'text-white' },
};

const statusNames: Record<string, string> = {
  new: '新发现',
  confirmed: '已确认',
  'false-positive': '误报',
  false_positive: '误报',
  fixed: '已修复',
  verified: '已验证',
};

// Copy to clipboard function
const copyToClipboard = async (text: string, label: string = '代码') => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label}已复制到剪贴板`);
  } catch (err) {
    toast.error('复制失败');
  }
};

// Code block component with copy button
function CodeBlock({ code, label = '代码', language = 'text' }: { code: string; label?: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyToClipboard(code, label);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="text-sm bg-[#0B1120] text-gray-100 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap border border-gray-700/50">
        {code}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
        title={`复制${label}`}
      >
        {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} className="text-gray-300" />}
      </button>
    </div>
  );
}

// Timeline item component
function TimelineItem({
  label,
  date,
  user,
  completed,
  isLast = false,
}: {
  label: string;
  date: string | null;
  user?: string | null;
  completed: boolean;
  isLast?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 relative">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-[11px] top-5 w-0.5 h-full bg-gray-700" />
      )}

      {/* Dot */}
      <div className="w-6 h-6 rounded-full flex items-center justify-center z-10 shrink-0">
        {completed ? (
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
        ) : (
          <div className="w-2.5 h-2.5 rounded-full border-2 border-gray-500" />
        )}
      </div>

      {/* Content */}
      <div className={`pb-4 ${isLast ? '' : 'mb-2'}`}>
        <p className={`text-sm font-medium ${completed ? 'text-gray-100' : 'text-gray-500'}`}>{label}</p>
        {date && (
          <p className="text-xs text-gray-500 mt-1">
            {new Date(date).toLocaleString()}
            {user && (
              <span className="ml-2 inline-flex items-center gap-1">
                <User size={10} />
                {user}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function VulnerabilityDetailContent() {
  const params = useParams();
  const router = useRouter();
  const vulnId = params.id as string;

  const [vulnerability, setVulnerability] = useState<Vulnerability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Extract priority from fix suggestion
  const extractPriority = (fixSuggestion: string | null) => {
    if (!fixSuggestion) return null;
    const match = fixSuggestion.match(/\[([Pp][0-3])\]/);
    return match ? match[1].toUpperCase() : null;
  };

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
  const handleAction = async (action: string) => {
    if (!vulnerability) return;

    setActionLoading(action);

    try {
      const token = localStorage.getItem('token');
      const apiPath = `/api/vulnerabilities/${vulnId}/${action}`;

      const body = action === 'false-positive' && vulnerability.falsePositiveReason
        ? { reason: vulnerability.falsePositiveReason }
        : {};

      const response = await fetch(apiPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: action === 'false-positive' ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }

      toast.success('状态更新成功');
      fetchVulnerability();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setActionLoading(null);
    }
  };

  // Loading state
  if (loading) {
    return <PageLoading text="加载漏洞详情..." />;
  }

  // Error state
  if (error || !vulnerability) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-red-900/20 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertTriangle size={20} />
          <span>{error || '漏洞不存在'}</span>
        </div>
        <button
          onClick={() => router.push('/dashboard/admin/vulnerabilities')}
          className="mt-4 inline-flex items-center px-4 py-2 bg-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft size={16} className="mr-2" />
          返回
        </button>
      </div>
    );
  }

  const severityStyle = severityColors[vulnerability.severity] || severityColors.info;
  const statusStyle = statusColors[vulnerability.status] || statusColors.new;
  const priority = extractPriority(vulnerability.fixSuggestion);
  const priorityStyle = priority ? priorityColors[priority] : null;

  // Determine action buttons based on status
  const getActionButtons = () => {
    if (vulnerability.status === 'new') {
      return (
        <>
          <button
            onClick={() => handleAction('confirm')}
            disabled={actionLoading === 'confirm'}
            className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle size={16} className="mr-2" />
            确认漏洞
          </button>
          <button
            onClick={() => handleAction('false-positive')}
            disabled={actionLoading === 'false-positive'}
            className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <XCircle size={16} className="mr-2" />
            标记误报
          </button>
        </>
      );
    }

    if (vulnerability.status === 'confirmed') {
      return (
        <>
          <button
            onClick={() => handleAction('fix')}
            disabled={actionLoading === 'fix'}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle size={16} className="mr-2" />
            标记已修复
          </button>
          <button
            onClick={() => handleAction('false-positive')}
            disabled={actionLoading === 'false-positive'}
            className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <XCircle size={16} className="mr-2" />
            标记误报
          </button>
        </>
      );
    }

    if (vulnerability.status === 'fixed') {
      return (
        <button
          onClick={() => handleAction('verify')}
          disabled={actionLoading === 'verify'}
          className="inline-flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CheckCircle size={16} className="mr-2" />
          标记已验证
        </button>
      );
    }

    return null;
  };

  // Format fix suggestion with priority tags
  const formatFixSuggestion = (text: string | null) => {
    if (!text) return null;
    return text.replace(/\[([Pp][0-3])\]/g, (match, p1) => {
      const priority = p1.toUpperCase();
      const style = priorityColors[priority] || priorityColors['P3'];
      return `<span class="inline-block px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text} mx-1">${priority}</span>`;
    });
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          <button
            onClick={() => router.push('/dashboard/admin/vulnerabilities')}
            className="p-2 hover:bg-[#1E293B] rounded-lg transition-colors mt-1"
          >
            <ArrowLeft size={20} className="text-gray-400" />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
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
              {vulnerability.cwe && (
                <span className="px-2.5 py-1 rounded-full text-sm font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
                  CWE-{vulnerability.cwe}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {vulnerability.rawReport && (() => {
            const fileName = vulnerability.rawReport.split(/[/\\]/).pop() || `vulnerability-${vulnerability.id}`;
            return (
              <button
                onClick={() => {
                  const blob = new Blob([vulnerability.rawReport!], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = fileName;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  toast.success('文件已下载');
                }}
                className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                <Download size={16} className="mr-2" />
                下载漏洞文件
              </button>
            );
          })()}
          {getActionButtons()}
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Content (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* 漏洞概述 */}
          <div className="bg-[#1E293B] rounded-lg shadow border border-gray-700/50 p-6">
            <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <MessageSquare size={18} />
              漏洞概述
            </h2>
            <div className="text-gray-300 leading-relaxed whitespace-pre-wrap">
              {vulnerability.description}
            </div>
          </div>

          {/* 代码位置 */}
          {vulnerability.location && (
            <div className="bg-[#1E293B] rounded-lg shadow border border-gray-700/50 p-6">
              <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <MapPin size={18} />
                代码位置
              </h2>
              <CodeBlock code={vulnerability.location} label="代码位置" />
            </div>
          )}

          {/* PoC 验证 */}
          {vulnerability.POC && (
            <div className="bg-[#1E293B] rounded-lg shadow border border-gray-700/50 p-6">
              <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <Code size={18} />
                PoC 验证
              </h2>
              <CodeBlock code={vulnerability.POC} label="PoC 代码" />
            </div>
          )}

          {/* 修复建议 */}
          {vulnerability.fixSuggestion && (
            <div className="bg-[#1E293B] rounded-lg shadow border border-gray-700/50 p-6">
              <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <Wrench size={18} />
                修复建议
              </h2>
              <div
                className="text-gray-300 leading-relaxed whitespace-pre-wrap"
                dangerouslySetInnerHTML={{
                  __html: formatFixSuggestion(vulnerability.fixSuggestion) || vulnerability.fixSuggestion,
                }}
              />
            </div>
          )}
        </div>

        {/* Right column - Sidebar (1/3) */}
        <div className="space-y-6">
          {/* 基本信息卡片 */}
          <div className="bg-[#1E293B] rounded-lg shadow border border-gray-700/50 p-6">
            <h2 className="text-lg font-semibold text-gray-100 mb-4">基本信息</h2>
            <div className="space-y-4">
              {/* 严重度 */}
              <div>
                <label className="text-sm text-gray-500">严重度</label>
                <div className="mt-2 flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${severityStyle.dot}`} />
                  <span className={`text-sm font-medium ${severityStyle.text}`}>
                    {vulnerability.severity.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* 类型 */}
              <div>
                <label className="text-sm text-gray-500">类型</label>
                <p className="mt-2 text-sm text-gray-100 font-medium">{vulnerability.type}</p>
              </div>

              {/* CWE */}
              {vulnerability.cwe && (
                <div>
                  <label className="text-sm text-gray-500">CWE</label>
                  <p className="mt-2 text-sm text-gray-100">CWE-{vulnerability.cwe}</p>
                </div>
              )}

              {/* 状态 */}
              <div>
                <label className="text-sm text-gray-500">状态</label>
                <div className="mt-2 flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${statusStyle.dot}`} />
                  <span className={`text-sm font-medium ${statusStyle.text}`}>
                    {statusNames[vulnerability.status] || vulnerability.status}
                  </span>
                </div>
              </div>

              {/* 发现工具 */}
              {vulnerability.skill && (
                <div>
                  <label className="text-sm text-gray-500">发现工具</label>
                  <p className="mt-2 text-sm text-gray-100">{vulnerability.skill}</p>
                </div>
              )}

              {/* 关联任务 */}
              {(vulnerability.taskId || vulnerability.TaskInstance) && (
                <div>
                  <label className="text-sm text-gray-500">关联任务</label>
                  {vulnerability.TaskInstance ? (
                    <a
                      href={`/dashboard/task-builder/${vulnerability.TaskInstance.id}`}
                      className="mt-2 text-sm text-blue-400 hover:text-blue-300 hover:underline inline-flex items-center gap-1"
                    >
                      {vulnerability.TaskInstance.name}
                    </a>
                  ) : (
                    <p className="mt-2 text-sm text-gray-500">任务已删除</p>
                  )}
                </div>
              )}

              {/* 创建时间 */}
              <div>
                <label className="text-sm text-gray-500">创建时间</label>
                <p className="mt-2 text-sm text-gray-500">
                  {new Date(vulnerability.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* 处理时间线 */}
          <div className="bg-[#1E293B] rounded-lg shadow border border-gray-700/50 p-6">
            <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <Clock size={18} />
              处理时间线
            </h2>
            <div className="space-y-2">
              {/* 创建 */}
              <TimelineItem
                label="创建"
                date={vulnerability.createdAt}
                completed={true}
                isLast={!vulnerability.confirmedAt && !vulnerability.fixedAt && !vulnerability.verifiedAt}
              />

              {/* 确认 */}
              <TimelineItem
                label="确认"
                date={vulnerability.confirmedAt}
                user={vulnerability.confirmedBy}
                completed={!!vulnerability.confirmedAt}
                isLast={!vulnerability.fixedAt && !vulnerability.verifiedAt}
              />

              {/* 修复 */}
              <TimelineItem
                label="修复"
                date={vulnerability.fixedAt}
                user={vulnerability.fixedBy}
                completed={!!vulnerability.fixedAt}
                isLast={!vulnerability.verifiedAt}
              />

              {/* 验证 */}
              <TimelineItem
                label="验证"
                date={vulnerability.verifiedAt}
                user={vulnerability.verifiedBy}
                completed={!!vulnerability.verifiedAt}
                isLast={true}
              />
            </div>
          </div>

          {/* 备注 */}
          {(vulnerability.notes || vulnerability.falsePositiveReason) && (
            <div className="bg-[#1E293B] rounded-lg shadow border border-gray-700/50 p-6">
              <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                <MessageSquare size={18} />
                备注
              </h2>
              {vulnerability.falsePositiveReason ? (
                <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                  <span className="text-gray-500 font-medium">误报原因：</span>
                  {vulnerability.falsePositiveReason}
                </div>
              ) : (
                <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                  {vulnerability.notes}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VulnerabilityDetailPage() {
  return (
    <AdminGuard>
      <Suspense fallback={<PageLoading text="加载中..." />}>
        <VulnerabilityDetailContent />
      </Suspense>
    </AdminGuard>
  );
}