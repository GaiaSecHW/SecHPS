'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Server,
  Shield,
  Key,
  GitBranch,
  Database,
  Globe,
  Lock,
  Unlock,
} from 'lucide-react';

interface AnalysisReport {
  id: string;
  evaluationId: string;
  projectId: string;
  projectOverview: {
    projectName: string;
    description: string;
    techStack: string[];
  };
  architecture: {
    projectType: string;
    frontend?: string;
    backend?: string;
    database?: string;
    directoryStructure?: Record<string, string>;
    summary: string;
  };
  entryPoints: {
    apiEndpoints: Array<{
      method: string;
      path: string;
      auth: string;
      description?: string;
    }>;
    pageEntries: Array<{
      path: string;
      description: string;
      authRequired?: boolean;
    }>;
    userInputPoints: Array<{
      location: string;
      fields: string[];
      type?: string;
    }>;
    summary?: string;
  };
  authentication: {
    authType: string;
    tokenStorage?: string;
    tokenExpiry?: string;
    refreshMechanism?: string;
    authzModel?: string;
    roles?: string[];
    securityConfig?: Record<string, any>;
    summary: string;
  };
  analyzedAt: string | null;
  createdAt: string;
}

interface SkillExecution {
  id: string;
  skillId: string;
  skillName?: string;
  skillDisplayName?: string;
  skillSeverity?: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  findingsCount: number;
  error?: string;
}

interface VulnerabilityChain {
  categoryId: string | null;
  categoryName: string;
  patternId: string | null;
  patternName: string;
  skills: Array<{
    skillId: string;
    skillName: string;
    skillDisplayName: string;
    skillSeverity: string | null;
    executed: boolean;
  }>;
}

interface VulnerabilitySummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  open: number;
  confirmed: number;
  fixed: number;
  falsePositive: number;
}

interface EvaluationReport {
  evaluation: {
    id: string;
    projectId: string;
    projectName: string;
    workflowName: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    endReason?: string;
    endMessage?: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    duration?: number;
  };
  analysisReport: AnalysisReport | null;
  skillExecutions: SkillExecution[];
  skillsStats: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    totalFindings: number;
  };
  vulnerabilityChain: VulnerabilityChain[];
  vulnerabilitySummary: VulnerabilitySummary;
}

