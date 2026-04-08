'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileText,
  FileJson,
  FileCog,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  Loader2,
  X,
} from 'lucide-react';

// 文件树节点接口
interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  language?: string;
  children?: FileTreeNode[];
}

// 文件图标颜色映射
const FILE_ICON_COLORS: Record<string, string> = {
  'TypeScript': 'text-blue-500',
  'TypeScript React': 'text-blue-600',
  'JavaScript': 'text-yellow-500',
  'JavaScript React': 'text-yellow-600',
  'CSS': 'text-purple-500',
  'SCSS': 'text-pink-500',
  'HTML': 'text-orange-500',
  'JSON': 'text-green-500',
  'Markdown': 'text-gray-500',
  'Python': 'text-green-400',
  'Java': 'text-red-500',
  'Go': 'text-cyan-500',
  'Rust': 'text-orange-600',
  'SQL': 'text-blue-400',
  'Prisma': 'text-teal-500',
  'YAML': 'text-red-400',
  'Shell': 'text-green-300',
  'Vue': 'text-emerald-500',
  'Svelte': 'text-orange-400',
};

// 扩展名到图标颜色映射
const EXTENSION_COLORS: Record<string, string> = {
  '.ts': 'text-blue-500',
  '.tsx': 'text-blue-600',
  '.js': 'text-yellow-500',
  '.jsx': 'text-yellow-600',
  '.css': 'text-purple-500',
  '.scss': 'text-pink-500',
  '.html': 'text-orange-500',
  '.json': 'text-green-500',
  '.md': 'text-gray-500',
  '.py': 'text-green-400',
  '.java': 'text-red-500',
  '.go': 'text-cyan-500',
  '.rs': 'text-orange-600',
  '.sql': 'text-blue-400',
  '.prisma': 'text-teal-500',
  '.yaml': 'text-red-400',
  '.yml': 'text-red-400',
  '.sh': 'text-green-300',
  '.vue': 'text-emerald-500',
  '.svelte': 'text-orange-400',
  '.xml': 'text-orange-500',
  '.env': 'text-yellow-400',
};

interface FileBrowserProps {
  projectId: string;
  onFileSelect: (path: string, language: string) => void;
  selectedPath?: string;
}

export default function FileBrowser({ projectId, onFileSelect, selectedPath }: FileBrowserProps) {
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [projectPath, setProjectPath] = useState('');
  const [projectName, setProjectName] = useState('');

  // 获取文件树
  const fetchFiles = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/files/${projectId}/browse`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: '获取文件列表失败' }));
        setError(data.error || '获取文件列表失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      setFiles(data.files || []);
      setProjectPath(data.projectPath || '');
      setProjectName(data.projectName || '');
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [projectId]);

  // 切换目录展开状态
  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  // 处理文件点击
  const handleFileClick = (node: FileTreeNode) => {
    if (node.type === 'file') {
      onFileSelect(node.path, node.language || 'Unknown');
    } else {
      toggleExpand(node.path);
    }
  };

  // 过滤文件树
  const filterFiles = (nodes: FileTreeNode[], query: string): FileTreeNode[] => {
    if (!query) return nodes;

    const lowerQuery = query.toLowerCase();
    const result: FileTreeNode[] = [];

    for (const node of nodes) {
      if (node.name.toLowerCase().includes(lowerQuery)) {
        result.push(node);
      } else if (node.children) {
        const filteredChildren = filterFiles(node.children, query);
        if (filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren });
        }
      }
    }

    return result;
  };

  // 获取文件图标
  const getFileIcon = (node: FileTreeNode) => {
    if (node.type === 'directory') {
      const isExpanded = expandedPaths.has(node.path);
      return isExpanded ? (
        <FolderOpen size={18} className="text-yellow-500" />
      ) : (
        <Folder size={18} className="text-yellow-500" />
      );
    }

    const language = node.language || '';
    const colorClass = FILE_ICON_COLORS[language] || 'text-gray-400';

    // 根据语言类型选择图标
    if (language.includes('JavaScript') || language.includes('TypeScript') || language.includes('Python') || language.includes('Java') || language.includes('Go') || language.includes('Rust')) {
      return <FileCode size={18} className={colorClass} />;
    }

    if (language === 'JSON' || language === 'YAML' || language === 'XML') {
      return <FileJson size={18} className={colorClass} />;
    }

    if (language === 'Markdown' || language === 'Plain Text') {
      return <FileText size={18} className={colorClass} />;
    }

    if (language === 'Environment' || language === 'INI' || language === 'TOML') {
      return <FileCog size={18} className={colorClass} />;
    }

    return <File size={18} className={colorClass} />;
  };

  // 格式化文件大小
  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(1)} ${units[i]}`;
  };

  // 渲染文件树节点
  const renderNode = (node: FileTreeNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedPath === node.path;
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center space-x-2 px-2 py-1 cursor-pointer hover:bg-gray-100 rounded transition-colors ${
            isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : ''
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => handleFileClick(node)}
        >
          {node.type === 'directory' && (
            <span className="flex-shrink-0">
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown size={16} className="text-gray-400" />
                ) : (
                  <ChevronRight size={16} className="text-gray-400" />
                )
              ) : (
                <span className="w-4" />
              )}
            </span>
          )}
          {node.type === 'file' && <span className="w-4" />}
          {getFileIcon(node)}
          <span className="flex-1 truncate text-sm text-gray-700">{node.name}</span>
          {node.size !== undefined && (
            <span className="text-xs text-gray-400">{formatSize(node.size)}</span>
          )}
        </div>
        {node.type === 'directory' && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // 过滤后的文件树
  const filteredFiles = useMemo(() => {
    return filterFiles(files, searchQuery);
  }, [files, searchQuery]);

  // 加载状态
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <Loader2 className="animate-spin h-8 w-8 text-blue-500" />
        <p className="mt-2 text-sm text-gray-500">加载文件列表...</p>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <X className="h-8 w-8 text-red-500" />
        <p className="mt-2 text-sm text-red-500">{error}</p>
        <button
          onClick={fetchFiles}
          className="mt-4 px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex-shrink-0 border-b border-gray-200 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-700 truncate">
            {projectName || '项目文件'}
          </h3>
          <button
            onClick={fetchFiles}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
            title="刷新"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* 项目路径 */}
        {projectPath && (
          <p className="mt-2 text-xs text-gray-400 truncate" title={projectPath}>
            {projectPath}
          </p>
        )}
      </div>

      {/* 文件树 */}
      <div className="flex-1 overflow-y-auto py-2">
        {filteredFiles.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500">
            {searchQuery ? '没有匹配的文件' : '项目目录为空'}
          </div>
        ) : (
          filteredFiles.map((node) => renderNode(node))
        )}
      </div>

      {/* 底部统计 */}
      <div className="flex-shrink-0 border-t border-gray-200 p-2 text-xs text-gray-400">
        {filteredFiles.length} 个项目
        {searchQuery && ` (筛选自 ${files.length} 个)`}
      </div>
    </div>
  );
}
