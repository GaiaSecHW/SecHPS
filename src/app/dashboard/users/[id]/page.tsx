'use client';

import { Suspense, useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  User,
  Folder,
  Coins,
  TrendingUp,
  Activity,
  Loader2,
  AlertCircle,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Info,
} from 'lucide-react';

interface UserProject {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  tokenStats: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    evaluationCount: number;
  };
}

interface UserInfo {
  id: string;
  username: string;
  name: string;
  email: string;
}

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  );
}

export default function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <UserDetailContent params={params} />
    </Suspense>
  );
}

function UserDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const userId = use(params).id;
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState<UserInfo | null>(null);
  const [projects, setProjects] = useState<UserProject[]>([]);
  
  // 汇总统计
  const totalInputTokens = projects.reduce((sum, p) => sum + p.tokenStats.totalInputTokens, 0);
  const totalOutputTokens = projects.reduce((sum, p) => sum + p.tokenStats.totalOutputTokens, 0);
  const totalCost = projects.reduce((sum, p) => sum + p.tokenStats.estimatedCost, 0);
  const totalEvaluations = projects.reduce((sum, p) => sum + p.tokenStats.evaluationCount, 0);

  useEffect(() => {
    fetchUserAndProjects();
  }, [userId]);

  const fetchUserAndProjects = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      
      // 获取用户信息
      const userRes = await fetch(`/api/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (userRes.ok) {
        const userData = await userRes.json();
        setUser(userData.user);
      }

      // 获取用户的项目
      const projectsRes = await fetch(`/api/projects?userId=${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!projectsRes.ok) {
        setError('获取项目失败');
        setLoading(false);
        return;
      }

      const projectsData = await projectsRes.json();
      
      // 获取每个项目的 token 统计
      const projectsWithStats = await Promise.all(
        (projectsData.projects || []).map(async (project: any) => {
          const statsRes = await fetch(`/api/token-stats?projectId=${project.id}&period=year`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          
          if (statsRes.ok) {
            const statsData = await statsRes.json();
            return {
              ...project,
              tokenStats: statsData.summary || {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalTokens: 0,
                estimatedCost: 0,
                evaluationCount: 0,
              },
            };
          }
          
          return {
            ...project,
            tokenStats: {
              totalInputTokens: 0,
              totalOutputTokens: 0,
              totalTokens: 0,
              estimatedCost: 0,
              evaluationCount: 0,
            },
          };
        })
      );

      setProjects(projectsWithStats);
      setLoading(false);
    } catch (err) {
      setError('网络错误');
      setLoading(false);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return '¥0';
    return `¥${cost.toFixed(4)}`;
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">{error}</p>
          <button
            onClick={fetchUserAndProjects}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/dashboard/token-stats/users"
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回用户统计
        </Link>
        
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="bg-blue-100 p-4 rounded-full mr-4">
              <User className="text-blue-600" size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {user?.username || user?.name || '用户详情'}
              </h1>
              <p className="text-gray-500">{user?.email}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 统计汇总 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div className="text-blue-500">
              <TrendingUp size={24} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{formatNumber(totalInputTokens)}</p>
              <p className="text-xs text-gray-500">总输入 Token</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div className="text-green-500">
              <Activity size={24} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{formatNumber(totalOutputTokens)}</p>
              <p className="text-xs text-gray-500">总输出 Token</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div className="text-orange-500">
              <Coins size={24} />
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-orange-600 flex items-center">
                {formatCost(totalCost)}
                <span className="ml-1 cursor-help relative group">
                  <Info size={12} className="text-orange-400 hover:text-orange-600" />
                  <span className="absolute right-0 bottom-full mb-1 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-1.5 whitespace-nowrap z-10 shadow-lg">
                    ¥6/百万输入 + ¥22/百万输出
                  </span>
                </span>
              </p>
              <p className="text-xs text-gray-500">总预估费用</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div className="text-purple-500">
              <Folder size={24} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{projects.length}</p>
              <p className="text-xs text-gray-500">项目数</p>
            </div>
          </div>
        </div>
      </div>

      {/* 项目列表 */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <Folder className="mr-2" size={20} />
            项目列表 ({projects.length})
          </h2>
        </div>
        
        {projects.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            该用户暂无项目
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {projects.map((project) => (
              <div
                key={project.id}
                className="px-6 py-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => router.push(`/dashboard/projects/${project.id}`)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <h3 className="text-sm font-medium text-gray-900">{project.name}</h3>
                      <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                        project.status === 'running' ? 'bg-blue-100 text-blue-700' :
                        project.status === 'completed' ? 'bg-green-100 text-green-700' :
                        project.status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {project.status}
                      </span>
                    </div>
                    <div className="flex items-center text-xs text-gray-500 mt-1">
                      <Clock size={12} className="mr-1" />
                      创建于 {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center space-x-3 text-xs">
                      <span className="text-blue-600">↑{formatNumber(project.tokenStats.totalInputTokens)}</span>
                      <span className="text-green-600">↓{formatNumber(project.tokenStats.totalOutputTokens)}</span>
                    </div>
                    <div className="flex items-center text-xs text-gray-500 mt-1">
                      <span className="text-orange-600">{formatCost(project.tokenStats.estimatedCost)}</span>
                      <span className="mx-1">·</span>
                      <span>{project.tokenStats.evaluationCount} 次评估</span>
                    </div>
                  </div>
                  <ChevronRight className="text-gray-400 ml-4" size={20} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}