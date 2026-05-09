'use client';

import { useState, useEffect } from 'react';
import {
  Folder, FolderOpen, File, FileCode, ChevronRight, ChevronDown,
  Search, RefreshCw, Loader2, X,
} from 'lucide-react';
import { extractErrorMessage } from '@/lib/api-client';

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  language?: string;
  children?: FileTreeNode[];
}

interface ClaudeFileBrowserProps {
  projectName: string;
  projectPath: string;
  onFileSelect: (path: string, language: string) => void;
  selectedPath?: string;
}

export default function ClaudeFileBrowser({
  projectName,
  projectPath,
  onFileSelect,
  selectedPath,
}: ClaudeFileBrowserProps) {
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const fetchFiles = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/claude/${encodeURIComponent(projectName)}/files/browse`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(extractErrorMessage(data, '获取文件列表失败'));
        return;
      }

      const data = await response.json();
      setFiles(data.files || []);
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectName) {
      fetchFiles();
    }
  }, [projectName]);

  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const filterFiles = (nodes: FileTreeNode[], query: string): FileTreeNode[] => {
    if (!query) return nodes;
    const lower = query.toLowerCase();
    
    return nodes.reduce<FileTreeNode[]>((acc, node) => {
      if (node.name.toLowerCase().includes(lower)) {
        acc.push(node);
      } else if (node.children) {
        const filtered = filterFiles(node.children, query);
        if (filtered.length > 0) {
          acc.push({ ...node, children: filtered });
        }
      }
      return acc;
    }, []);
  };

  const renderNode = (node: FileTreeNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center space-x-2 px-2 py-1 cursor-pointer hover:bg-gray-100 rounded ${
            isSelected ? 'bg-blue-50' : ''
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            if (node.type === 'file') {
              onFileSelect(node.path, node.language || 'plaintext');
            } else {
              toggleExpand(node.path);
            }
          }}
        >
          {node.type === 'directory' && (
            <span className="flex-shrink-0">
              {isExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
            </span>
          )}
          {node.type === 'file' && <span className="w-4" />}
          {node.type === 'directory' ? (
            isExpanded ? <FolderOpen size={16} className="text-yellow-500" /> : <Folder size={16} className="text-yellow-500" />
          ) : (
            <FileCode size={16} className="text-blue-400" />
          )}
          <span className="flex-1 truncate text-sm">{node.name}</span>
          {node.size !== undefined && (
            <span className="text-xs text-gray-400">{(node.size / 1024).toFixed(1)}KB</span>
          )}
        </div>
        {node.type === 'directory' && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <p className="mt-2 text-sm text-gray-500">加载文件...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <X className="w-8 h-8 text-red-500" />
        <p className="mt-2 text-sm text-red-500">{error}</p>
        <button onClick={fetchFiles} className="mt-2 px-3 py-1 text-sm bg-blue-500 text-white rounded">
          重试
        </button>
      </div>
    );
  }

  const filteredFiles = filterFiles(files, searchQuery);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium truncate">{projectName}</h3>
          <button onClick={fetchFiles} className="p-1 text-gray-400 hover:text-gray-600">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {projectPath && (
          <p className="mt-1 text-xs text-gray-400 truncate" title={projectPath}>{projectPath}</p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {filteredFiles.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500">
            {searchQuery ? '没有匹配的文件' : '目录为空'}
          </div>
        ) : (
          filteredFiles.map(node => renderNode(node))
        )}
      </div>
    </div>
  );
}
