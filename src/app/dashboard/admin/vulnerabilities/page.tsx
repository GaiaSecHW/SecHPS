'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Bug,
  Search,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Shield,
  Clock,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Copy,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface Vulnerability {
  id: string;
  projectId: string;
  title: string;
  description: string;
  type: string;
  cwe: string | null;
  status: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  codeSnippet: string | null;
  aiAnalysis: string | null;
  skill: string | null;
  createdAt: string;
  project?: {
    id: string;
    name: string;
  };
}

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  trend: Array<{ date: string; count: number }>;
}

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-yellow-100 text-yellow-800',
  'false-positive': 'bg-gray-100 text-gray-800',
  fixed: 'bg-green-100 text-green-800',
  verified: 'bg-purple-100 text-purple-800',
  closed: 'bg-gray-100 text-gray-600',
};

const statusLabels: Record<string, string> = {
  new: '新建',
  confirmed: '已确认',
  'false-positive': '误报',
  fixed: '已修复',
  verified: '已验证',
  closed: '已关闭',
};

// 格式化漏洞描述 - 按语义分行
const formatDescription = (text: string): string => {
  if (!text) return '';
  
  // 如果已经有换行符，直接返回
  if (text.includes('\n')) return text;
  
  // 按句号、问号、感叹号分行（中文和英文）
  let formatted = text
    // 处理中文标点
    .replace(/([。！？])/g, '$1\n')
    // 处理英文标点后跟空格的情况
    .replace(/([.!?])\s+/g, '$1\n')
    // 处理分号
    .replace(/([；;])/g, '$1\n')
    // 清理多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
    
  return formatted;
};

export default function VulnerabilitiesPage() {
  return (
    <AdminGuard>
      <VulnerabilitiesPageContent />
    </AdminGuard>
  );
}

