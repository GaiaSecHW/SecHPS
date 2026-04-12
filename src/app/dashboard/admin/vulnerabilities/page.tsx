'use client';

import { useEffect, useState } from 'react';
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
} from 'lucide-react';

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
  fixSuggestion: string | null;
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

export default function VulnerabilitiesPage() {
  const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedVuln, setSelectedVuln] = useState<Vulnerability | null>(null);

  useEffect(() => {
    fetchVulnerabilities();
    fetchStats();
  }, [selectedStatus]);

  const fetchVulnerabilities = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (selectedStatus) params.append('status', selectedStatus);

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
      alert(err instanceof Error ? err.message : '操作失败');
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
      alert(err instanceof Error ? err.message : '删除失败');
    }
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
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
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
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

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Vulnerabilities List */}
      <div className="space-y-4">
        {filteredVulnerabilities.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
            <div className="text-center">
              <Shield className="mx-auto h-16 w-16 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">暂无漏洞</h3>
              <p className="mt-2 text-sm text-gray-600">
                {searchTerm || selectedStatus
                  ? '没有找到匹配的漏洞'
                  : '系统运行良好，暂未发现安全漏洞'}
              </p>
            </div>
          </div>
        ) : (
          filteredVulnerabilities.map((vuln) => (
            <div
              key={vuln.id}
              className="bg-white rounded-lg shadow border border-gray-200 p-4 hover:border-gray-300 transition-colors cursor-pointer"
              onClick={() => setSelectedVuln(vuln)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[vuln.status] || 'bg-gray-100 text-gray-800'}`}>
                      {statusLabels[vuln.status] || vuln.status}
                    </span>
                  </div>
                  <h3 className="mt-2 font-semibold text-gray-900">{vuln.title}</h3>
                  <p className="mt-1 text-sm text-gray-600 line-clamp-2">{vuln.description}</p>
                  <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                    <span>类型: {vuln.type}</span>
                    {vuln.cwe && <span>CWE: {vuln.cwe}</span>}
                    {vuln.filePath && <span>文件: {vuln.filePath}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-500">
                    {new Date(vuln.createdAt).toLocaleDateString()}
                  </div>
                  <button
                    onClick={(e) => handleDelete(vuln.id, vuln.title, e)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="删除漏洞"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Detail Modal */}
      {selectedVuln && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[selectedVuln.status] || 'bg-gray-100 text-gray-800'}`}>
                      {statusLabels[selectedVuln.status] || selectedVuln.status}
                    </span>
                  </div>
                  <h2 className="mt-2 text-xl font-bold text-gray-900">{selectedVuln.title}</h2>
                </div>
                <button
                  onClick={() => setSelectedVuln(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle size={24} />
                </button>
              </div>

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
                  <p className="text-sm text-gray-600 bg-white border border-gray-200 rounded-lg p-3">{selectedVuln.description}</p>
                </div>

                {/* 发现位置 */}
                {selectedVuln.filePath && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">发现位置</h4>
                    <div className="bg-gray-900 text-gray-100 p-3 rounded-lg">
                      <p className="text-sm font-mono break-all">
                        {selectedVuln.filePath}
                        {selectedVuln.lineStart && (
                          <span className="text-yellow-400">:{selectedVuln.lineStart}</span>
                        )}
                        {selectedVuln.lineEnd && selectedVuln.lineEnd !== selectedVuln.lineStart && (
                          <span className="text-yellow-400">-{selectedVuln.lineEnd}</span>
                        )}
                      </p>
                    </div>
                  </div>
                )}

                {/* 代码片段 */}
                {selectedVuln.codeSnippet && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">漏洞代码</h4>
                    <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto max-h-64">
{selectedVuln.codeSnippet}
                    </pre>
                  </div>
                )}

                {/* AI 分析 */}
                {selectedVuln.aiAnalysis && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      <span className="inline-flex items-center">
                        <svg className="w-4 h-4 mr-1 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        AI 分析
                      </span>
                    </h4>
                    <div className="text-sm text-gray-700 bg-blue-50 border border-blue-200 rounded-lg p-4">{selectedVuln.aiAnalysis}</div>
                  </div>
                )}

                {/* 修复建议 */}
                {selectedVuln.fixSuggestion && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      <span className="inline-flex items-center">
                        <svg className="w-4 h-4 mr-1 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        修复建议
                      </span>
                    </h4>
                    <div className="text-sm text-gray-700 bg-green-50 border border-green-200 rounded-lg p-4">{selectedVuln.fixSuggestion}</div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-6 flex items-center justify-between border-t pt-4">
                <div className="flex items-center space-x-2">
                {selectedVuln.status === 'new' && (
                  <>
                    <button
                      onClick={() => handleStatusChange(selectedVuln.id, 'confirm')}
                      className="inline-flex items-center px-4 py-2 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                    >
                      <CheckCircle size={16} className="mr-2" />
                      确认漏洞
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedVuln.id, 'false-positive')}
                      className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                    >
                      <XCircle size={16} className="mr-2" />
                      标记误报
                    </button>
                  </>
                )}
                {selectedVuln.status === 'confirmed' && (
                  <button
                    onClick={() => handleStatusChange(selectedVuln.id, 'fix')}
                    className="inline-flex items-center px-4 py-2 bg-green-100 text-green-800 rounded hover:bg-green-200"
                  >
                    <RefreshCw size={16} className="mr-2" />
                    标记已修复
                  </button>
                )}
                {selectedVuln.status === 'fixed' && (
                  <button
                    onClick={() => handleStatusChange(selectedVuln.id, 'verify')}
                    className="inline-flex items-center px-4 py-2 bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
                  >
                    <CheckCircle size={16} className="mr-2" />
                    验证修复
                  </button>
                )}
                </div>
                {/* 删除按钮始终显示，放右侧 */}
                <button
                  onClick={() => handleDelete(selectedVuln.id, selectedVuln.title)}
                  className="inline-flex items-center px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors"
                >
                  <Trash2 size={16} className="mr-2" />
                  删除漏洞
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
