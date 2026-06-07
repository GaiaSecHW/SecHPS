'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bug,
  Check,
  CheckCircle,
  Clock,
  Code,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  Files,
  Fingerprint,
  GitBranch,
  Link,
  MapPin,
  MessageSquare,
  Shield,
  Target,
  User,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminGuard } from '@/components/PermissionGuard';
import { PageLoading } from '@/components/ui/LoadingSpinner';

type VulnerabilityTab = 'overview' | 'report' | 'evidence' | 'history' | 'context' | 'raw';

interface VulnerabilityDetail {
  id: string;
  projectId: string | null;
  evaluationId: string | null;
  skillExecutionId: string | null;
  title: string;
  description: string;
  type: string;
  findingKind?: 'vulnerability' | 'suspicion';
  cwe: string | null;
  cve?: string | null;
  owasp?: string | null;
  severity: string;
  confidence?: number | null;
  skill: string | null;
  engineName?: string | null;
  source?: string | null;
  fingerprint?: string | null;
  impact?: string | null;
  attackVector?: string | null;
  triggerCondition?: string | null;
  verificationConclusion?: string | null;
  location: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  functionName?: string | null;
  language?: string | null;
  codeSnippet?: string | null;
  POC: string | null;
  vulnerable: boolean | null;
  fixSuggestion: string | null;
  reportSummary?: Record<string, unknown> | string | null;
  evidence?: Array<Record<string, unknown>>;
  trace?: Array<Record<string, unknown>>;
  references?: Array<Record<string, unknown>>;
  standards?: string[];
  rawReport: {
    hasRawReport: boolean;
    files: { name: string; contentType?: string | null }[];
    rawReportUrls?: string[];
  } | null;
  filePath: string | null;
  repoUrl?: string | null;
  branch?: string | null;
  commitSha?: string | null;
  buildId?: string | null;
  scanAt?: string | null;
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
  categoryLabel?: string | null;
  patternName?: string | null;
  Project?: {
    id: string;
    name: string;
    userId?: string;
  } | null;
  TaskInstance?: {
    id: string;
    name: string;
  } | null;
}

const severityConfig: Record<string, { color: string; label: string }> = {
  critical: { color: '#DC2626', label: 'CRITICAL' },
  high: { color: '#EA580C', label: 'HIGH' },
  medium: { color: '#CA8A04', label: 'MEDIUM' },
  low: { color: '#2563EB', label: 'LOW' },
  info: { color: '#6B728B', label: 'INFO' },
};

const statusConfig: Record<string, { color: string; label: string }> = {
  new: { color: '#8B5CF6', label: '新建' },
  confirmed: { color: '#F59E0B', label: '已确认' },
  'false-positive': { color: '#64748B', label: '误报' },
  false_positive: { color: '#64748B', label: '误报' },
  fixed: { color: '#10B981', label: '已修复' },
  verified: { color: '#06B6D4', label: '已验证' },
};

const statusFlow = ['new', 'confirmed', 'fixed', 'verified'];

const tabs: Array<{ id: VulnerabilityTab; label: string }> = [
  { id: 'overview', label: '漏洞总览' },
  { id: 'report', label: '漏洞报告' },
  { id: 'evidence', label: '证据与定位' },
  { id: 'history', label: '处置记录' },
  { id: 'context', label: '关联上下文' },
  { id: 'raw', label: '原始数据' },
];

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-dark-surface rounded-xl border border-gray-700/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-base font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-700/60 bg-dark-bg/60 px-4 py-8 text-center text-sm text-gray-400">
      {text}
    </div>
  );
}

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
      <a
        href={href}
        className="group block bg-dark-bg rounded-lg p-3 border border-blue-500/30 bg-blue-500/5 hover:border-blue-500/60 hover:bg-blue-500/10 transition-all cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-sm text-blue-400 truncate mt-0.5 flex items-center gap-1.5">
              <span className="truncate">{value}</span>
              <ExternalLink size={12} className="flex-shrink-0" />
            </div>
          </div>
        </div>
      </a>
    );
  }

  return (
    <div className="bg-dark-bg rounded-lg p-3 border border-gray-700/30 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-gray-700/50 flex items-center justify-center text-gray-400">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-sm text-white truncate mt-0.5" style={color ? { color } : {}}>
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
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <div className="relative group">
      <pre className="text-sm bg-[#0B1120] text-gray-100 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap border border-gray-700/30 font-mono">
        {code}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-2 bg-gray-700/80 hover:bg-gray-600 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
        title={`复制${label}`}
      >
        {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-gray-300" />}
      </button>
    </div>
  );
}