export default function EvaluationReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const resolvedParams = use(params);
  const evaluationId = resolvedParams.id;

  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overview', 'skills']));

  useEffect(() => {
    fetchReport();
  }, [evaluationId]);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/evaluations/${evaluationId}/report`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取报告失败');
      }

      const data = await response.json();
      setReport(data);
    } catch (err) {
      console.error('Fetch report error:', err);
      setError(err instanceof Error ? err.message : '获取报告失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes) return '-';
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} 小时 ${mins} 分钟`;
  };

  const getSeverityColor = (severity?: string | null) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'info':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
      default:
        return <div className="h-4 w-4 rounded-full bg-gray-300" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">加载失败</h2>
          <p className="text-gray-600 mb-4">{error || '未找到报告'}</p>
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

  const { evaluation, analysisReport, skillExecutions, skillsStats, vulnerabilityChain, vulnerabilitySummary } = report;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.back()}
              className="text-gray-400 hover:text-gray-600"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 flex items-center">
                <FileText className="mr-2" size={24} />
                评估报告
              </h1>
              <p className="text-sm text-gray-500">{evaluation.projectName}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded border border-gray-200">
              <Download size={16} />
              <span>下载 JSON</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* 1. 项目概况 */}
        <Section
          title="项目概况"
          icon={<Globe className="h-5 w-5" />}
          expanded={expandedSections.has('overview')}
          onToggle={() => toggleSection('overview')}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoItem label="项目名称" value={analysisReport?.projectOverview?.projectName || evaluation.projectName} />
            <InfoItem label="工作流" value={evaluation.workflowName} />
            <InfoItem label="评估状态" value={evaluation.status === 'completed' ? '已完成' : evaluation.status === 'failed' ? '失败' : '运行中'} />
            <InfoItem label="运行时长" value={formatDuration(evaluation.duration)} />
            <InfoItem label="启动时间" value={new Date(evaluation.startedAt).toLocaleString('zh-CN')} />
            <InfoItem label="完成时间" value={evaluation.completedAt ? new Date(evaluation.completedAt).toLocaleString('zh-CN') : '-'} />
            <InfoItem label="输入 Token" value={evaluation.totalInputTokens?.toLocaleString() || '-'} />
            <InfoItem label="输出 Token" value={evaluation.totalOutputTokens?.toLocaleString() || '-'} />
          </div>
          
          {analysisReport?.projectOverview?.description && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <h4 className="text-sm font-medium text-gray-700 mb-2">项目描述</h4>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">
                {analysisReport.projectOverview.description}
              </p>
            </div>
          )}

          {analysisReport?.projectOverview?.techStack && analysisReport.projectOverview.techStack.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <h4 className="text-sm font-medium text-gray-700 mb-2">技术栈</h4>
              <div className="flex flex-wrap gap-2">
                {analysisReport.projectOverview.techStack.map((tech, i) => (
                  <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded">
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* 2. 项目架构分析 */}
        <Section
          title="项目架构分析"
          icon={<Server className="h-5 w-5" />}
          expanded={expandedSections.has('architecture')}
          onToggle={() => toggleSection('architecture')}
        >
          {analysisReport?.architecture ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <InfoItem label="项目类型" value={analysisReport.architecture.projectType || '-'} />
                <InfoItem label="前端技术" value={analysisReport.architecture.frontend || '-'} />
                <InfoItem label="后端技术" value={analysisReport.architecture.backend || '-'} />
                <InfoItem label="数据库" value={analysisReport.architecture.database || '-'} />
              </div>

              {analysisReport.architecture.directoryStructure && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">目录结构</h4>
                  <div className="bg-gray-50 rounded p-3 font-mono text-xs space-y-1">
                    {Object.entries(analysisReport.architecture.directoryStructure).map(([dir, desc]) => (
                      <div key={dir} className="flex">
                        <span className="text-blue-600 w-48">{dir}</span>
                        <span className="text-gray-500">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysisReport.architecture.summary && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">架构概述</h4>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">
                    {analysisReport.architecture.summary}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">暂无架构分析数据</p>
          )}
        </Section>

        {/* 3. 入口点分析 */}
        <Section
          title="入口点分析"
          icon={<GitBranch className="h-5 w-5" />}
          expanded={expandedSections.has('entrypoints')}
          onToggle={() => toggleSection('entrypoints')}
        >
          {analysisReport?.entryPoints ? (
            <div className="space-y-4">
              {/* API 端点 */}
              {analysisReport.entryPoints.apiEndpoints && analysisReport.entryPoints.apiEndpoints.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">
                    API 端点 ({analysisReport.entryPoints.apiEndpoints.length} 个)
                  </h4>
                  <div className="bg-gray-50 rounded overflow-hidden">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">方法</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">路径</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">认证</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">描述</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {analysisReport.entryPoints.apiEndpoints.map((endpoint, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                endpoint.method === 'GET' ? 'bg-green-100 text-green-700' :
                                endpoint.method === 'POST' ? 'bg-blue-100 text-blue-700' :
                                endpoint.method === 'PUT' ? 'bg-yellow-100 text-yellow-700' :
                                endpoint.method === 'DELETE' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {endpoint.method}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-gray-700">{endpoint.path}</td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                endpoint.auth === 'public' ? 'bg-green-50 text-green-600' :
                                endpoint.auth === 'admin' ? 'bg-red-50 text-red-600' :
                                'bg-yellow-50 text-yellow-600'
                              }`}>
                                {endpoint.auth === 'public' ? '公开' : endpoint.auth === 'admin' ? '管理员' : '需认证'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-500">{endpoint.description || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 用户输入点 */}
              {analysisReport.entryPoints.userInputPoints && analysisReport.entryPoints.userInputPoints.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">
                    用户输入点 ({analysisReport.entryPoints.userInputPoints.length} 个)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {analysisReport.entryPoints.userInputPoints.map((input, i) => (
                      <div key={i} className="bg-gray-50 rounded p-3">
                        <div className="font-medium text-gray-700">{input.location}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          字段: {input.fields.join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">暂无入口点分析数据</p>
          )}
        </Section>

        {/* 4. 认证鉴权分析 */}
        <Section
          title="认证鉴权分析"
          icon={<Key className="h-5 w-5" />}
          expanded={expandedSections.has('auth')}
          onToggle={() => toggleSection('auth')}
        >
          {analysisReport?.authentication ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <InfoItem label="认证方式" value={analysisReport.authentication.authType || '-'} />
                <InfoItem label="Token 存储" value={analysisReport.authentication.tokenStorage || '-'} />
                <InfoItem label="Token 过期" value={analysisReport.authentication.tokenExpiry || '-'} />
                <InfoItem label="鉴权模型" value={analysisReport.authentication.authzModel || '-'} />
              </div>

              {analysisReport.authentication.roles && analysisReport.authentication.roles.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">角色列表</h4>
                  <div className="flex flex-wrap gap-2">
                    {analysisReport.authentication.roles.map((role, i) => (
                      <span key={i} className="px-2 py-1 bg-purple-50 text-purple-700 text-xs rounded">
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {analysisReport.authentication.securityConfig && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">安全配置</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <SecurityBadge label="HTTPS" value={analysisReport.authentication.securityConfig.https} />
                    <SecurityBadge label="CORS" value={analysisReport.authentication.securityConfig.cors} />
                    <SecurityBadge label="CSP" value={analysisReport.authentication.securityConfig.csp} />
                    <SecurityBadge label="CSRF" value={analysisReport.authentication.securityConfig.csrf} />
                  </div>
                </div>
              )}

              {analysisReport.authentication.summary && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">认证概述</h4>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">
                    {analysisReport.authentication.summary}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">暂无认证鉴权分析数据</p>
          )}
        </Section>

        {/* 5. Skills 执行记录 */}
        <Section
          title="Skills 执行记录"
          icon={<Shield className="h-5 w-5" />}
          expanded={expandedSections.has('skills')}
          onToggle={() => toggleSection('skills')}
        >
          <div className="mb-4">
            <div className="flex items-center space-x-4 text-sm">
              <span className="text-gray-600">
                总计: <span className="font-medium text-gray-900">{skillsStats.total}</span>
              </span>
              <span className="text-green-600">
                完成: <span className="font-medium">{skillsStats.completed}</span>
              </span>
              <span className="text-red-600">
                失败: <span className="font-medium">{skillsStats.failed}</span>
              </span>
              <span className="text-orange-600">
                发现问题: <span className="font-medium">{skillsStats.totalFindings}</span>
              </span>
            </div>
          </div>

          {skillExecutions.length > 0 ? (
            <div className="bg-gray-50 rounded overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">状态</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">技能名称</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">严重程度</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">发现数</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">耗时</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {skillExecutions.map((exec) => (
                    <tr key={exec.id}>
                      <td className="px-3 py-2">{getStatusIcon(exec.status)}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {exec.skillDisplayName || exec.skillName || '未知'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${getSeverityColor(exec.skillSeverity)}`}>
                          {exec.skillSeverity || '未分级'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`font-medium ${exec.findingsCount > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                          {exec.findingsCount}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {exec.duration ? `${exec.duration}ms` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">暂无 Skills 执行记录</p>
          )}
        </Section>

        {/* 6. 漏洞分类关联链 */}
        <Section
          title="漏洞分类关联链"
          icon={<Database className="h-5 w-5" />}
          expanded={expandedSections.has('chain')}
          onToggle={() => toggleSection('chain')}
        >
          {vulnerabilityChain.length > 0 ? (
            <div className="space-y-3">
              {vulnerabilityChain.map((chain, i) => (
                <div key={i} className="bg-gray-50 rounded p-3">
                  <div className="flex items-center space-x-2 text-sm font-medium text-gray-700">
                    <span className="text-purple-600">{chain.categoryName}</span>
                    <span className="text-gray-400">→</span>
                    <span className="text-blue-600">{chain.patternName}</span>
                  </div>
                  <div className="mt-2 pl-4 space-y-1">
                    {chain.skills.map((skill, j) => (
                      <div key={j} className="flex items-center space-x-2 text-xs">
                        {skill.executed ? (
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                        ) : (
                          <div className="h-3 w-3 rounded-full border border-gray-300" />
                        )}
                        <span className="text-gray-700">{skill.skillDisplayName}</span>
                        <span className={`px-1.5 py-0.5 rounded ${getSeverityColor(skill.skillSeverity)}`}>
                          {skill.skillSeverity || '未分级'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">暂无漏洞分类关联链</p>
          )}
        </Section>

        {/* 7. 漏洞发现汇总 */}
        <Section
          title="漏洞发现汇总"
          icon={<AlertTriangle className="h-5 w-5" />}
          expanded={expandedSections.has('vuln')}
          onToggle={() => toggleSection('vuln')}
        >
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <StatCard label="严重" value={vulnerabilitySummary.critical} color="red" />
            <StatCard label="高危" value={vulnerabilitySummary.high} color="orange" />
            <StatCard label="中危" value={vulnerabilitySummary.medium} color="yellow" />
            <StatCard label="低危" value={vulnerabilitySummary.low} color="blue" />
            <StatCard label="信息" value={vulnerabilitySummary.info} color="gray" />
            <StatCard label="总计" value={vulnerabilitySummary.total} color="purple" />
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center space-x-4 text-sm">
              <span className="text-gray-600">
                待处理: <span className="font-medium text-orange-600">{vulnerabilitySummary.open}</span>
              </span>
              <span className="text-gray-600">
                已确认: <span className="font-medium text-green-600">{vulnerabilitySummary.confirmed}</span>
              </span>
              <span className="text-gray-600">
                已修复: <span className="font-medium text-blue-600">{vulnerabilitySummary.fixed}</span>
              </span>
              <span className="text-gray-600">
                误报: <span className="font-medium text-gray-500">{vulnerabilitySummary.falsePositive}</span>
              </span>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

// 辅助组件
function Section({
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
      >
        <div className="flex items-center space-x-2">
          <span className="text-gray-500">{icon}</span>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        {expanded ? (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronRight className="h-5 w-5 text-gray-400" />
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          {children}
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-gray-500">{label}</h4>
      <p className="text-sm text-gray-900 mt-0.5">{value || '-'}</p>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    red: 'bg-red-50 border-red-200 text-red-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
  };

  return (
    <div className={`text-center p-3 rounded border ${colors[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs mt-1">{label}</div>
    </div>
  );
}

function SecurityBadge({ label, value }: { label: string; value: any }) {
  const isEnabled = value === true || value === 'true' || value === '启用';
  return (
    <div className={`flex items-center space-x-1 px-2 py-1 rounded text-xs ${
      isEnabled ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
    }`}>
      {isEnabled ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      <span>{label}</span>
    </div>
  );
}
