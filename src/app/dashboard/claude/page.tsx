'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Plus, MessageSquare, Trash2, X, RefreshCw, FolderOpen,
  ExternalLink, Terminal, Play, ChevronDown, ChevronRight, Search, Zap
} from 'lucide-react';

// Claude 会话类型
interface ClaudeSession {
  id: string;
  summary: string;
  lastActivity: string;
  messageCount?: number;
  model?: string;
}

// Claude 项目类型
interface ClaudeProject {
  name: string;
  path: string;
  displayName?: string;
  lastActivity?: string;
  sessions?: ClaudeSession[];
  sessionCount?: number;
  cursorSessions?: ClaudeSession[];
  codexSessions?: ClaudeSession[];
  geminiSessions?: ClaudeSession[];
}

export default function ClaudePage() {
  const router = useRouter();
  
  // 状态
  const [projects, setProjects] = useState<ClaudeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  
  // 模态框
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectPath, setNewProjectPath] = useState('');
  
  // 统计
  const [stats, setStats] = useState({
    projectCount: 0,
    totalSessions: 0,
    cursorSessions: 0,
    codexSessions: 0,
    geminiSessions: 0,
  });

  // 获取项目列表
  const fetchProjects = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setRefreshing(true);
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/claude', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('token');
          router.push('/login');
          return;
        }
        setError('获取项目列表失败');
        return;
      }

      const data = await response.json();
      setProjects(data.projects || []);
      setStats({
        projectCount: data.totalProjects || 0,
        totalSessions: data.totalSessions || 0,
        cursorSessions: data.cursorSessions || 0,
        codexSessions: data.codexSessions || 0,
        geminiSessions: data.geminiSessions || 0,
      });
      setError('');
    } catch (err) {
      setError('网络错误');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  // 展开/折叠
  const toggleExpand = (name: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  // 添加项目
  const addProject = async () => {
    if (!newProjectPath.trim()) {
      toast.error('请输入项目路径');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/claude/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ path: newProjectPath }),
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '添加失败');
        return;
      }

      fetchProjects(false);
    } catch (err) {
      toast.error('添加出错');
    }
  };

  // 删除项目
  const deleteProject = async (name: string) => {
    if (!confirm('确定删除该项目？')) return;

    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/claude/projects/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchProjects(false);
    } catch (err) {
      toast.error('删除失败');
    }
  };

  // 格式化时间
  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${Math.floor(diff / 86400000)} 天前`;
  };

  // 过滤
  const filtered = projects.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || 
           p.displayName?.toLowerCase().includes(q) ||
           p.path.toLowerCase().includes(q);
  });

  const multiSource = filtered.find(p => p.name === 'multi-source-sessions');
  const regularProjects = filtered.filter(p => p.name !== 'multi-source-sessions');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Claude 会话</h1>
          <p className="text-sm text-gray-600 mt-1">管理和浏览所有 Claude Code 项目与多源会话</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => fetchProjects(false)}
            disabled={refreshing}
            className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            <Plus size={20} />
            <span>添加项目</span>
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">项目总数</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{stats.projectCount}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-full">
              <FolderOpen size={24} className="text-blue-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">会话总数</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{stats.totalSessions}</p>
            </div>
            <div className="p-3 bg-green-50 rounded-full">
              <MessageSquare size={24} className="text-green-600" />
            </div>
          </div>
        </div>
      </div>

      {/* 搜索 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="搜索项目..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* 错误 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* 项目列表 */}
      {regularProjects.length === 0 && !multiSource ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <FolderOpen className="mx-auto h-16 w-16 text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900">暂无项目</h3>
          <p className="mt-2 text-sm text-gray-500 max-w-sm mx-auto">
            添加一个 Claude Code 项目路径，系统将自动扫描并管理该项目的所有会话
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-6 px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors inline-flex items-center space-x-2"
          >
            <Plus size={20} />
            <span>添加第一个项目</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {regularProjects.map((project) => {
            const expanded = expandedProjects.has(project.name);
            const sessions = project.sessions || [];
            const sessionCount = project.sessionCount ?? sessions.length;
            const lastActivity = sessions[0]?.lastActivity || project.lastActivity;
            
            return (
              <div key={project.name} className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                <div
                  className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleExpand(project.name)}
                >
                  <div className="flex items-center space-x-4 flex-1 min-w-0">
                    <button
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      aria-label={expanded ? '折叠' : '展开'}
                    >
                      {expanded ? <ChevronDown size={20} className="text-gray-400" /> : <ChevronRight size={20} className="text-gray-400" />}
                    </button>
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <FolderOpen size={24} className="text-blue-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {project.displayName || project.name}
                        </h3>
                        {sessionCount > 0 && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {sessionCount} 会话
                          </span>
                        )}
                      </div>
                      {project.path && (
                        <p className="text-sm text-gray-500 truncate mt-0.5">{project.path}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    {lastActivity && (
                      <span className="text-xs text-gray-400">
                        {formatTime(lastActivity)}
                      </span>
                    )}
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        router.push(`/dashboard/claude/${encodeURIComponent(project.name)}`); 
                      }}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="打开对话"
                      aria-label="打开对话"
                    >
                      <Play size={18} />
                    </button>
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        deleteProject(project.name); 
                      }}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="删除项目"
                      aria-label="删除项目"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                {expanded && sessions.length > 0 && (
                  <div className="border-t border-gray-200 bg-gray-50">
                    <div className="px-6 py-2 flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">最近会话</p>
                      {sessionCount > 5 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/dashboard/claude/${encodeURIComponent(project.name)}`);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                        >
                          查看全部 {sessionCount} 个会话 →
                        </button>
                      )}
                    </div>
                    {sessions.slice(0, 5).map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center justify-between px-6 py-3 hover:bg-white cursor-pointer border-t border-gray-100 transition-colors group"
                        onClick={() => router.push(`/dashboard/claude/${encodeURIComponent(project.name)}?session=${session.id}`)}
                      >
                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                          <MessageSquare size={16} className="text-gray-400 group-hover:text-blue-600 transition-colors" />
                          <span className="text-sm text-gray-700 truncate flex-1">{session.summary || '新会话'}</span>
                        </div>
                        <div className="flex items-center space-x-3 text-xs text-gray-400">
                          <span>{session.messageCount || 0} 条消息</span>
                          {session.lastActivity && (
                            <span>{formatTime(session.lastActivity)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* 多源会话 */}
          {multiSource && ((multiSource.cursorSessions?.length ?? 0) > 0 || (multiSource.codexSessions?.length ?? 0) > 0 || (multiSource.geminiSessions?.length ?? 0) > 0) && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
              <div
                className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleExpand('multi-source-sessions')}
              >
                <div className="flex items-center space-x-4">
                  <button
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                    aria-label={expandedProjects.has('multi-source-sessions') ? '折叠' : '展开'}
                  >
                    {expandedProjects.has('multi-source-sessions') ? <ChevronDown size={20} className="text-gray-400" /> : <ChevronRight size={20} className="text-gray-400" />}
                  </button>
                  <div className="p-2 bg-yellow-50 rounded-lg">
                    <Zap size={24} className="text-yellow-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">多源会话</h3>
                    <p className="text-sm text-gray-500">来自 Cursor、Codex、Gemini 的会话</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  {(multiSource.cursorSessions?.length ?? 0) > 0 && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                      {multiSource.cursorSessions?.length} Cursor
                    </span>
                  )}
                  {(multiSource.codexSessions?.length ?? 0) > 0 && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      {multiSource.codexSessions?.length} Codex
                    </span>
                  )}
                  {(multiSource.geminiSessions?.length ?? 0) > 0 && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                      {multiSource.geminiSessions?.length} Gemini
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 添加项目模态框 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">添加项目</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewProjectPath('');
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="关闭"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <label htmlFor="projectPath" className="block text-sm font-medium text-gray-700 mb-2">
                项目路径
              </label>
              <input
                id="projectPath"
                type="text"
                value={newProjectPath}
                onChange={(e) => setNewProjectPath(e.target.value)}
                placeholder="例如: D:\my-project 或 /Users/name/project"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              />
              <p className="mt-3 text-xs text-gray-500">
                输入包含 Claude Code 会话的项目目录路径，系统将自动扫描并列出所有会话
              </p>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewProjectPath('');
                }}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
              >
                取消
              </button>
              <button
                onClick={addProject}
                disabled={!newProjectPath.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                添加项目
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
