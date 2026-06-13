import { useState } from 'react';
import { useApiFetch } from '@/lib/use-api-fetch';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RefreshCw, Trash2, Server, Wifi, WifiOff, Clock, Pencil, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface Worker {
  id: string;
  nodeId: string;
  name: string | null;
  address: string;
  systemType: string | null;
  arch: string | null;
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
  const { data, loading, error, refetch } = useApiFetch<WorkersResponse>('/api/codeswarm/node/list');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<number>(0);

  const handleDelete = async (nodeId: string) => {
    if (!confirm('确定要删除这个 Worker 节点吗？')) return;
    setDeleting(nodeId);
    try {
      const resp = await fetch(`/api/codeswarm/node/${nodeId}`, { method: 'DELETE' });
      if (resp.ok) { toast.success('节点已删除'); refetch(); }
      else toast.error('删除失败');
    } catch { toast.error('删除失败'); }
    finally { setDeleting(null); }
  };

  const handleSaveConcurrent = async (nodeId: string) => {
    try {
      const resp = await fetch(`/api/codeswarm/node/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxConcurrent: editValue }),
      });
      if (resp.ok) { toast.success(`并发数已更新为 ${editValue}`); setEditingNode(null); refetch(); }
      else toast.error('更新失败');
    } catch { toast.error('更新失败'); }
  };

  const startEditing = (worker: Worker) => {
    setEditingNode(worker.nodeId);
    setEditValue(worker.maxConcurrent);
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
    return <div className="flex items-center justify-center h-48"><LoadingSpinner size="lg" /></div>;
  }
  if (error) return <ErrorAlert>{error}</ErrorAlert>;

  const workers = data?.workers || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Worker 节点列表</h2>
        <button onClick={() => refetch()} className="flex items-center space-x-2 px-3 py-2 bg-dark-surface-hover hover:bg-gray-700 rounded-lg transition-colors">
          <RefreshCw className="w-4 h-4" /><span>刷新</span>
        </button>
      </div>

      {workers.length === 0 ? (
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-12">
          <div className="text-center">
            <Server className="mx-auto h-16 w-16 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-100">暂无 Worker 节点</h3>
            <p className="mt-2 text-sm text-gray-400">启动 Worker 后会自动注册到此处</p>
          </div>
        </div>
      ) : (
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-700/50">
            <thead className="bg-dark-surface-alt">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">节点</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">最大并发数</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">支持引擎</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">容量</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">最后心跳</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="bg-dark-surface divide-y divide-gray-700/50">
              {workers.map((worker) => (
                <tr key={worker.id} className="hover:bg-dark-surface-hover">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`p-2 rounded-lg ${worker.status === 'online' ? 'bg-green-900/30' : 'bg-gray-700'}`}>
                        {worker.status === 'online' ? <Wifi className="w-5 h-5 text-green-600" /> : <WifiOff className="w-5 h-5 text-gray-400" />}
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-100">{worker.name || worker.nodeId}</div>
                        <div className="text-xs text-gray-400">{worker.address?.split(',')[0]}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      worker.status === 'online' ? 'bg-green-500/15 text-green-400'
                      : worker.status === 'busy' ? 'bg-yellow-900/20 text-yellow-400'
                      : 'bg-gray-700 text-gray-300'}`}>
                      {worker.status === 'online' ? '在线' : worker.status === 'busy' ? '忙碌' : '离线'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingNode === worker.nodeId ? (
                      <div className="flex items-center space-x-2">
                        <input type="number" value={editValue} onChange={(e) => setEditValue(Math.max(1, parseInt(e.target.value) || 1))} min={1} max={50} className="w-16 px-2 py-1 border border-blue-300 rounded text-sm" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleSaveConcurrent(worker.nodeId); if (e.key === 'Escape') setEditingNode(null); }} />
                        <button onClick={() => handleSaveConcurrent(worker.nodeId)} className="p-1 text-green-400 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                        <button onClick={() => setEditingNode(null)} className="p-1 text-gray-400 hover:bg-dark-surface-hover rounded"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <button onClick={() => startEditing(worker)} className="flex items-center space-x-1 text-sm text-gray-300 hover:text-blue-400 group">
                        <span className="font-medium">{worker.maxConcurrent}</span>
                        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-900/20 text-orange-400">OpenCode</span>
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-900/30 text-purple-400">Claude Code</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <div className="w-24 bg-gray-700 rounded-full h-2">
                        <div className={`h-2 rounded-full ${worker.currentTasks >= worker.maxConcurrent ? 'bg-red-500' : worker.currentTasks > 0 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${(worker.currentTasks / worker.maxConcurrent) * 100}%` }} />
                      </div>
                      <span className="text-sm text-gray-400">{worker.currentTasks}/{worker.maxConcurrent}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-gray-500"><Clock className="w-4 h-4 mr-1" />{formatLastHeartbeat(worker.lastHeartbeat)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button onClick={() => handleDelete(worker.nodeId)} disabled={deleting === worker.nodeId} className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                      {deleting === worker.nodeId ? <LoadingSpinner size="sm" /> : <Trash2 className="w-4 h-4" />}
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