function VulnerabilitiesPageContent() {
  const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [projects, setProjects] = useState<{id: string, name: string}[]>([]);
  const [selectedVuln, setSelectedVuln] = useState<Vulnerability | null>(null);
  
  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    fetchProjects();
    fetchVulnerabilities();
    fetchStats();
  }, [selectedStatus, selectedProject, currentPage]);

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        // API 返回 { projects: [...] }
        setProjects(data.projects || []);
      }
    } catch (err) {
      console.error('获取项目列表失败:', err);
    }
  };

  const fetchVulnerabilities = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (selectedStatus) params.append('status', selectedStatus);
      if (selectedProject) params.append('projectId', selectedProject);
      if (searchTerm) params.append('search', searchTerm);
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());

      const response = await fetch(`/api/vulnerabilities?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取漏洞列表失败');
      }

      const data = await response.json();
      // API 返回格式: { data: [...], pagination: {...} }
      setVulnerabilities(data.data || []);
      setTotalCount(data.pagination?.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/vulnerabilities/stats', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
      }
    } catch (err) {
      console.error('获取统计失败:', err);
    }
  };

  const handleStatusChange = async (vulnId: string, action: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/vulnerabilities/${vulnId}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '操作失败');
      }

      fetchVulnerabilities();
      fetchStats();
      setSelectedVuln(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDelete = async (vulnId: string, title: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm(`确定要删除漏洞「${title}」吗？此操作不可恢复。`)) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/vulnerabilities/${vulnId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }
      setSelectedVuln(null);
      fetchVulnerabilities();
      fetchStats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 复制漏洞详情为 Markdown 格式
  const handleCopyAsMarkdown = (vuln: Vulnerability) => {
    const markdown = `# 漏洞报告：${vuln.title}

## 基本信息

| 字段 | 内容 |
|------|------|
| 漏洞类型 | ${vuln.type} |
| CWE 编号 | ${vuln.cwe || '无'} |
| 状态 | ${statusLabels[vuln.status] || vuln.status} |
| 发现工具 | ${vuln.skill || '未知'} |
| 发现时间 | ${new Date(vuln.createdAt).toLocaleString('zh-CN')} |
| 所属项目 | ${vuln.project?.name || '无'} |

## 漏洞描述

${vuln.description || '无描述'}

## 问题代码位置

${vuln.filePath || '无'}

## POC / 代码片段

${vuln.codeSnippet ? '```\n' + vuln.codeSnippet + '\n```' : '无'}

---
*报告生成时间：${new Date().toLocaleString('zh-CN')}*
`;

    navigator.clipboard.writeText(markdown).then(() => {
      toast.success('已复制为 Markdown 格式');
    }).catch(() => {
      toast.error('复制失败');
    });
  };

  const filteredVulnerabilities = vulnerabilities.filter(
    (vuln) =>
      vuln.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vuln.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vuln.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

    if (loading && vulnerabilities.length === 0) {
      return (
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner size="xl" />
        </div>
      );
    }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">漏洞管理</h1>
        <p className="mt-1 text-sm text-gray-600">
          查看和管理系统中的安全漏洞
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Bug className="h-6 w-6 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">总漏洞数</p>
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
            <div className="flex items-center">
              <div className="p-2 bg-orange-100 rounded-lg">
                <AlertTriangle className="h-6 w-6 text-orange-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">待处理</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stats.byStatus['new'] || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
            <div className="flex items-center">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="h-6 w-6 text-yellow-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">已确认</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stats.byStatus['confirmed'] || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-500">已修复</p>
                <p className="text-2xl font-bold text-gray-900">
                  {(stats.byStatus['fixed'] || 0) + (stats.byStatus['verified'] || 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="搜索漏洞..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <select
          value={selectedProject}
          onChange={(e) => { setSelectedProject(e.target.value); setCurrentPage(1); }}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">所有项目</option>
          {projects.map(project => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
</select>
        <select
          value={selectedStatus}
          onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1); }}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">所有状态</option>
          <option value="new">新建</option>
          <option value="confirmed">已确认</option>
          <option value="false-positive">误报</option>
          <option value="fixed">已修复</option>
          <option value="verified">已验证</option>
        </select>
      </div>

      {/* Vulnerabilities List */}
      <div className="space-y-4">
        {filteredVulnerabilities.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
            <div className="text-center">
              <Shield className="mx-auto h-16 w-16 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">暂无漏洞</h3>
              <p className="mt-2 text-sm text-gray-600">
                {searchTerm || selectedStatus || selectedProject
                  ? '没有找到匹配的漏洞'
                  : '系统运行良好，暂未发现安全漏洞'}
              </p>
            </div>
          </div>
        ) : (
          filteredVulnerabilities.map((vuln) => (
            <div
              key={vuln.id}
              className="bg-white rounded-lg shadow border border-gray-200 px-4 py-3 hover:border-gray-300 transition-colors cursor-pointer"
              onClick={() => setSelectedVuln(vuln)}
            >
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 text-xs font-medium rounded flex-shrink-0 ${statusColors[vuln.status] || 'bg-gray-100 text-gray-800'}`}>
                  {statusLabels[vuln.status] || vuln.status}
                </span>
                <h3 className="font-semibold text-gray-900 truncate flex-1 min-w-0">{vuln.title}</h3>
                {vuln.project && <span className="text-sm text-blue-600 flex-shrink-0">项目: {vuln.project.name}</span>}
                <span className="text-sm text-gray-500 flex-shrink-0">类型: {vuln.type}</span>
                <span className="text-sm text-gray-400 flex-shrink-0">{new Date(vuln.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <button
                  onClick={(e) => handleDelete(vuln.id, vuln.title, e)}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                  title="删除漏洞"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            共 {totalCount} 条记录，第 {currentPage}/{Math.ceil(totalCount / pageSize)} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-gray-600">
              第 {currentPage} 页
            </span>
            <button
              onClick={() => setCurrentPage(p => p + 1)}
              disabled={currentPage >= Math.ceil(totalCount / pageSize)}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedVuln && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
          {/* 顶部导航栏 */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white shrink-0">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setSelectedVuln(null)}
                className="flex items-center text-gray-500 hover:text-gray-800 transition-colors"
              >
                <XCircle size={20} className="mr-1" />
                返回
              </button>
              <span className="text-gray-300">|</span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[selectedVuln.status] || 'bg-gray-100 text-gray-800'}`}>
                {statusLabels[selectedVuln.status] || selectedVuln.status}
              </span>
              <h2 className="text-lg font-bold text-gray-900">{selectedVuln.title}</h2>
            </div>
            {/* 操作按钮 */}
            <div className="flex items-center space-x-2">
              <button onClick={() => handleCopyAsMarkdown(selectedVuln)} className="inline-flex items-center px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 text-sm">
                <Copy size={14} className="mr-1" />复制MD
              </button>
              {selectedVuln.status === 'new' && (
                <>
                  <button onClick={() => handleStatusChange(selectedVuln.id, 'confirm')} className="inline-flex items-center px-3 py-1.5 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 text-sm">
                    <CheckCircle size={14} className="mr-1" />确认漏洞
                  </button>
                  <button onClick={() => handleStatusChange(selectedVuln.id, 'false-positive')} className="inline-flex items-center px-3 py-1.5 bg-gray-100 text-gray-800 rounded hover:bg-gray-200 text-sm">
                    <XCircle size={14} className="mr-1" />标记误报
                  </button>
                </>
              )}
              {selectedVuln.status === 'confirmed' && (
                <button onClick={() => handleStatusChange(selectedVuln.id, 'fix')} className="inline-flex items-center px-3 py-1.5 bg-green-100 text-green-800 rounded hover:bg-green-200 text-sm">
                  <RefreshCw size={14} className="mr-1" />标记已修复
                </button>
              )}
              {selectedVuln.status === 'fixed' && (
                <button onClick={() => handleStatusChange(selectedVuln.id, 'verify')} className="inline-flex items-center px-3 py-1.5 bg-purple-100 text-purple-800 rounded hover:bg-purple-200 text-sm">
                  <CheckCircle size={14} className="mr-1" />验证修复
                </button>
              )}
              <button onClick={() => handleDelete(selectedVuln.id, selectedVuln.title)} className="inline-flex items-center px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 text-sm">
                <Trash2 size={14} className="mr-1" />删除
              </button>
            </div>
          </div>
          {/* 内容区域 */}
          <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-6">
            <div className="space-y-4">

              <div className="mt-4 space-y-4">
                {/* 基本信息 */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs text-gray-500">漏洞类型</span>
                      <p className="text-sm font-medium text-gray-900">{selectedVuln.type}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">CWE 编号</span>
                      <p className="text-sm font-medium text-gray-900">{selectedVuln.cwe || '无'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">发现工具</span>
                      <p className="text-sm font-medium text-gray-900">{selectedVuln.skill || '未知'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">发现时间</span>
                      <p className="text-sm font-medium text-gray-900">{new Date(selectedVuln.createdAt).toLocaleString('zh-CN')}</p>
                    </div>
                  </div>
                </div>

                {/* 描述 */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">漏洞描述</h4>
                  <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{formatDescription(selectedVuln.description)}</div>
                </div>

                {/* 问题代码 */}
                {selectedVuln.filePath && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">问题代码</h4>
                    <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto max-h-64 whitespace-pre-wrap">{selectedVuln.filePath}</pre>
                  </div>
                )}

                {/* POC */}
                {selectedVuln.codeSnippet && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">POC</h4>
                    <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto max-h-64 whitespace-pre-wrap">{selectedVuln.codeSnippet}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
