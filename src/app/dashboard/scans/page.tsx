'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap,
  Plus,
  Play,
  Pause,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Calendar,
} from 'lucide-react';

interface ScanTask {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  skillIds: string[];
  status: string;
  progress: number;
  currentSkill: string | null;
  totalSkills: number;
  completedSkills: number;
  findingsCount: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  project?: {
    id: string;
    name: string;
  };
}

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-yellow-100 text-yellow-800',
};

const statusLabels: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export default function ScansPage() {
  const router = useRouter();
  const [scanTasks, setScanTasks] = useState<ScanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchScanTasks();
    // 每30秒刷新一次
    const interval = setInterval(fetchScanTasks, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchScanTasks = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/scans', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取扫描任务失败');
      }

      const data = await response.json();
      setScanTasks(data.scanTasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

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
          <h1 className="text-2xl font-bold text-gray-900">自动化扫描</h1>
          <p className="mt-1 text-sm text-gray-600">
            创建和管理安全扫描任务
          </p>
        </div>
        <button
          onClick={() => router.push('/dashboard/scans/create')}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={20} className="mr-2" />
          新建扫描任务
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Scan Tasks List */}
      <div className="space-y-4">
        {scanTasks.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
            <div className="text-center">
              <Zap className="mx-auto h-16 w-16 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">暂无扫描任务</h3>
              <p className="mt-2 text-sm text-gray-600">
                创建一个新的扫描任务来检测项目中的安全漏洞
              </p>
              <button
                onClick={() => router.push('/dashboard/scans/create')}
                className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus size={20} className="mr-2" />
                新建扫描任务
              </button>
            </div>
          </div>
        ) : (
          scanTasks.map((task) => (
            <div
              key={task.id}
              className="bg-white rounded-lg shadow border border-gray-200 p-4 hover:border-gray-300 transition-colors cursor-pointer"
              onClick={() => router.push(`/dashboard/scans/${task.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[task.status] || 'bg-gray-100 text-gray-800'}`}>
                      {statusLabels[task.status] || task.status}
                    </span>
                    {task.status === 'running' && (
                      <span className="flex items-center text-sm text-blue-600">
                        <RefreshCw size={14} className="mr-1 animate-spin" />
                        执行中
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 font-semibold text-gray-900">{task.name}</h3>
                  {task.description && (
                    <p className="mt-1 text-sm text-gray-600">{task.description}</p>
                  )}

                  {/* Progress Bar */}
                  {task.status === 'running' && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                        <span>{task.currentSkill || '准备中...'}</span>
                        <span>{task.completedSkills}/{task.totalSkills}</span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex items-center space-x-4 text-sm text-gray-500">
                    {task.findingsCount > 0 && (
                      <span className="flex items-center">
                        <AlertTriangle size={14} className="mr-1 text-yellow-500" />
                        {task.findingsCount} 个发现
                      </span>
                    )}
                    {task.startedAt && (
                      <span className="flex items-center">
                        <Clock size={14} className="mr-1" />
                        {new Date(task.startedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-sm text-gray-500">
                  {new Date(task.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
