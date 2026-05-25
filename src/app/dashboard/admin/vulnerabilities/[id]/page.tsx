'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import NextLink from 'next/link';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Copy,
  MapPin,
  Code,
  Wrench,
  MessageSquare,
  Clock,
  User,
  Shield,
  FileCode,
  Target,
  Activity,
  Download,
  Check,
  X,
  Bug,
  Link,
  ExternalLink,
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

const severityConfig: Record<string, { color: string; bg: string; text: string; label: string }> = {
  critical: { color: '#DC2626', bg: 'bg-red-500/20', text: 'text-red-400', label: 'CRITICAL' },
  high: { color: '#EA580C', bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'HIGH' },
  medium: { color: '#CA8A04', bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'MEDIUM' },
  low: { color: '#2563EB', bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'LOW' },
  info: { color: '#6B728B', bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'INFO' },
};

const statusConfig: Record<string, { color: string; bg: string; text: string; label: string }> = {
  new: { color: '#8B5CF6', bg: 'bg-violet-500/15', text: 'text-violet-400', label: '新建' },
  confirmed: { color: '#F59E0B', bg: 'bg-amber-500/15', text: 'text-amber-400', label: '已确认' },
  'false-positive': { color: '#64748B', bg: 'bg-gray-500/15', text: 'text-gray-400', label: '误报' },
  false_positive: { color: '#64748B', bg: 'bg-gray-500/15', text: 'text-gray-400', label: '误报' },
  fixed: { color: '#10B981', bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: '已修复' },
  verified: { color: '#06B6D4', bg: 'bg-cyan-500/15', text: 'text-cyan-400', label: '已验证' },
};

const statusFlow = ['new', 'confirmed', 'fixed', 'verified'];

function InfoCard({
  icon,
  label,
  value,
  color,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  color?: string;
  href?: string;
}) {
  if (!value) return null;
  
  if (href) {
    return (
      <NextLink
        href={href}
        className="group block bg-dark-bg rounded-lg p-3 border border-indigo-500/30 bg-indigo-500/5 hover:border-indigo-500/60 hover:bg-indigo-500/10 transition-all cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-dark-text-muted">{label}</div>
            <div className="text-sm text-indigo-400 truncate mt-0.5 flex items-center gap-1.5">
              <span className="truncate">{value}</span>
              <ExternalLink size={12} className="flex-shrink-0" />
            </div>
          </div>
        </div>
      </NextLink>
    );
  }
  
  return (
    <div className="bg-dark-bg rounded-lg p-3 border border-dark-border/40 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-dark-surface-hover/50 flex items-center justify-center text-dark-text-muted">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-dark-text-muted">{label}</div>
        <div className="text-sm text-dark-text truncate mt-0.5" style={color ? { color } : {}}>
          {value}
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ code, label = '代码' }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`${label}已复制`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('复制失败');
    }
  };

  return (
    <div className="relative group">
      <pre className="text-sm bg-dark-bg text-dark-text p-4 rounded-lg overflow-x-auto whitespace-pre-wrap border border-dark-border/40 font-mono">
        {code}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-2 bg-dark-surface-hover/80 hover:bg-dark-surface-hover rounded-lg transition-colors opacity-0 group-hover:opacity-100"
        title={`复制${label}`}
      >
        {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-dark-text-secondary" />}
      </button>
    </div>
  );
}

