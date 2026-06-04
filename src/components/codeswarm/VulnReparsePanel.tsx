'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, AlertTriangle, CheckCircle2, XCircle, Search } from 'lucide-react';
import toast from 'react-hot-toast';

interface ReparseItem {
  taskInstanceId: string;
  name: string;
  status: string;
  projectPath: string | null;
  targetProduct: string | null;
  codeswarmTaskId: string;
  vulnerabilityCount: number;
  isParsing: boolean;
  canReparse: boolean;
}

export function VulnReparsePanel() {
  const [items, setItems] = useState<ReparseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [parsingIds, setParsingIds] = useState<Set<string>>(new Set());

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/codeswarm/reparse', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      } else {
        toast.error('加载任务列表失败');
      }
    } catch {
      toast.error('请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
    const interval = setInterval(() => {
      loadItems();
      setParsingIds((prev) => {
        if (prev.size === 0) return prev;
        return new Set(prev);
      });
    }, 10000);
    return () => clearInterval(interval);
  }, [loadItems]);

  const handleReparse = async (taskInstanceId: string) => {
    setParsingIds((prev) => new Set(prev).add(taskInstanceId));
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/codeswarm/reparse', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskInstanceId }),
      });

      const data = await res.json();

      if (res.status === 409 && data.existingCount) {
        toast.error(`已成功解析漏洞报告无需再执行 (已有 ${data.existingCount} 条漏洞)`);
        setParsingIds((prev) => {
          const next = new Set(prev);
          next.delete(taskInstanceId);
          return next;
        });
        return;
      }

      if (!res.ok) {
        toast.error(data.error || '重新解析失败');
        setParsingIds((prev) => {
          const next = new Set(prev);
          next.delete(taskInstanceId);
          return next;
        });
        return;
      }

      toast.success(`重新解析已启动: ${data.taskName || taskInstanceId}`);
    } catch {
      toast.error('请求失败');
      setParsingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskInstanceId);
        return next;
      });
    }
  };

  const filteredItems = items.filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      item.taskInstanceId.toLowerCase().includes(q) ||
      (item.targetProduct || '').toLowerCase().includes(q)
    );
  });

  const parsingItems = filteredItems.filter((i) => i.isParsing || parsingIds.has(i.taskInstanceId));
  const reparsableItems = filteredItems.filter((i) => i.canReparse && !i.isParsing && !parsingIds.has(i.taskInstanceId));
  const doneItems = filteredItems.filter((i) => i.vulnerabilityCount > 0 && !i.isParsing && !parsingIds.has(i.taskInstanceId));
  const blockedItems = filteredItems.filter(
    (i) => !i.canReparse && i.vulnerabilityCount === 0 && !i.isParsing && !parsingIds.has(i.taskInstanceId)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务名称、ID 或产品..."
            className="w-full pl-9 pr-3 py-2 bg-dark-bg border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm text-gray-100"
          />
        </div>
        <button
          onClick={loadItems}
          disabled={loading}
          className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-md text-sm text-gray-300 flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <div className="bg-cyan-900/20 rounded p-3 border border-cyan-700/30">
          <p className="text-cyan-300 text-xs">可重新解析</p>
          <p className="text-white font-bold">{reparsableItems.length}</p>
        </div>
        <div className="bg-blue-900/20 rounded p-3 border border-blue-700/30">
          <p className="text-blue-300 text-xs">解析中</p>
          <p className="text-white font-bold">{parsingItems.length}</p>
        </div>
        <div className="bg-green-900/20 rounded p-3 border border-green-700/30">
          <p className="text-green-300 text-xs">已解析</p>
          <p className="text-white font-bold">{doneItems.length}</p>
        </div>
      </div>

      {parsingItems.length > 0 && (
        <div className="bg-dark-surface rounded-lg border border-blue-700/30">
          <div className="p-3 border-b border-gray-700/50">
            <h4 className="text-sm font-medium text-blue-400 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在解析 ({parsingItems.length})
            </h4>
          </div>
          <div className="divide-y divide-gray-700/30 max-h-[200px] overflow-y-auto">
            {parsingItems.map((item) => (
              <div key={item.taskInstanceId} className="p-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-200 truncate">{item.name}</p>
                  <p className="text-xs text-gray-500 truncate">{item.taskInstanceId}</p>
                </div>
                <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-1 rounded flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  解析中
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {reparsableItems.length > 0 && (
        <div className="bg-dark-surface rounded-lg border border-orange-700/30">
          <div className="p-3 border-b border-gray-700/50">
            <h4 className="text-sm font-medium text-orange-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              可重新解析 ({reparsableItems.length})
            </h4>
            <p className="text-xs text-gray-500 mt-1">已完成但漏洞数据库中无记录的任务</p>
          </div>
          <div className="divide-y divide-gray-700/30 max-h-[400px] overflow-y-auto">
            {reparsableItems.map((item) => (
              <div key={item.taskInstanceId} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-200 truncate">{item.name}</p>
                  <div className="flex gap-2 text-xs text-gray-500 mt-1">
                    <span className="text-orange-300">{item.targetProduct || '未知产品'}</span>
                    <span>·</span>
                    <span className="truncate max-w-[200px]">{item.projectPath || '无路径'}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleReparse(item.taskInstanceId)}
                  className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 rounded text-sm text-white flex items-center gap-1 shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  重新解析
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {doneItems.length > 0 && (
        <div className="bg-dark-surface rounded-lg border border-green-700/30">
          <div className="p-3 border-b border-gray-700/50">
            <h4 className="text-sm font-medium text-green-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              已解析 ({doneItems.length})
            </h4>
          </div>
          <div className="divide-y divide-gray-700/30 max-h-[300px] overflow-y-auto">
            {doneItems.map((item) => (
              <div key={item.taskInstanceId} className="p-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-200 truncate">{item.name}</p>
                  <p className="text-xs text-gray-500 truncate">{item.targetProduct || '未知产品'}</p>
                </div>
                <span className="text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded">
                  {item.vulnerabilityCount} 条漏洞
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {blockedItems.length > 0 && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/30">
          <div className="p-3 border-b border-gray-700/50">
            <h4 className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <XCircle className="w-4 h-4" />
              不可解析 ({blockedItems.length})
            </h4>
            <p className="text-xs text-gray-500 mt-1">缺少 projectPath 或 codeswarmTaskId</p>
          </div>
          <div className="divide-y divide-gray-700/30 max-h-[200px] overflow-y-auto">
            {blockedItems.map((item) => (
              <div key={item.taskInstanceId} className="p-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-400 truncate">{item.name}</p>
                  <p className="text-xs text-gray-500 truncate">{item.taskInstanceId}</p>
                </div>
                <span className="text-xs text-gray-500 bg-gray-700/30 px-2 py-1 rounded">
                  {!item.projectPath ? '无路径' : !item.codeswarmTaskId ? '无关联任务' : '状态异常'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredItems.length === 0 && !loading && (
        <div className="bg-dark-surface rounded-lg p-8 border border-gray-700/50 text-center">
          <p className="text-gray-500">
            {search ? '未找到匹配的任务' : '暂无已完成的任务'}
          </p>
        </div>
      )}
    </div>
  );
}