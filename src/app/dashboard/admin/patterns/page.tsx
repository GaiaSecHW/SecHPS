'use client';

import { useEffect, useState } from 'react';
import {
  Shield,
  Plus,
  Search,
  Edit,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

interface Pattern {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string | null;
  cve: string | null;
  patterns: string[];
  languages: string[];
  isActive: boolean;
  isBuiltin: boolean;
  createdAt: string;
}

const categoryLabels: Record<string, string> = {
  'code-audit': '代码安全审计',
  'auth': '认证与授权',
  'sensitive': '敏感信息泄露',
  'api': 'API 安全',
  'config': '依赖与配置',
  'crypto': '加密与数据',
  'web': 'Web 安全',
  'business': '业务逻辑',
  'client': '客户端安全',
  'cloud': '云与容器安全',
};

export default function PatternsPage() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState<{ roles?: string[] } | null>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    fetchPatterns();
  }, []);

  const fetchPatterns = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/patterns', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取模式列表失败');
      }

      const data = await response.json();
      setPatterns(data.patterns || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const filteredPatterns = patterns.filter(
    (pattern) =>
      pattern.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pattern.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pattern.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isAdmin = user?.roles?.includes('admin');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">漏洞模式库</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理漏洞检测模式库，共 {patterns.length} 个模式
          </p>
        </div>
        {isAdmin && (
          <button
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} className="mr-2" />
            创建模式
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="搜索模式..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Patterns List */}
      <div className="space-y-4">
        {filteredPatterns.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
            <div className="text-center">
              <Shield className="mx-auto h-16 w-16 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">暂无漏洞模式</h3>
              <p className="mt-2 text-sm text-gray-600">
                漏洞模式库为空，请添加检测模式
              </p>
            </div>
          </div>
        ) : (
          filteredPatterns.map((pattern) => (
            <div
              key={pattern.id}
              className="bg-white rounded-lg shadow border border-gray-200 p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-semibold text-gray-900">{pattern.displayName}</h3>
                    {pattern.isBuiltin && (
                      <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded-full">
                        内置
                      </span>
                    )}
                    {!pattern.isActive && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                        已禁用
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-600">{pattern.description}</p>
                  <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                    <span>{categoryLabels[pattern.category] || pattern.category}</span>
                    {pattern.cwe && <span>CWE: {pattern.cwe}</span>}
                    {pattern.cve && <span>CVE: {pattern.cve}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {pattern.languages.map((lang) => (
                      <span key={lang} className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                        {lang}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