function StatusTimeline({ vulnerability }: { vulnerability: Vulnerability }) {
  let currentIndex = statusFlow.indexOf(vulnerability.status);
  if (vulnerability.status === 'false-positive' || vulnerability.status === 'false_positive') {
    currentIndex = -1;
  }

  return (
    <div className="bg-dark-surface rounded-xl border border-dark-border/40 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Clock size={18} className="text-cyan-400" />
        <h2 className="text-base font-semibold text-dark-text">处理流程</h2>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {statusFlow.map((status, idx) => {
          const config = statusConfig[status];
          const isActive = idx <= currentIndex && currentIndex >= 0;
          const isCurrent = idx === currentIndex;
          
          return (
            <div key={status} className="flex items-center gap-2">
              <div
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? ''
                    : 'bg-dark-surface-hover/50 text-dark-text-muted'
                }`}
                style={isActive ? { backgroundColor: `${config.color}20`, color: config.color } : {}}
              >
                {config.label}
              </div>
              {idx < statusFlow.length - 1 && (
                <div className={`w-8 h-0.5 ${idx < currentIndex ? 'bg-green-500' : 'bg-dark-border'}`} />
              )}
            </div>
          );
        })}
      </div>

      {vulnerability.status === 'false-positive' || vulnerability.status === 'false_positive' ? (
        <div className="mt-4 p-3 bg-dark-surface-hover/50 rounded-lg border border-dark-border/40">
          <div className="flex items-center gap-2 text-dark-text-muted">
            <XCircle size={16} />
            <span className="text-sm font-medium">已标记为误报</span>
          </div>
          {vulnerability.falsePositiveReason && (
            <p className="text-xs text-dark-text-muted mt-2">{vulnerability.falsePositiveReason}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3 mt-4">
          <div className="flex items-center gap-3 text-sm">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-dark-text-muted">创建于</span>
            <span className="text-dark-text">{new Date(vulnerability.createdAt).toLocaleString()}</span>
          </div>
          {vulnerability.confirmedAt && (
            <div className="flex items-center gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-dark-text-muted">确认于</span>
              <span className="text-dark-text">{new Date(vulnerability.confirmedAt).toLocaleString()}</span>
              {vulnerability.confirmedBy && (
                <span className="text-dark-text-muted flex items-center gap-1">
                  <User size={12} />
                  {vulnerability.confirmedBy}
                </span>
              )}
            </div>
          )}
          {vulnerability.fixedAt && (
            <div className="flex items-center gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-dark-text-muted">修复于</span>
              <span className="text-dark-text">{new Date(vulnerability.fixedAt).toLocaleString()}</span>
              {vulnerability.fixedBy && (
                <span className="text-dark-text-muted flex items-center gap-1">
                  <User size={12} />
                  {vulnerability.fixedBy}
                </span>
              )}
            </div>
          )}
          {vulnerability.verifiedAt && (
            <div className="flex items-center gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-cyan-500" />
              <span className="text-dark-text-muted">验证于</span>
              <span className="text-dark-text">{new Date(vulnerability.verifiedAt).toLocaleString()}</span>
              {vulnerability.verifiedBy && (
                <span className="text-dark-text-muted flex items-center gap-1">
                  <User size={12} />
                  {vulnerability.verifiedBy}
                </span>
              )}
            </div>
          )}
        </div>
      )}
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
  const [showFalsePositiveModal, setShowFalsePositiveModal] = useState(false);
  const [falsePositiveReasonInput, setFalsePositiveReasonInput] = useState('');

  const fetchVulnerability = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/vulnerabilities/${vulnId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 404) throw new Error('漏洞不存在');
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

  const handleAction = async (action: string) => {
    if (!vulnerability) return;
    if (action === 'false-positive') {
      setShowFalsePositiveModal(true);
      return;
    }

    setActionLoading(action);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/vulnerabilities/${vulnId}/${action}`, {
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

      toast.success('状态更新成功');
      fetchVulnerability();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSubmitFalsePositive = async () => {
    if (!vulnerability) return;
    setActionLoading('false-positive');
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/vulnerabilities/${vulnId}/false-positive`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: falsePositiveReasonInput.trim() || null }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }

      toast.success('已标记为误报');
      setShowFalsePositiveModal(false);
      setFalsePositiveReasonInput('');
      fetchVulnerability();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <PageLoading text="加载漏洞详情..." />;
  
  if (error || !vulnerability) {
    return (
      <div className="space-y-4">
        <div className="bg-red-500/15 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertTriangle size={20} />
          <span>{error || '漏洞不存在'}</span>
        </div>
        <button
          onClick={() => router.push('/dashboard/admin/vulnerabilities')}
          className="inline-flex items-center px-4 py-2 bg-dark-surface-hover text-dark-text-secondary rounded-lg hover:bg-dark-surface-hover/80 transition-colors"
        >
          <ArrowLeft size={16} className="mr-2" />
          返回列表
        </button>
      </div>
    );
  }

  const sevConfig = severityConfig[vulnerability.severity] || severityConfig.info;
  const statConfig = statusConfig[vulnerability.status] || statusConfig.new;

  const getActionButtons = () => {
    if (vulnerability.status === 'new') {
      return (
        <>
          <button
            onClick={() => handleAction('confirm')}
            disabled={actionLoading === 'confirm'}
            className="inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-500 transition-colors disabled:opacity-50"
          >
            {actionLoading === 'confirm' && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />}
            <CheckCircle size={16} className="mr-2" />
            确认漏洞
          </button>
          <button
            onClick={() => handleAction('false-positive')}
            disabled={actionLoading === 'false-positive'}
            className="inline-flex items-center px-4 py-2 bg-dark-surface-hover text-dark-text-secondary rounded-lg hover:bg-dark-surface-hover/80 transition-colors disabled:opacity-50"
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
            className="inline-flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {actionLoading === 'fix' && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />}
            <CheckCircle size={16} className="mr-2" />
            已修复
          </button>
          <button
            onClick={() => handleAction('false-positive')}
            disabled={actionLoading === 'false-positive'}
            className="inline-flex items-center px-4 py-2 bg-dark-surface-hover text-dark-text-secondary rounded-lg hover:bg-dark-surface-hover/80 transition-colors disabled:opacity-50"
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
          className="inline-flex items-center px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors disabled:opacity-50"
        >
          {actionLoading === 'verify' && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />}
          <CheckCircle size={16} className="mr-2" />
          已验证
        </button>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Vulnerability info + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${sevConfig.color}20` }}
          >
            <Shield size={16} style={{ color: sevConfig.color }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium text-dark-text">{vulnerability.title}</h2>
              <span
                className="px-2 py-0.5 rounded text-xs font-semibold"
                style={{ backgroundColor: `${sevConfig.color}20`, color: sevConfig.color }}
              >
                {sevConfig.label}
              </span>
              <span
                className="px-2 py-0.5 rounded text-xs font-medium"
                style={{ backgroundColor: `${statConfig.color}15`, color: statConfig.color }}
              >
                {statConfig.label}
              </span>
              {vulnerability.cwe && (
                <span className="px-2 py-0.5 rounded text-xs bg-dark-surface-hover/50 text-dark-text-muted">
                  {vulnerability.cwe}
                </span>
              )}
            </div>
            <p className="text-sm text-dark-text-muted mt-0.5">{vulnerability.type}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {vulnerability.rawReport && (
            <button
              onClick={async () => {
                const rawReport = vulnerability.rawReport!;
                try {
                  let content: string;
                  let fileName: string;

                  if (rawReport.startsWith('http://') || rawReport.startsWith('https://')) {
                    toast.loading('正在下载报告...');
                    const response = await fetch(rawReport);
                    if (!response.ok) throw new Error('下载失败');
                    content = await response.text();
                    const urlPath = rawReport.split('?')[0];
                    fileName = urlPath.split('/').pop() || `vuln-${vulnerability.id}-raw-report`;
                    toast.dismiss();
                  } else {
                    content = rawReport;
                    fileName = rawReport.split(/[/\\]/).pop() || `vuln-${vulnerability.id}`;
                  }

                  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = fileName;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  toast.success('文件已下载');
                } catch (err) {
                  toast.error(`下载失败: ${err instanceof Error ? err.message : '未知错误'}`);
                }
              }}
              className="inline-flex items-center px-3 py-2 text-sm text-dark-text-secondary bg-dark-surface-hover rounded-lg hover:bg-dark-border transition-colors"
            >
              <Download size={14} className="mr-1.5" />
              下载报告
            </button>
          )}
          {getActionButtons()}
        </div>
      </div>

      {/* Info Overview - 6 cards in one row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <InfoCard
          icon={<AlertTriangle size={16} />}
          label="严重程度"
          value={sevConfig.label}
          color={sevConfig.color}
        />
        <InfoCard
          icon={<Bug size={16} />}
          label="漏洞类型"
          value={vulnerability.type}
        />
        <InfoCard
          icon={<FileCode size={16} />}
          label="CWE 编号"
          value={vulnerability.cwe}
        />
        <InfoCard
          icon={<Activity size={16} />}
          label="处理状态"
          value={statConfig.label}
          color={statConfig.color}
        />
        <InfoCard
          icon={<Target size={16} />}
          label="发现工具"
          value={vulnerability.skill}
        />
        <InfoCard
          icon={<Link size={16} />}
          label="关联任务"
          value={vulnerability.TaskInstance?.name || null}
          href={vulnerability.TaskInstance ? `/dashboard/task-builder/${vulnerability.TaskInstance.id}` : undefined}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Content (2/3) */}
        <div className="lg:col-span-2 space-y-5">
          {/* Description */}
          <div className="bg-dark-surface rounded-xl border border-dark-border/40 p-5">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare size={18} className="text-purple-400" />
              <h2 className="text-base font-semibold text-dark-text">漏洞概述</h2>
            </div>
            <div className="text-dark-text-secondary leading-relaxed whitespace-pre-wrap text-sm">
              {vulnerability.description}
            </div>
          </div>

          {/* Location */}
          {vulnerability.location && (
            <div className="bg-dark-surface rounded-xl border border-dark-border/40 p-5">
              <div className="flex items-center gap-2 mb-4">
                <MapPin size={18} className="text-rose-400" />
                <h2 className="text-base font-semibold text-dark-text">代码位置</h2>
              </div>
              <CodeBlock code={vulnerability.location} label="代码位置" />
            </div>
          )}

          {/* POC */}
          {vulnerability.POC && (
            <div className="bg-dark-surface rounded-xl border border-dark-border/40 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Code size={18} className="text-cyan-400" />
                <h2 className="text-base font-semibold text-dark-text">PoC 验证</h2>
              </div>
              <CodeBlock code={vulnerability.POC} label="PoC 代码" />
            </div>
          )}

          {/* Fix Suggestion */}
          {vulnerability.fixSuggestion && (
            <div className="bg-dark-surface rounded-xl border border-dark-border/40 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Wrench size={18} className="text-emerald-400" />
                <h2 className="text-base font-semibold text-dark-text">修复建议</h2>
              </div>
              <div className="text-dark-text-secondary leading-relaxed whitespace-pre-wrap text-sm">
                {vulnerability.fixSuggestion}
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Sidebar (1/3) */}
        <div className="space-y-5">
          <StatusTimeline vulnerability={vulnerability} />

          {vulnerability.notes && (
            <div className="bg-dark-surface rounded-xl border border-dark-border/40 p-5">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare size={18} className="text-dark-text-muted" />
                <h2 className="text-base font-semibold text-dark-text">备注</h2>
              </div>
              <div className="text-sm text-dark-text-secondary leading-relaxed whitespace-pre-wrap">
                {vulnerability.notes}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* False Positive Modal */}
      {showFalsePositiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-dark-surface rounded-xl border border-dark-border p-5 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <XCircle size={18} className="text-dark-text-muted" />
                <h3 className="text-base font-semibold text-dark-text">标记为误报</h3>
              </div>
              <button
                onClick={() => {
                  setShowFalsePositiveModal(false);
                  setFalsePositiveReasonInput('');
                }}
                className="p-1.5 hover:bg-dark-surface-hover rounded-lg text-dark-text-muted hover:text-dark-text transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-dark-text-muted mb-3">
              请输入误报原因（可选）
            </p>
            <textarea
              value={falsePositiveReasonInput}
              onChange={(e) => setFalsePositiveReasonInput(e.target.value)}
              placeholder="例如：该代码已进行输入验证，不存在漏洞..."
              className="w-full px-3 py-2.5 bg-dark-bg border border-dark-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm text-dark-text placeholder-dark-text-muted resize-none"
              rows={4}
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowFalsePositiveModal(false);
                  setFalsePositiveReasonInput('');
                }}
                className="px-4 py-2 text-dark-text-secondary bg-dark-surface-hover rounded-lg hover:bg-dark-surface-hover/80 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmitFalsePositive}
                disabled={actionLoading === 'false-positive'}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading === 'false-positive' && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                确认标记
              </button>
            </div>
          </div>
        </div>
      )}
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