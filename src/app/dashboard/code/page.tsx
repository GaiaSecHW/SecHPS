'use client';

import { useEffect, useState } from 'react';
import {
  Code,
  Search,
  Folder,
  File,
  RefreshCw,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';

interface CodeKnowledge {
  id: string;
  entityType: string;
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd: number | null;
  signature: string | null;
  summary: string | null;
  riskScore: number | null;
}

interface ProjectStructure {
  projectId: string;
  structure: FileTreeNode;
  fileCount: number;
  codeCount: number;
  languageStats: Record<string, number>;
  status: string;
  analyzedAt: string | null;
}

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  language?: string;
  size?: number;
}

export default function CodePage() {
  const [projects, setProjects] = useState<Array<{id: string; name: string}>>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [structure, setStructure] = useState<ProjectStructure | null>(null);
  const [knowledge, setKnowledge] = useState<CodeKnowledge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetchStructure();
      fetchKnowledge();
    }
  }, [selectedProject]);

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
        if (data.projects?.length > 0) {
          setSelectedProject(data.projects[0].id);
        }
      }
    } catch (err) {
      console.error('获取项目列表失败:', err);
    }
  };

  const fetchStructure = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/code/${selectedProject}/structure`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setStructure(data.structure);
      } else {
        setStructure(null);
      }
    } catch (err) {
      console.error('获取代码结构失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchKnowledge = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/code/${selectedProject}/knowledge`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setKnowledge(data.knowledge || []);
      }
    } catch (err) {
      console.error('获取代码知识失败:', err);
    }
  };

  const handleAnalyze = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/code/${selectedProject}/analyze`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        fetchStructure();
        fetchKnowledge();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败');
    } finally {
      setLoading(false);
    }
  };

  const togglePath = (path: string) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  };

  const renderTreeNode = (node: FileTreeNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const isDirectory = node.type === 'directory';

    return (
      <div key={node.path}>
        <div
          className={`flex items-center py-1 px-2 hover:bg-gray-100 rounded cursor-pointer`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => isDirectory && togglePath(node.path)}
        >
          {isDirectory ? (
            <>
              {isExpanded ? (
                <ChevronDown size={16} className="text-gray-400" />
              ) : (
                <ChevronRight size={16} className="text-gray-400" />
              )}
              <Folder size={16} className="mr-2 text-yellow-500" />
            </>
          ) : (
            <>
              <span className="w-4" />
              <File size={16} className="mr-2 text-gray-400" />
            </>
          )}
          <span className="text-sm text-gray-700">{node.name}</span>
          {node.language && (
            <span className="ml-2 text-xs text-gray-400">({node.language})</span>
          )}
        </div>
        {isDirectory && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">代码理解</h1>
          <p className="mt-1 text-sm text-gray-600">
            分析代码结构，提取代码知识
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={handleAnalyze}
            disabled={loading || !selectedProject}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <RefreshCw size={20} className="mr-2 animate-spin" />
            ) : (
              <Code size={20} className="mr-2" />
            )}
            分析代码
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* File Structure */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-4">文件结构</h3>
          {structure ? (
            <div className="max-h-96 overflow-y-auto">
              {structure.structure && renderTreeNode(structure.structure)}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Folder className="mx-auto h-12 w-12 text-gray-400 mb-2" />
              <p>选择项目并分析代码以查看结构</p>
            </div>
          )}
          {structure && (
            <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-500">文件数</span>
                <p className="font-semibold text-gray-900">{structure.fileCount}</p>
              </div>
              <div>
                <span className="text-gray-500">代码文件</span>
                <p className="font-semibold text-gray-900">{structure.codeCount}</p>
              </div>
              <div>
                <span className="text-gray-500">状态</span>
                <p className="font-semibold text-gray-900">{structure.status}</p>
              </div>
            </div>
          )}
        </div>

        {/* Code Knowledge */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-4">代码知识</h3>
          {knowledge.length > 0 ? (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {knowledge.map((item) => (
                <div key={item.id} className="p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      item.entityType === 'function' ? 'bg-blue-100 text-blue-800' :
                      item.entityType === 'class' ? 'bg-purple-100 text-purple-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {item.entityType}
                    </span>
                    {item.riskScore !== null && (
                      <span className={`text-xs ${
                        item.riskScore > 0.7 ? 'text-red-600' :
                        item.riskScore > 0.4 ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        风险: {(item.riskScore * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <h4 className="mt-2 font-medium text-gray-900">{item.name}</h4>
                  <p className="text-sm text-gray-500">
                    {item.filePath}:{item.lineStart}
                  </p>
                  {item.summary && (
                    <p className="mt-1 text-sm text-gray-600">{item.summary}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Code className="mx-auto h-12 w-12 text-gray-400 mb-2" />
              <p>分析代码后显示代码知识</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