function StatusTimeline({ vulnerability }: { vulnerability: VulnerabilityDetail }) {
  let currentIndex = statusFlow.indexOf(vulnerability.status);
  if (vulnerability.status === 'false-positive' || vulnerability.status === 'false_positive') {
    currentIndex = -1;
  }

  return (
    <SectionCard title="处理流程" icon={<Clock size={18} className="text-cyan-400" />}>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {statusFlow.map((status, idx) => {
          const config = statusConfig[status];
          const isActive = idx <= currentIndex && currentIndex >= 0;

          return (
            <div key={status} className="flex items-center gap-2">
              <div
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive ? '' : 'bg-gray-700/30 text-gray-500'
                }`}
                style={isActive ? { backgroundColor: `${config.color}20`, color: config.color } : {}}
              >
                {config.label}
              </div>
              {idx < statusFlow.length - 1 && (
                <div className={`w-8 h-0.5 ${idx < currentIndex ? 'bg-green-500' : 'bg-gray-700'}`} />
              )}
            </div>
          );
        })}
      </div>

      {vulnerability.status === 'false-positive' || vulnerability.status === 'false_positive' ? (
        <div className="p-3 bg-gray-500/10 rounded-lg border border-gray-500/30">
          <div className="flex items-center gap-2 text-gray-400">
            <XCircle size={16} />
            <span className="text-sm font-medium">已标记为误报</span>
          </div>
          {vulnerability.falsePositiveReason && (
            <p className="text-xs text-gray-500 mt-2">{vulnerability.falsePositiveReason}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <TimelineItem color="bg-green-500" label="创建于" time={vulnerability.createdAt} />
          <TimelineItem color="bg-amber-500" label="确认于" time={vulnerability.confirmedAt} user={vulnerability.confirmedBy} />
          <TimelineItem color="bg-emerald-500" label="修复于" time={vulnerability.fixedAt} user={vulnerability.fixedBy} />
          <TimelineItem color="bg-cyan-500" label="验证于" time={vulnerability.verifiedAt} user={vulnerability.verifiedBy} />
        </div>
      )}
    </SectionCard>
  );
}

function TimelineItem({
  color,
  label,
  time,
  user,
}: {
  color: string;
  label: string;
  time: string | null;
  user?: string | null;
}) {
  if (!time) return null;

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-gray-500">{label}</span>
      <span className="text-white">{new Date(time).toLocaleString()}</span>
      {user && (
        <span className="text-gray-400 flex items-center gap-1">
          <User size={12} />
          {user}
        </span>
      )}
    </div>
  );
}

function JsonPreview({ data }: { data: unknown }) {
  return <CodeBlock code={JSON.stringify(data, null, 2)} label="JSON" />;
}

function VulnerabilityDetailContent() {
  const params = useParams();
  const router = useRouter();
  const vulnId = params.id as string;

  const [vulnerability, setVulnerability] = useState<VulnerabilityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showFalsePositiveModal, setShowFalsePositiveModal] = useState(false);
  const [falsePositiveReasonInput, setFalsePositiveReasonInput] = useState('');
  const [activeTab, setActiveTab] = useState<VulnerabilityTab>('overview');

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

  const downloadRawReports = async () => {
    if (!vulnerability?.rawReport?.hasRawReport) return;

    try {
      toast.loading('正在下载漏洞文件...');
      const token = localStorage.getItem('token');
      const files = vulnerability.rawReport.files;
      for (let i = 0; i < files.length; i++) {
        const response = await fetch(`/api/vulnerabilities/${vulnId}/download-raw-report?index=${i}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('下载失败');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = files[i].name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      toast.dismiss();
      toast.success('文件已下载');
    } catch (err) {
      toast.dismiss();
      toast.error(`下载失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

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

  const getActionButtons = () => {
    if (!vulnerability) return null;

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
            className="inline-flex items-center px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
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
            className="inline-flex items-center px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
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

  const overviewCards = useMemo(() => {
    if (!vulnerability) return null;

    const findingKindLabel = vulnerability.findingKind === 'suspicion' ? '疑点' : '漏洞';
    const confidenceText = vulnerability.confidence != null ? `${vulnerability.confidence}` : null;

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <InfoCard icon={<AlertTriangle size={16} />} label="严重程度" value={severityConfig[vulnerability.severity]?.label || vulnerability.severity} color={severityConfig[vulnerability.severity]?.color} />
        <InfoCard icon={<Bug size={16} />} label="发现类型" value={findingKindLabel} />
        <InfoCard icon={<Activity size={16} />} label="处理状态" value={statusConfig[vulnerability.status]?.label || vulnerability.status} color={statusConfig[vulnerability.status]?.color} />
        <InfoCard icon={<FileCode size={16} />} label="CWE 编号" value={vulnerability.cwe} />
        <InfoCard icon={<Target size={16} />} label="置信度" value={confidenceText} />
        <InfoCard
          icon={<Link size={16} />}
          label="关联任务"
          value={vulnerability.TaskInstance?.name || null}
          href={vulnerability.TaskInstance ? `/dashboard/task-builder/${vulnerability.TaskInstance.id}` : undefined}
        />
      </div>
    );
  }, [vulnerability]);

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
          className="inline-flex items-center px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
        >
          <ArrowLeft size={16} className="mr-2" />
          返回列表
        </button>
      </div>
    );
  }

  const sevConfig = severityConfig[vulnerability.severity] || severityConfig.info;
  const statConfig = statusConfig[vulnerability.status] || statusConfig.new;
  const findingKindLabel = vulnerability.findingKind === 'suspicion' ? '疑点' : '漏洞';

  const renderOverviewTab = () => (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <div className="space-y-5">
        <SectionCard title="漏洞概述" icon={<MessageSquare size={18} className="text-purple-400" />}>
          <div className="space-y-4 text-sm text-gray-300 leading-relaxed">
            <p className="whitespace-pre-wrap">{vulnerability.description}</p>
            {!vulnerability.description && <EmptyState text="暂无漏洞描述" />}
          </div>
        </SectionCard>

        <SectionCard title="研判摘要" icon={<Shield size={18} className="text-rose-400" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoCard icon={<Bug size={16} />} label="对象类型" value={findingKindLabel} />
            <InfoCard icon={<Target size={16} />} label="置信度" value={vulnerability.confidence != null ? `${vulnerability.confidence}` : null} />
            <InfoCard icon={<FileCode size={16} />} label="CVE 编号" value={vulnerability.cve || null} />
            <InfoCard icon={<Files size={16} />} label="漏洞模式" value={vulnerability.patternName || null} />
          </div>
          <div className="mt-4 space-y-3 text-sm text-gray-300">
            {vulnerability.impact && <p><span className="text-gray-500">影响范围：</span>{vulnerability.impact}</p>}
            {vulnerability.attackVector && <p><span className="text-gray-500">攻击向量：</span>{vulnerability.attackVector}</p>}
            {vulnerability.triggerCondition && <p><span className="text-gray-500">触发条件：</span>{vulnerability.triggerCondition}</p>}
            {vulnerability.verificationConclusion && <p><span className="text-gray-500">验证结论：</span>{vulnerability.verificationConclusion}</p>}
            {!vulnerability.impact && !vulnerability.attackVector && !vulnerability.triggerCondition && !vulnerability.verificationConclusion && (
              <EmptyState text="当前漏洞没有结构化研判摘要" />
            )}
          </div>
        </SectionCard>

        <SectionCard title="修复建议" icon={<Wrench size={18} className="text-emerald-400" />}>
          {vulnerability.fixSuggestion ? (
            <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{vulnerability.fixSuggestion}</div>
          ) : (
            <EmptyState text="暂无修复建议" />
          )}
        </SectionCard>
      </div>

      <div className="space-y-5">
        <StatusTimeline vulnerability={vulnerability} />
        <SectionCard title="关键定位" icon={<MapPin size={18} className="text-cyan-400" />}>
          <div className="space-y-3 text-sm">
            <p className="text-gray-300"><span className="text-gray-500">文件：</span>{vulnerability.filePath || '未提供'}</p>
            <p className="text-gray-300"><span className="text-gray-500">函数：</span>{vulnerability.functionName || '未提供'}</p>
            <p className="text-gray-300"><span className="text-gray-500">行号：</span>{vulnerability.lineStart != null ? `${vulnerability.lineStart}${vulnerability.lineEnd && vulnerability.lineEnd !== vulnerability.lineStart ? ` - ${vulnerability.lineEnd}` : ''}` : '未提供'}</p>
            <p className="text-gray-300"><span className="text-gray-500">语言：</span>{vulnerability.language || '未提供'}</p>
          </div>
        </SectionCard>
      </div>
    </div>
  );

  const renderReportTab = () => (
    <div className="space-y-5">
      <SectionCard title="报告摘要" icon={<Files size={18} className="text-blue-400" />}>
        {vulnerability.reportSummary ? (
          typeof vulnerability.reportSummary === 'string' ? (
            <CodeBlock code={vulnerability.reportSummary} label="报告摘要" />
          ) : (
            <JsonPreview data={vulnerability.reportSummary} />
          )
        ) : (
          <EmptyState text="当前漏洞没有结构化报告摘要" />
        )}
      </SectionCard>

      <SectionCard title="原始报告附件" icon={<Download size={18} className="text-amber-400" />}>
        {vulnerability.rawReport?.hasRawReport ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <button
                onClick={downloadRawReports}
                className="inline-flex items-center px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
              >
                <Download size={16} className="mr-2" />
                下载全部附件 ({vulnerability.rawReport.files.length})
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {vulnerability.rawReport.files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="rounded-lg border border-gray-700/40 bg-dark-bg px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{file.name}</p>
                    <p className="text-xs text-gray-500">{file.contentType || '未知类型'}</p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const token = localStorage.getItem('token');
                        const response = await fetch(`/api/vulnerabilities/${vulnId}/download-raw-report?index=${index}`, {
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        if (!response.ok) throw new Error('下载失败');
                        const blob = await response.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = blobUrl;
                        link.download = file.name;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(blobUrl);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : '下载失败');
                      }
                    }}
                    className="px-3 py-1.5 rounded-md bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 transition-colors text-sm"
                  >
                    下载
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState text="当前漏洞没有原始报告附件" />
        )}
      </SectionCard>
    </div>
  );

  const renderEvidenceTab = () => (
    <div className="space-y-5">
      <SectionCard title="代码定位" icon={<MapPin size={18} className="text-rose-400" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <InfoCard icon={<FileCode size={16} />} label="文件路径" value={vulnerability.filePath} />
          <InfoCard icon={<Code size={16} />} label="函数名" value={vulnerability.functionName || null} />
          <InfoCard icon={<Activity size={16} />} label="行号范围" value={vulnerability.lineStart != null ? `${vulnerability.lineStart}${vulnerability.lineEnd && vulnerability.lineEnd !== vulnerability.lineStart ? ` - ${vulnerability.lineEnd}` : ''}` : null} />
          <InfoCard icon={<Bug size={16} />} label="语言" value={vulnerability.language || null} />
        </div>
        {vulnerability.codeSnippet ? <CodeBlock code={vulnerability.codeSnippet} label="代码片段" /> : <EmptyState text="暂无结构化代码片段" />}
      </SectionCard>

      <SectionCard title="原始定位文本" icon={<MapPin size={18} className="text-cyan-400" />}>
        {vulnerability.location ? <CodeBlock code={vulnerability.location} label="代码位置" /> : <EmptyState text="暂无定位文本" />}
      </SectionCard>

      <SectionCard title="PoC 与证据" icon={<AlertTriangle size={18} className="text-orange-400" />}>
        <div className="space-y-4">
          {vulnerability.POC ? <CodeBlock code={vulnerability.POC} label="PoC 代码" /> : <EmptyState text="暂无 PoC 信息" />}
          {vulnerability.evidence && vulnerability.evidence.length > 0 ? (
            <div className="space-y-3">
              {vulnerability.evidence.map((item, index) => (
                <div key={index} className="rounded-lg border border-gray-700/40 bg-dark-bg px-4 py-3">
                  <div className="text-sm text-white">{String(item.title || item.type || `证据 ${index + 1}`)}</div>
                  <div className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{String(item.summary || item.location || item.description || '') || '无摘要'}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="当前引擎未提供结构化证据，仅保留原始定位信息" />
          )}
        </div>
      </SectionCard>

      <SectionCard title="调用链 / 数据流" icon={<Link size={18} className="text-violet-400" />}>
        {vulnerability.trace && vulnerability.trace.length > 0 ? (
          <div className="space-y-3">
            {vulnerability.trace.map((step, index) => (
              <div key={index} className="rounded-lg border border-gray-700/40 bg-dark-bg px-4 py-3">
                <div className="text-sm text-white">{String(step.title || step.functionName || `Trace ${index + 1}`)}</div>
                <div className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">
                  {String(step.description || step.filePath || step.type || '') || '无描述'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="当前漏洞没有结构化调用链或数据流信息" />
        )}
      </SectionCard>
    </div>
  );

  const renderHistoryTab = () => (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <div className="space-y-5">
        <StatusTimeline vulnerability={vulnerability} />
        <SectionCard title="状态说明" icon={<MessageSquare size={18} className="text-gray-300" />}>
          <div className="space-y-4 text-sm text-gray-300">
            {vulnerability.falsePositiveReason && (
              <p><span className="text-gray-500">误报原因：</span>{vulnerability.falsePositiveReason}</p>
            )}
            {vulnerability.verificationConclusion && (
              <p><span className="text-gray-500">验证结论：</span>{vulnerability.verificationConclusion}</p>
            )}
            {!vulnerability.falsePositiveReason && !vulnerability.verificationConclusion && (
              <EmptyState text="暂无额外处置说明" />
            )}
          </div>
        </SectionCard>
      </div>

      <div className="space-y-5">
        <SectionCard title="备注" icon={<MessageSquare size={18} className="text-cyan-400" />}>
          {vulnerability.notes ? (
            <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{vulnerability.notes}</div>
          ) : (
            <EmptyState text="暂无备注" />
          )}
        </SectionCard>
      </div>
    </div>
  );

  const renderContextTab = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <SectionCard title="业务归属" icon={<Shield size={18} className="text-blue-400" />}>
        <div className="space-y-3 text-sm text-gray-300">
          <p><span className="text-gray-500">项目：</span>{vulnerability.Project?.name || vulnerability.projectId || '未提供'}</p>
          <p><span className="text-gray-500">任务：</span>{vulnerability.TaskInstance?.name || vulnerability.taskId || '未提供'}</p>
          <p><span className="text-gray-500">评估：</span>{vulnerability.evaluationId || '未提供'}</p>
          <p><span className="text-gray-500">Skill 执行：</span>{vulnerability.skillExecutionId || '未提供'}</p>
          <p><span className="text-gray-500">发现引擎：</span>{vulnerability.engineName || vulnerability.skill || '未提供'}</p>
          <p><span className="text-gray-500">来源：</span>{vulnerability.source || '未提供'}</p>
        </div>
      </SectionCard>

      <SectionCard title="扫描上下文" icon={<GitBranch size={18} className="text-emerald-400" />}>
        <div className="space-y-3 text-sm text-gray-300">
          <p><span className="text-gray-500">仓库：</span>{vulnerability.repoUrl || '未提供'}</p>
          <p><span className="text-gray-500">分支：</span>{vulnerability.branch || '未提供'}</p>
          <p><span className="text-gray-500">提交：</span>{vulnerability.commitSha || '未提供'}</p>
          <p><span className="text-gray-500">构建：</span>{vulnerability.buildId || '未提供'}</p>
          <p><span className="text-gray-500">扫描时间：</span>{vulnerability.scanAt ? new Date(vulnerability.scanAt).toLocaleString() : '未提供'}</p>
          <p><span className="text-gray-500">指纹：</span>{vulnerability.fingerprint || '未提供'}</p>
        </div>
      </SectionCard>

      <SectionCard title="分类关联" icon={<Fingerprint size={18} className="text-violet-400" />}>
        <div className="space-y-3 text-sm text-gray-300">
          <p><span className="text-gray-500">分类：</span>{vulnerability.categoryLabel || '未提供'}</p>
          <p><span className="text-gray-500">模式：</span>{vulnerability.patternName || '未提供'}</p>
          <p><span className="text-gray-500">OWASP：</span>{vulnerability.owasp || '未提供'}</p>
          <p><span className="text-gray-500">标准映射：</span>{vulnerability.standards && vulnerability.standards.length > 0 ? vulnerability.standards.join(', ') : '未提供'}</p>
        </div>
      </SectionCard>

      <SectionCard title="外部参考" icon={<ExternalLink size={18} className="text-amber-400" />}>
        {vulnerability.references && vulnerability.references.length > 0 ? (
          <div className="space-y-3">
            {vulnerability.references.map((reference, index) => (
              <div key={index} className="rounded-lg border border-gray-700/40 bg-dark-bg px-4 py-3">
                <p className="text-sm text-white">{String(reference.title || reference.type || `参考 ${index + 1}`)}</p>
                <p className="text-xs text-gray-400 mt-1 break-all">{String(reference.url || reference.description || '') || '无链接'}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="暂无外部参考信息" />
        )}
      </SectionCard>
    </div>
  );

  const renderRawTab = () => (
    <div className="space-y-5">
      <SectionCard title="完整详情 JSON" icon={<Code size={18} className="text-cyan-400" />}>
        <JsonPreview data={vulnerability} />
      </SectionCard>

      <SectionCard title="原始报告链接" icon={<Download size={18} className="text-blue-400" />}>
        {vulnerability.rawReport?.rawReportUrls && vulnerability.rawReport.rawReportUrls.length > 0 ? (
          <CodeBlock code={vulnerability.rawReport.rawReportUrls.join('\n')} label="原始报告链接" />
        ) : (
          <EmptyState text="当前漏洞没有原始报告 URL 列表" />
        )}
      </SectionCard>
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-start gap-4">
            <button
              onClick={() => router.push('/dashboard/admin/vulnerabilities')}
              className="p-2 hover:bg-dark-bg rounded-lg transition-colors"
            >
              <ArrowLeft size={18} className="text-gray-400" />
            </button>

            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${sevConfig.color}20` }}
              >
                <Shield size={18} style={{ color: sevConfig.color }} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-semibold text-white">{vulnerability.title}</h1>
                  <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ backgroundColor: `${sevConfig.color}20`, color: sevConfig.color }}>
                    {sevConfig.label}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: `${statConfig.color}15`, color: statConfig.color }}>
                    {statConfig.label}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs bg-gray-700/50 text-gray-300">
                    {findingKindLabel}
                  </span>
                  {vulnerability.cwe && (
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-700/50 text-gray-400">
                      {vulnerability.cwe}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">{vulnerability.type}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {vulnerability.rawReport?.hasRawReport && (
              <button
                onClick={downloadRawReports}
                className="inline-flex items-center px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
              >
                <Download size={16} className="mr-2" />
                下载漏洞文件 ({vulnerability.rawReport.files.length})
              </button>
            )}
            {getActionButtons()}
          </div>
        </div>
      </header>

      {overviewCards}

      <div className="bg-dark-surface border border-gray-700/50 rounded-xl p-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map(tab => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-gray-400 hover:text-white hover:bg-dark-bg'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'overview' && renderOverviewTab()}
      {activeTab === 'report' && renderReportTab()}
      {activeTab === 'evidence' && renderEvidenceTab()}
      {activeTab === 'history' && renderHistoryTab()}
      {activeTab === 'context' && renderContextTab()}
      {activeTab === 'raw' && renderRawTab()}

      {showFalsePositiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-dark-surface rounded-xl border border-gray-700/50 p-5 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <XCircle size={18} className="text-gray-400" />
                <h3 className="text-base font-semibold text-white">标记为误报</h3>
              </div>
              <button
                onClick={() => {
                  setShowFalsePositiveModal(false);
                  setFalsePositiveReasonInput('');
                }}
                className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-3">请输入误报原因（可选）</p>
            <textarea
              value={falsePositiveReasonInput}
              onChange={e => setFalsePositiveReasonInput(e.target.value)}
              placeholder="例如：该代码已进行输入验证，不存在漏洞..."
              className="w-full px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-white resize-none"
              rows={4}
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowFalsePositiveModal(false);
                  setFalsePositiveReasonInput('');
                }}
                className="px-4 py-2 text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmitFalsePositive}
                disabled={actionLoading === 'false-positive'}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-colors disabled:opacity-50 flex items-center gap-2"
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
