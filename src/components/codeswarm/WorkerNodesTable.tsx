'use client';

import { useState } from 'react';
import { useApiFetch } from '@/hooks/useApiFetch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorAlert } from '@/components/ui/Alert';
import { RefreshCw, Trash2, Server, Wifi, WifiOff, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

interface Worker {
  id: string;
  nodeId: string;
  name: string | null;
  address: string;
  status: string;
  maxConcurrent: number;
  currentTasks: number;
  capabilities: string | null;
  lastHeartbeat: string | null;
  createdAt: string;
}

interface WorkersResponse {
  workers: Worker[];
}

export function WorkerNodesTable() {
  const { data, loading, error, refetch } = useApiFetch<WorkersResponse>('/api/codeswarm/nodes');
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (nodeId: string) => {
    if (!confirm('确定要删除这个 Worker 节点吗？')) return;

    setDeleting(nodeId);
    try {
      const resp = await fetch(`/api/codeswarm/nodes/${nodeId}`, { method: 'DELETE' });
      if (resp.ok) {
        toast.success('节点已删除');
        refetch();
      } else {
        toast.error('删除失败');
      }
    } catch (err) {
      toast.error('删除失败');
    } finally {
      setDeleting(null);
    }
  };

  const formatLastHeartbeat = (date: string | null) => {
    if (!date) return '从未';
    const diff = Date.now() - new Date(date).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}秒前`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    return `${hours}小时前`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorAlert>{error}</ErrorAlert>;
  }

  const workers = data?.workers || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Worker 节点列表</h2>
        <button
          onClick={() => refetch()}
          className="flex items-center space-x-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          <span>刷新</span>
        </button>
      </div>

      {workers.length === 0 ? (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
          <div className="text-center">
            <Server className="mx-auto h-16 w-16 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">暂无 Worker 节点</h3>
            <p className="mt-2 text-sm text-gray-600">
              启动 Worker 后会自动注册到此处
            </p>
            <div className="mt-4 text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">
              <code>ORCHESTRATOR_URL=http://localhost:3000 npx tsx packages/worker/src/index.ts</code>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  节点
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  容量
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  最后心跳
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {workers.map((worker) => (
                <tr key={worker.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`p-2 rounded-lg ${worker.status === 'online' ? 'bg-green-100' : 'bg-gray-100'}`}>
                        {worker.status === 'online' ? (
                          <Wifi className="w-5 h-5 text-green-600" />
                        ) : (
                          <WifiOff className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900">
                          {worker.name || worker.nodeId}
                        </div>
                        <div className="text-xs text-gray-500">{worker.address}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      worker.status === 'online'
                        ? 'bg-green-100 text-green-800'
                        : worker.status === 'busy'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {worker.status === 'online' ? '在线' : worker.status === 'busy' ? '忙碌' : '离线'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            worker.currentTasks >= worker.maxConcurrent
                              ? 'bg-red-500'
                              : worker.currentTasks > 0
                              ? 'bg-yellow-500'
                              : 'bg-green-500'
                          }`}
                          style={{
                            width: `${(worker.currentTasks / worker.maxConcurrent) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-sm text-gray-600">
                        {worker.currentTasks}/{worker.maxConcurrent}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-gray-500">
                      <Clock className="w-4 h-4 mr-1" />
                      {formatLastHeartbeat(worker.lastHeartbeat)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => handleDelete(worker.nodeId)}
                      disabled={deleting === worker.nodeId}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title="删除节点"
                    >
                      {deleting === worker.nodeId ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}