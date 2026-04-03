'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Zap,
  ArrowLeft,
  Play,
  Pause,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
} from 'lucide-react';

interface ScanTask {
  id: string;
  name: string;
  description: string | null;
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
  project: { id: string; name: string };
  skillIds: string[];
  executions: Array<{
    id: string;
    status: string;
    skill: { id: string; name: string; displayName: string };
    duration: number | null;
    error: string | null;
  }>;
}

const statusConfig: Record<string, { color: string; label: string }> = {
  pending: { color: 'bg-gray-100 text-gray-800', label: '等待中' },
  running: { color: 'bg-blue-100 text-blue-800', label: '运行中' },
  completed: { color: 'bg-green-100 text-green-800', label: '已完成' },
  failed: { color: 'bg-red-100 text-red-800', label: '失败' },
  cancelled: { color: 'bg-yellow-100 text-yellow-800', label: '已取消' },
};

export default function ScanDetailPage() {
  const router = useRouter();
  const params = useParams();
  const scanId = params.id as string;

  const [scan, setScan] = useState<ScanTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetchScan();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [scanId]);

  useEffect(() => {
    if (scan?.status === 'running') {
      startProgressStream();
    } else {
      stopProgressStream();
    }
  }, [scan?.status]);

  const fetchScan = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/scans/${scanId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('获取扫描任务失败');

      const data = await response.json();
      setScan(data.scan);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const startProgressStream = () => {
    if (eventSourceRef.current) return;

    const token = localStorage.getItem('token');
    const eventSource = new EventSource(`/api/scans/${scanId}/progress?token=${token}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setScan(prev => prev ? { ...prev, ...data } : null);
    };

    eventSource.onerror = () => {
      eventSource.close();
      eventSourceRef.current = null;
    };

    eventSourceRef.current = eventSource;
  };

  const stopProgressStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const handleStart = async () => {
    try {
      setActionLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/scans/${scanId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '启动失败');
      }

      fetchScan();
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('确定要取消此扫描任务吗？')) return;

    try {
      setActionLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/scans/${scanId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '取消失败');
      }

      fetchScan();
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消失败');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="text-center py-12">
        <Zap className="mx-auto h-12 w-12 text-gray-400" />
        <p className="mt-4 text-gray-600">扫描任务不存在</p>
      </div>
    );
  }

  const status = statusConfig[scan.status] || statusConfig.pending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{scan.name}</h1>
            <p className="text-sm text-gray-600">{scan.project?.name}</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${status.color}`}>
            {status.label}
          </span>
          {scan.status === 'pending' && (
            <button
              onClick={handleStart}
              disabled={actionLoading}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <Play size={20} className="mr-2" />
              开始扫描
            </button>
          )}
          {scan.status === 'running' && (
            <button
              onClick={handleCancel}
              disabled={actionLoading}
              className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              <Pause size={20} className="mr-2" />
              取消
            </button>
          )}
          {(scan.status === 'completed' || scan.status === 'failed' || scan.status === 'cancelled') && (
            <button
              onClick={handleStart}
              disabled={actionLoading}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <RefreshCw size={20} className="mr-2" />
              重新扫描
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {scan.status === 'running' && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-gray-900">扫描进度</h3>
            <span className="text-sm text-gray-600">
              {scan.completedSkills} / {scan.totalSkills} Skills
            </span>
          </div>
          <div className="h-3 bg-gray-200 rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${scan.progress}%` }}
            />
          </div>
          {scan.currentSkill && (
            <p className="text-sm text-gray-600">正在执行: {scan.currentSkill}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Zap className="text-blue-600" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-600">Skills 数量</p>
              <p className="text-xl font-semibold text-gray-900">{scan.totalSkills}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <AlertTriangle className="text-yellow-600" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-600">发现数量</p>
              <p className="text-xl font-semibold text-gray-900">{scan.findingsCount}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Clock className="text-green-600" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-600">开始时间</p>
              <p className="text-sm font-medium text-gray-900">
                {scan.startedAt ? new Date(scan.startedAt).toLocaleString() : '-'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <CheckCircle className="text-purple-600" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-600">完成时间</p>
              <p className="text-sm font-medium text-gray-900">
                {scan.completedAt ? new Date(scan.completedAt).toLocaleString() : '-'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {scan.executions && scan.executions.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-medium text-gray-900">执行记录</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {scan.executions.map((execution) => (
              <div key={execution.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{execution.skill.displayName}</p>
                    <p className="text-sm text-gray-500">{execution.skill.name}</p>
                  </div>
                  <div className="flex items-center space-x-3">
                    {execution.duration && (
                      <span className="text-sm text-gray-600">{execution.duration}ms</span>
                    )}
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      execution.status === 'completed' ? 'bg-green-100 text-green-800' :
                      execution.status === 'failed' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {execution.status}
                    </span>
                  </div>
                </div>
                {execution.error && (
                  <p className="mt-2 text-sm text-red-600">{execution.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}