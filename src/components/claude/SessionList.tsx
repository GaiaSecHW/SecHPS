'use client';

import { useState } from 'react';
import { MessageSquare, Trash2, Plus, Filter } from 'lucide-react';

interface Session {
  id: string;
  summary: string;
  lastActivity: string;
  messageCount?: number;
  model?: string;
}

interface SessionListProps {
  sessions: Session[];
  currentSessionId?: string;
  onSelect: (session: Session) => void;
  onDelete: (sessionId: string) => void;
  onCreateNew: () => void;
  showSourceFilter?: boolean;
}

const SOURCE_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'claude', label: 'Claude' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
] as const;

export default function SessionList({
  sessions,
  currentSessionId,
  onSelect,
  onDelete,
  onCreateNew,
  showSourceFilter = false,
}: SessionListProps) {
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  // 格式化时间
  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${Math.floor(diff / 86400000)} 天前`;
  };

  // 根据来源过滤会话（如果启用）
  const filteredSessions = showSourceFilter
    ? sessions.filter((session) => {
        if (sourceFilter === 'all') return true;
        // 这里可以根据会话的 model 或其他字段判断来源
        // 暂时返回所有会话
        return true;
      })
    : sessions;

  return (
    <div className="flex flex-col h-full">
      {/* 新建会话按钮 */}
      <div className="p-4">
        <button
          onClick={onCreateNew}
          className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
        >
          <Plus size={18} />
          <span>新建会话</span>
        </button>
      </div>

      {/* 来源筛选 */}
      {showSourceFilter && (
        <div className="px-4 pb-3 border-b border-gray-700/50">
          <div className="flex items-center space-x-2 mb-2">
            <Filter size={14} className="text-gray-500" />
            <span className="text-xs font-medium text-gray-400">来源筛选</span>
          </div>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-[#0F172A] border border-gray-600 text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            {SOURCE_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto">
        {filteredSessions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <MessageSquare className="mx-auto h-12 w-12 text-gray-600 mb-3" />
            <p className="text-sm text-gray-500">暂无会话</p>
            <p className="text-xs text-gray-500 mt-1">点击上方按钮创建新会话</p>
          </div>
        ) : (
          filteredSessions.map((session) => (
            <div
              key={session.id}
              className={`group px-4 py-3 cursor-pointer border-l-2 transition-colors ${
                currentSessionId === session.id
                  ? 'bg-primary-600/15 border-primary-500'
                  : 'border-transparent hover:bg-dark-surface-hover'
              }`}
              onClick={() => onSelect(session)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-gray-100 truncate">
                    {session.summary || '新会话'}
                  </h4>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className="text-xs text-gray-500">
                      {session.messageCount || 0} 条消息
                    </span>
                    {session.lastActivity && (
                      <>
                        <span className="text-xs text-gray-600">•</span>
                        <span className="text-xs text-gray-500">
                          {formatTime(session.lastActivity)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-red-400 hover:bg-red-900/20 rounded transition-all"
                  title="删除会话"
                  aria-label="删除会话"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
