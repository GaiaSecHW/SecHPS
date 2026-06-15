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
  Clock,
  Info,
} from 'lucide-react';

interface UserProject {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

interface UserInfo {
  id: string;
  username: string;
  name: string;
  email: string;
}

interface UserTokenStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  evaluationCount: number;
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
  const [tokenStats, setTokenStats] = useState<UserTokenStats>({
    inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, evaluationCount: 0,
  });

  useEffect(() => {
    fetchUserAndProjects();
  }, [userId]);

  const fetchUserAndProjects = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');

      const userRes = await fetch(`/api/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (userRes.ok) {
        const userData = await userRes.json();
        setUser(userData.user);
      }

      const projectsRes = await fetch(`/api/projects?userId=${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!projectsRes.ok) {
        setError('获取项目失败');
        setLoading(false);
        return;
      }

      const projectsData = await projectsRes.json();
      setProjects(projectsData.projects || []);

      const statsRes = await fetch(`/api/token-stats?period=year`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        const matchedUser = (statsData.userStats || []).find((u: any) => u.userId === userId);
        if (matchedUser) {
          setTokenStats({
            inputTokens: matchedUser.inputTokens || 0,
            outputTokens: matchedUser.outputTokens || 0,
            totalTokens: matchedUser.totalTokens || 0,
            estimatedCost: matchedUser.estimatedCost || 0,
            evaluationCount: matchedUser.evaluationCount || 0,
          });
        }
      }

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
          <p className="text-gray-400">{error}</p>
          <button
            onClick={fetchUserAndProjects}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-600"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/dashboard/token-stats/users"
          className="flex items-center text-gray-400 hover:text-gray-100 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回用户统计
        </Link>

        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6">
          <div className="flex items-center">
            <div className="bg-blue-100 p-4 rounded-full mr-4">
              <User className="text-blue-400" size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-100">
                {user?.username || user?.name || '用户详情'}
              </h1>
              <p className="text-gray-500">{user?.email}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 统计汇总 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-dark-surface rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div className="text-blue-500">
              <TrendingUp size={24} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-100">{formatNumber(tokenStats.inputTokens)}</p>
              <p className="text-xs text-gray-500">总输入 Token</p>
            </div>
          </div>
        </div>
        <div className="bg-dark-surface rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div className="text-green-500">
              <Activity size={24} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-100">{formatNumber(tokenStats.outputTokens)}</p>
              <p className="text-xs text-gray-500">总输出 Token</p>
            </div>
          </div>
        </div>
        <div className="bg-dark-surface rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div className="text-orange-500">
              <Coins size={24} />
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-orange-400 flex items-center">
                {formatCost(tokenStats.estimatedCost)}
                <span className="ml-1 cursor-help relative group">
                  <Info size={12} className="text-orange-400 hover:text-orange-400" />
                  <span className="absolute right-0 bottom-full mb-1 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-1.5 whitespace-nowrap z-10 shadow-lg">
                    ¥6/百万输入 + ¥22/百万输出
                  </span>
                </span>
              </p>
              <p className="text-xs text-gray-500">总预估费用</p>
            </div>
          </div>
        </div>
        <div className="bg-dark-surface rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div className="text-purple-500">
              <Folder size={24} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-100">{projects.length}</p>
              <p className="text-xs text-gray-500">项目数</p>
            </div>
          </div>
        </div>
      </div>

      {/* 项目列表 */}
      <div className="bg-dark-surface rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-gray-100 flex items-center">
            <Folder className="mr-2" size={20} />
            项目列表 ({projects.length})
          </h2>
        </div>

        {projects.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            该用户暂无项目
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {projects.map((project) => (
              <div
                key={project.id}
                className="px-6 py-4 hover:bg-[#0F172A]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <h3 className="text-sm font-medium text-gray-100">{project.name}</h3>
                      <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                        project.status === 'running' ? 'bg-blue-100 text-blue-400' :
                        project.status === 'completed' ? 'bg-green-100 text-green-400' :
                        project.status === 'failed' ? 'bg-red-100 text-red-400' :
                        'bg-dark-surface-hover text-gray-400'
                      }`}>
                        {project.status}
                      </span>
                    </div>
                    <div className="flex items-center text-xs text-gray-500 mt-1">
                      <Clock size={12} className="mr-1" />
                      创建于 {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
