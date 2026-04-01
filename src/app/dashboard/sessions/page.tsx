'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, MessageSquare, Share2, RotateCcw, Trash2, Upload, X, File, AlertCircle, CheckCircle, Play, Edit2, Download, History, Settings, Shield, Square, Zap } from 'lucide-react';

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
  file?: File;
}

interface ProjectFile {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
  uploadedAt: string;
}

interface EvaluationRecord {
  id: string;
  opencodeSessionId: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  projectPath?: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  files?: ProjectFile[];
  evaluations?: EvaluationRecord[];
  config?: any;
  createdAt: string;
  updatedAt: string;
  // 环境配置字段
  environmentUrl?: string;
  adminUsername?: string;
  adminPassword?: string;
  normalUsername?: string;
  normalPassword?: string;
}

export default function SessionsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showFilesModal, setShowFilesModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showEnvConfigModal, setShowEnvConfigModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [startingProject, setStartingProject] = useState<string | null>(null);
  // 环境配置表单状态
  const [environmentUrl, setEnvironmentUrl] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [normalUsername, setNormalUsername] = useState('');
  const [normalPassword, setNormalPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const filesModalInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '获取项目列表失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      setProjects(data.projects || []);
      setLoading(false);
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: UploadedFile[] = [];
    const maxSize = 5 * 1024 * 1024 * 1024; // 5GB

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // 检查文件大小
      if (file.size > maxSize) {
        alert(`文件 ${file.name} 超过 5GB 限制，无法上传`);
        continue;
      }

      // 检查文件格式
      const allowedTypes = [
        // 压缩包格式
        '.zip', '.jar', '.war', '.ear', '.tar', '.gz', '.rar', '.7z',
        // 文档格式
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
        // 其他常见格式
        '.md', '.csv', '.json', '.xml', '.yaml', '.yml'
      ];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!allowedTypes.includes(ext)) {
        alert(`文件 ${file.name} 格式不支持，仅支持 ZIP、JAR 等格式`);
        continue;
      }

      newFiles.push({
        id: `${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        status: 'pending',
        file: file,
      });
    }

    setUploadedFiles(prev => [...prev, ...newFiles]);

    // 清空 input 以便重复选择相同文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAdditionalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: UploadedFile[] = [];
    const maxSize = 5 * 1024 * 1024 * 1024; // 5GB

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.size > maxSize) {
        alert(`文件 ${file.name} 超过 5GB 限制，无法上传`);
        continue;
      }

      const allowedTypes = [
        '.zip', '.jar', '.war', '.ear', '.tar', '.gz', '.rar', '.7z',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
        '.md', '.csv', '.json', '.xml', '.yaml', '.yml'
      ];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!allowedTypes.includes(ext)) {
        alert(`文件 ${file.name} 格式不支持`);
        continue;
      }

      newFiles.push({
        id: `${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        status: 'pending',
        file: file,
      });
    }

    setUploadedFiles(prev => [...prev, ...newFiles]);

    if (editFileInputRef.current) {
      editFileInputRef.current.value = '';
    }
  };

  const handleFilesModalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: UploadedFile[] = [];
    const maxSize = 5 * 1024 * 1024 * 1024; // 5GB

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.size > maxSize) {
        alert(`文件 ${file.name} 超过 5GB 限制，无法上传`);
        continue;
      }

      const allowedTypes = [
        '.zip', '.jar', '.war', '.ear', '.tar', '.gz', '.rar', '.7z',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
        '.md', '.csv', '.json', '.xml', '.yaml', '.yml'
      ];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!allowedTypes.includes(ext)) {
        alert(`文件 ${file.name} 格式不支持`);
        continue;
      }

      newFiles.push({
        id: `${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        status: 'pending',
        file: file,
      });
    }

    setUploadedFiles(prev => [...prev, ...newFiles]);

    if (filesModalInputRef.current) {
      filesModalInputRef.current.value = '';
    }
  };

  const uploadAdditionalFiles = async () => {
    if (!selectedProject || uploadedFiles.length === 0) {
      return;
    }

    setUploadingFiles(true);

    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();

      for (const uploadedFile of uploadedFiles) {
        if (uploadedFile.file) {
          formData.append('files', uploadedFile.file);
        }
      }

      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'uploading' as const })));

      const response = await fetch(`/api/projects/${selectedProject.id}/files`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '上传文件失败');
        setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'error' as const, error: data.error })));
        setUploadingFiles(false);
        return;
      }

      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'success' as const })));

      // 刷新项目信息
      await fetchProjects();
      
      // 更新选中的项目
      const updatedProjects = projects.find(p => p.id === selectedProject.id);
      if (updatedProjects) {
        const token = localStorage.getItem('token');
        const detailResponse = await fetch(`/api/projects/${selectedProject.id}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (detailResponse.ok) {
          const detailData = await detailResponse.json();
          setSelectedProject(detailData.project);
        }
      }

      // 清空文件列表
      setTimeout(() => {
        setUploadedFiles([]);
      }, 1000);

    } catch (err) {
      alert('网络错误，请重试');
      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'error' as const, error: '网络错误' })));
    } finally {
      setUploadingFiles(false);
    }
  };

  const removeFile = (fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getTotalSize = (): number => {
    return uploadedFiles.reduce((total, file) => total + file.size, 0);
  };

  const clearAllFiles = () => {
    setUploadedFiles([]);
  };

  const createProject = async () => {
    if (!projectName.trim()) {
      alert('请输入项目名称');
      return;
    }

    if (uploadedFiles.length === 0) {
      alert('请至少上传一个文件');
      return;
    }

    setUploading(true);

    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('name', projectName);
      formData.append('description', projectDescription);

      // 从 uploadedFiles 中获取文件对象
      for (const uploadedFile of uploadedFiles) {
        if (uploadedFile.file) {
          formData.append('files', uploadedFile.file);
        }
      }

      // 更新文件状态为上传中
      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'uploading' as const })));

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '创建项目失败');
        setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'error' as const, error: data.error })));
        setUploading(false);
        return;
      }

      // 更新文件状态为成功
      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'success' as const })));

      // 重置表单
      setTimeout(() => {
        setShowCreateModal(false);
        setProjectName('');
        setProjectDescription('');
        setUploadedFiles([]);
      }, 1000);

      await fetchProjects();
    } catch (err) {
      alert('网络错误，请重试');
      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'error' as const, error: '网络错误' })));
    } finally {
      setUploading(false);
    }
  };

  const startProject = async (projectId: string) => {
    setStartingProject(projectId);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '启动项目失败');
        return;
      }

      await fetchProjects();
    } catch (err) {
      alert('网络错误，请重试');
    } finally {
      setStartingProject(null);
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!confirm('确定要删除这个项目吗？删除后将无法恢复。')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '删除项目失败');
        return;
      }

      await fetchProjects();
    } catch (err) {
      alert('网络错误，请重试');
    }
  };

  const openEditModal = (project: Project) => {
    setSelectedProject(project);
    setProjectName(project.name || '');
    setProjectDescription(project.description || '');
    setUploadedFiles([]);
    setShowEditModal(true);
  };

  const openFilesModal = (project: Project) => {
    setSelectedProject(project);
    setShowFilesModal(true);
  };

  const openHistoryModal = async (project: Project) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${project.id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '获取项目详情失败');
        return;
      }

      const data = await response.json();
      setSelectedProject(data.project);
      setShowHistoryModal(true);
    } catch (err) {
      alert('网络错误，请重试');
    }
  };

  const openEnvConfigModal = (project: Project) => {
    setSelectedProject(project);
    setEnvironmentUrl(project.environmentUrl || '');
    setAdminUsername(project.adminUsername || '');
    setAdminPassword('');
    setNormalUsername(project.normalUsername || '');
    setNormalPassword('');
    setShowEnvConfigModal(true);
  };

  const saveEnvConfig = async () => {
    if (!selectedProject) {
      return;
    }

    setUploading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${selectedProject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          environmentUrl: environmentUrl || undefined,
          adminUsername: adminUsername || undefined,
          adminPassword: adminPassword || undefined,
          normalUsername: normalUsername || undefined,
          normalPassword: normalPassword || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '保存环境配置失败');
        setUploading(false);
        return;
      }

      setShowEnvConfigModal(false);
      setSelectedProject(null);
      setEnvironmentUrl('');
      setAdminUsername('');
      setAdminPassword('');
      setNormalUsername('');
      setNormalPassword('');

      await fetchProjects();
    } catch (err) {
      alert('网络错误，请重试');
    } finally {
      setUploading(false);
    }
  };

  const handleAIPenetration = (project: Project) => {
    // 检查是否配置了环境 URL
    if (!project.environmentUrl) {
      alert('请先配置环境 URL（点击设置按钮进行配置）');
      return;
    }
    // TODO: 调用 AI 渗透测试 API
    alert(`环境 AI 渗透功能开发中\n\n目标环境: ${project.environmentUrl}`);
  };

  const downloadFile = async (projectId: string, fileId: string, fileName: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}/files/${fileId}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '下载文件失败');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert('下载文件失败，请重试');
    }
  };

  const deleteFile = async (projectId: string, fileId: string) => {
    if (!confirm('确定要删除这个文件吗？')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}/files/${fileId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '删除文件失败');
        return;
      }

      // 刷新项目信息
      await fetchProjects();
      
      // 更新选中的项目
      if (selectedProject) {
        const updatedProject = projects.find(p => p.id === projectId);
        if (updatedProject) {
          setSelectedProject(updatedProject);
        }
      }
    } catch (err) {
      alert('网络错误，请重试');
    }
  };

  const updateProject = async () => {
    if (!selectedProject || !projectName.trim()) {
      alert('请输入项目名称');
      return;
    }

    setUploading(true);

    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('name', projectName);
      formData.append('description', projectDescription);

      // 添加新文件
      for (const uploadedFile of uploadedFiles) {
        if (uploadedFile.file) {
          formData.append('files', uploadedFile.file);
        }
      }

      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'uploading' as const })));

      const response = await fetch(`/api/projects/${selectedProject.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '更新项目失败');
        setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'error' as const, error: data.error })));
        setUploading(false);
        return;
      }

      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'success' as const })));

      setTimeout(() => {
        setShowEditModal(false);
        setSelectedProject(null);
        setProjectName('');
        setProjectDescription('');
        setUploadedFiles([]);
      }, 1000);

      await fetchProjects();
    } catch (err) {
      alert('网络错误，请重试');
      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'error' as const, error: '网络错误' })));
    } finally {
      setUploading(false);
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'running':
        return '运行中';
      case 'completed':
        return '已完成';
      case 'failed':
        return '失败';
      default:
        return '待启动';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">项目管理</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理 AI 编程项目
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus size={20} />
          <span>新建项目</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <MessageSquare className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            暂无项目
          </h3>
          <p className="mt-2 text-sm text-gray-600">
            创建您的第一个项目开始 AI 编程
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
            >
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {project.name || '未命名项目'}
                  </h3>
                  <span
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border"
                  >
                    {getStatusText(project.status)}
                  </span>
                </div>

                {project.description && (
                  <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                    {project.description}
                  </p>
                )}

                <p className="mt-2 text-sm text-gray-600">
                  创建于 {new Date(project.createdAt).toLocaleDateString()}
                </p>

                {project.projectPath && (
                  <p className="mt-1 text-xs text-gray-500 flex items-center">
                    <span className="truncate max-w-[300px]" title={project.projectPath}>
                      目录: {project.projectPath}
                    </span>
                  </p>
                )}

                {project.files && project.files.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    文件数: {project.files.length}
                  </p>
                )}
              </div>

              {/* 当前运行中的评估会话信息 */}
              {project.evaluations?.some((e: any) => e.status === 'running') && (
                <div className="bg-blue-50 px-6 py-2 border-t border-blue-100">
                  {(() => {
                    const runningEval = project.evaluations.find((e: any) => e.status === 'running');
                    if (!runningEval) return null;
                    return (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                          <span className="text-sm text-blue-700">
                            评估运行中
                          </span>
                          <span className="text-xs text-blue-600">
                            开始于 {new Date(runningEval.startedAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <div className="flex space-x-2">
                          <Link
                            href={`/dashboard/sessions/${project.id}?evaluationId=${runningEval.id}`}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            查看详情
                          </Link>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 最新完成的评估会话信息 */}
              {!project.evaluations?.some((e: any) => e.status === 'running') && 
               project.evaluations?.length > 0 && (
                <div className="bg-gray-50 px-6 py-2 border-t border-gray-100">
                  {(() => {
                    const latestEval = project.evaluations
                      .filter((e: any) => e.status === 'completed' || e.status === 'failed')
                      .sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
                    if (!latestEval) return null;
                    return (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className={`w-2 h-2 rounded-full ${
                            latestEval.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
                          }`}></span>
                          <span className="text-sm text-gray-600">
                            最新评估: {latestEval.status === 'completed' ? '已完成' : '失败'}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(latestEval.startedAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                        <div className="flex space-x-2">
                          <Link
                            href={`/dashboard/sessions/${project.id}?evaluationId=${latestEval.id}`}
                            className="text-xs text-gray-600 hover:text-gray-800"
                          >
                            查看
                          </Link>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
                {/* 第一行：黑盒渗透、环境配置 */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleAIPenetration(project)}
                      disabled={!project.environmentUrl}
                      className={`flex items-center space-x-1 px-3 py-1 text-sm font-medium ${
                        project.environmentUrl
                          ? 'text-purple-600 hover:text-purple-800'
                          : 'text-gray-400 cursor-not-allowed'
                      }`}
                      title={project.environmentUrl ? '黑盒渗透测试' : '请先配置环境URL'}
                    >
                      <Shield size={16} />
                      <span>黑盒渗透</span>
                    </button>
                    <button
                      onClick={() => openEnvConfigModal(project)}
                      className="flex items-center space-x-1 px-3 py-1 text-sm font-medium text-gray-600 hover:text-gray-800"
                      title="环境配置"
                    >
                      <Settings size={16} />
                      <span>环境配置</span>
                    </button>
                  </div>
                </div>
                {/* 第二行：启动评估、编辑、文件管理、删除 或 当前会话操作 */}
                <div className="flex items-center justify-between">
                  <div className="flex space-x-2">
                    {/* 检查是否有运行中的评估 */}
                    {project.evaluations?.some((e: any) => e.status === 'running') ? (
                      <>
                        {/* 运行中的会话操作 */}
                        {(() => {
                          const runningEval = project.evaluations.find((e: any) => e.status === 'running');
                          return (
                            <>
                            <button
                              onClick={async () => {
                                  if (!runningEval) return;
                                  if (!confirm('确定要停止当前评估吗？')) return;
                                  try {
                                    const token = localStorage.getItem('token');
                                    const res = await fetch(`/api/evaluations/${runningEval.id}/stop`, {
                                      method: 'POST',
                                      headers: { Authorization: `Bearer ${token}` },
                                    });
                                    if (res.ok) {
                                      fetchProjects();
                                    } else {
                                      const data = await res.json();
                                      alert(data.error || '停止失败');
                                    }
                                  } catch (err) {
                                    alert('停止失败');
                                  }
                                }}
                                className="flex items-center space-x-1 px-3 py-1 text-sm font-medium text-orange-600 hover:text-orange-800"
                              >
                                <Square size={16} />
                                <span>停止</span>
                              </button>
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        {/* 无运行中的会话：显示启动评估 */}
                        <button
                          onClick={() => startProject(project.id)}
                          disabled={startingProject === project.id}
                          className="flex items-center space-x-1 px-3 py-1 text-sm font-medium text-green-600 hover:text-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Play size={16} />
                          <span>启动评估</span>
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => openEditModal(project)}
                      className="p-1 text-gray-400 hover:text-blue-600"
                      title="编辑"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => openFilesModal(project)}
                      className="p-1 text-gray-400 hover:text-blue-600"
                      title="文件管理"
                    >
                      <File size={16} />
                    </button>
                    <button
                      onClick={() => openHistoryModal(project)}
                      className="p-1 text-gray-400 hover:text-blue-600"
                      title="评估历史"
                    >
                      <History size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建项目对话框 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">新建项目</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setProjectName('');
                  setProjectDescription('');
                  setUploadedFiles([]);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="projectName" className="block text-sm font-medium text-gray-700">
                  项目名称 *
                </label>
                <input
                  id="projectName"
                  type="text"
                  required
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入项目名称"
                />
              </div>

              <div>
                <label htmlFor="projectDescription" className="block text-sm font-medium text-gray-700">
                  项目描述
                </label>
                <textarea
                  id="projectDescription"
                  rows={3}
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入项目描述（可选）"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  上传文件
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-md p-6">
                  <div className="text-center">
                    <Upload className="mx-auto h-12 w-12 text-gray-400" />
                    <div className="mt-4">
                      <label
                        htmlFor="file-upload"
                        className="cursor-pointer rounded-md font-medium text-blue-600 hover:text-blue-500"
                      >
                        <span>点击上传文件</span>
                        <input
                          id="file-upload"
                          type="file"
                          multiple
                          ref={fileInputRef}
                          onChange={handleFileSelect}
                          accept=".zip,.jar,.war,.ear,.tar,.gz,.rar,.7z,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.yaml,.yml"
                          className="sr-only"
                        />
                      </label>
                      <p className="pl-1">或拖拽文件到此处</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      支持多种格式：压缩包（ZIP、JAR、WAR、EAR、TAR、GZ、RAR、7Z）、
                      文档（PDF、DOC、DOCX、XLS、XLSX、PPT、PPTX、TXT、MD）、
                      数据（CSV、JSON、XML、YAML），单个文件最大 5GB
                    </p>
                  </div>
                </div>

                {uploadedFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-700">
                        已选择 {uploadedFiles.length} 个文件（共 {formatFileSize(getTotalSize())}）
                      </p>
                      <button
                        onClick={clearAllFiles}
                        disabled={uploading}
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        清空所有
                      </button>
                    </div>
                    {uploadedFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                      >
                        <div className="flex items-center space-x-3">
                          <File size={20} className="text-gray-400" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{file.name}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {file.status === 'uploading' && (
                            <div className="flex items-center space-x-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                              <span className="text-xs text-gray-500">上传中...</span>
                            </div>
                          )}
                          {file.status === 'success' && (
                            <CheckCircle size={20} className="text-green-500" />
                          )}
                          {file.status === 'error' && (
                            <div className="flex items-center space-x-2">
                              <AlertCircle size={20} className="text-red-500" />
                              <span className="text-xs text-red-500">{file.error}</span>
                            </div>
                          )}
                          {file.status === 'pending' && (
                            <button
                              onClick={() => removeFile(file.id)}
                              className="p-1 text-gray-400 hover:text-red-600"
                              title="移除文件"
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setProjectName('');
                  setProjectDescription('');
                  setUploadedFiles([]);
                }}
                disabled={uploading}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={createProject}
                disabled={uploading || !projectName.trim() || uploadedFiles.length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? '创建中...' : `创建项目${uploadedFiles.length > 0 ? `（${uploadedFiles.length} 个文件）` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑项目对话框 */}
      {showEditModal && selectedProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">编辑项目</h3>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedProject(null);
                  setProjectName('');
                  setProjectDescription('');
                  setUploadedFiles([]);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="editProjectName" className="block text-sm font-medium text-gray-700">
                  项目名称 *
                </label>
                <input
                  id="editProjectName"
                  type="text"
                  required
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label htmlFor="editProjectDescription" className="block text-sm font-medium text-gray-700">
                  项目描述
                </label>
                <textarea
                  id="editProjectDescription"
                  rows={3}
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  添加更多文件
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-md p-6">
                  <div className="text-center">
                    <Upload className="mx-auto h-12 w-12 text-gray-400" />
                    <div className="mt-4">
                      <label
                        htmlFor="edit-file-upload"
                        className="cursor-pointer rounded-md font-medium text-blue-600 hover:text-blue-500"
                      >
                        <span>点击上传更多文件</span>
                        <input
                          id="edit-file-upload"
                          type="file"
                          multiple
                          ref={editFileInputRef}
                          onChange={handleAdditionalFileSelect}
                          accept=".zip,.jar,.war,.ear,.tar,.gz,.rar,.7z,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.yaml,.yml"
                          className="sr-only"
                        />
                      </label>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      可添加更多文件到现有项目
                    </p>
                  </div>
                </div>

                {uploadedFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-700">
                        新增 {uploadedFiles.length} 个文件
                      </p>
                      <button
                        onClick={clearAllFiles}
                        disabled={uploading}
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        清空
                      </button>
                    </div>
                    {uploadedFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                      >
                        <div className="flex items-center space-x-3">
                          <File size={20} className="text-gray-400" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{file.name}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                          </div>
                        </div>
                        {file.status === 'pending' && (
                          <button
                            onClick={() => removeFile(file.id)}
                            className="p-1 text-gray-400 hover:text-red-600"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedProject(null);
                  setProjectName('');
                  setProjectDescription('');
                  setUploadedFiles([]);
                }}
                disabled={uploading}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={updateProject}
                disabled={uploading || !projectName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? '保存中...' : '保存更改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 文件管理对话框 */}
      {showFilesModal && selectedProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">文件管理</h3>
              <button
                onClick={() => {
                  setShowFilesModal(false);
                  setSelectedProject(null);
                  setUploadedFiles([]);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 上传新文件区域 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  上传新文件
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-md p-4">
                  <div className="text-center">
                    <Upload className="mx-auto h-10 w-10 text-gray-400" />
                    <div className="mt-2">
                      <label
                        htmlFor="files-modal-upload"
                        className="cursor-pointer rounded-md font-medium text-blue-600 hover:text-blue-500"
                      >
                        <span>点击选择文件</span>
                        <input
                          id="files-modal-upload"
                          type="file"
                          multiple
                          ref={filesModalInputRef}
                          onChange={handleFilesModalFileSelect}
                          accept=".zip,.jar,.war,.ear,.tar,.gz,.rar,.7z,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.yaml,.yml"
                          className="sr-only"
                        />
                      </label>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      支持多种格式，单个文件最大 5GB
                    </p>
                  </div>
                </div>

                {/* 待上传文件列表 */}
                {uploadedFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-700">
                        待上传 {uploadedFiles.length} 个文件
                      </p>
                      <button
                        onClick={() => setUploadedFiles([])}
                        disabled={uploadingFiles}
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        清空
                      </button>
                    </div>
                    {uploadedFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                      >
                        <div className="flex items-center space-x-3">
                          <File size={20} className="text-gray-400" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{file.name}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {file.status === 'uploading' && (
                            <div className="flex items-center space-x-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                              <span className="text-xs text-gray-500">上传中...</span>
                            </div>
                          )}
                          {file.status === 'success' && (
                            <CheckCircle size={20} className="text-green-500" />
                          )}
                          {file.status === 'error' && (
                            <AlertCircle size={20} className="text-red-500" />
                          )}
                          {file.status === 'pending' && (
                            <button
                              onClick={() => removeFile(file.id)}
                              className="p-1 text-gray-400 hover:text-red-600"
                              title="移除"
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={uploadAdditionalFiles}
                      disabled={uploadingFiles || uploadedFiles.length === 0}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {uploadingFiles ? '上传中...' : `上传 ${uploadedFiles.length} 个文件`}
                    </button>
                  </div>
                )}
              </div>

              {/* 已上传文件列表 */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">已上传文件</h4>
                {selectedProject.files && selectedProject.files.length > 0 ? (
                  <div className="space-y-2">
                    {selectedProject.files.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                      >
                        <div className="flex items-center space-x-3">
                          <File size={20} className="text-gray-400" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{file.fileName}</p>
                            <p className="text-xs text-gray-500">
                              {formatFileSize(file.fileSize)} • {new Date(file.uploadedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => downloadFile(selectedProject.id, file.id, file.fileName)}
                            className="p-1 text-blue-600 hover:text-blue-800"
                            title="下载"
                          >
                            <Download size={16} />
                          </button>
                          <button
                            onClick={() => deleteFile(selectedProject.id, file.id)}
                            className="p-1 text-red-600 hover:text-red-800"
                            title="删除"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 bg-gray-50 rounded-md">
                    <File className="mx-auto h-10 w-10 text-gray-400" />
                    <p className="mt-2 text-sm text-gray-600">暂无文件</p>
                    <p className="text-xs text-gray-500">上传文件后将在此显示</p>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => {
                  setShowFilesModal(false);
                  setSelectedProject(null);
                  setUploadedFiles([]);
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 评估历史对话框 */}
      {showHistoryModal && selectedProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">评估历史</h3>
              <button
                onClick={() => {
                  setShowHistoryModal(false);
                  setSelectedProject(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              {selectedProject.evaluations && selectedProject.evaluations.length > 0 ? (
                <div className="space-y-4">
                  {selectedProject.evaluations.map((evaluation, index) => (
                    <div
                      key={evaluation.id}
                      className="border border-gray-200 rounded-md p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => {
                        router.push(`/dashboard/sessions/${selectedProject.id}?evaluationId=${evaluation.id}`);
                        setShowHistoryModal(false);
                        setSelectedProject(null);
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-900">
                          评估 #{index + 1}
                        </h4>
                        <div className="flex items-center space-x-2">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              evaluation.status === 'running'
                                ? 'bg-blue-100 text-blue-800'
                                : evaluation.status === 'completed'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {evaluation.status === 'running'
                              ? '运行中'
                              : evaluation.status === 'completed'
                              ? '已完成'
                              : '失败'}
                          </span>
                          {evaluation.status !== 'running' && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm('确定要删除此评估吗？')) return;
                                try {
                                  const token = localStorage.getItem('token');
                                  const res = await fetch(`/api/evaluations/${evaluation.id}`, {
                                    method: 'DELETE',
                                    headers: { Authorization: `Bearer ${token}` },
                                  });
                                  if (res.ok) {
                                    await fetchProjects();
                                    // 重新获取项目详情以更新评估列表
                                    const detailResponse = await fetch(`/api/projects/${selectedProject.id}`, {
                                      headers: { Authorization: `Bearer ${token}` },
                                    });
                                    if (detailResponse.ok) {
                                      const detailData = await detailResponse.json();
                                      setSelectedProject(detailData.project);
                                    }
                                  } else {
                                    const data = await res.json();
                                    alert(data.error || '删除失败');
                                  }
                                } catch (err) {
                                  alert('删除失败');
                                }
                              }}
                              className="p-1 text-red-600 hover:text-red-800"
                              title="删除评估"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                          <span className="text-xs text-blue-600 hover:text-blue-800">查看详情 →</span>
                        </div>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p>开始时间: {new Date(evaluation.startedAt).toLocaleString()}</p>
                        {evaluation.completedAt && (
                          <p>完成时间: {new Date(evaluation.completedAt).toLocaleString()}</p>
                        )}
                        {evaluation.opencodeSessionId && (
                          <p>会话ID: {evaluation.opencodeSessionId}</p>
                        )}
                        {evaluation.errorMessage && (
                          <p className="text-red-600">错误: {evaluation.errorMessage}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <History className="mx-auto h-12 w-12 text-gray-400" />
                  <p className="mt-4 text-sm text-gray-600">暂无评估记录</p>
                  <p className="mt-2 text-xs text-gray-500">点击"启动评估"开始第一次评估</p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => {
                  setShowHistoryModal(false);
                  setSelectedProject(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 环境配置对话框 */}
      {showEnvConfigModal && selectedProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">环境配置</h3>
              <button
                onClick={() => {
                  setShowEnvConfigModal(false);
                  setSelectedProject(null);
                  setEnvironmentUrl('');
                  setAdminUsername('');
                  setAdminPassword('');
                  setNormalUsername('');
                  setNormalPassword('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="environmentUrl" className="block text-sm font-medium text-gray-700">
                  环境 URL
                </label>
                <input
                  id="environmentUrl"
                  type="url"
                  value={environmentUrl}
                  onChange={(e) => setEnvironmentUrl(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="例如: http://localhost:8080"
                />
                <p className="mt-1 text-xs text-gray-500">请输入目标环境的访问地址</p>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <h4 className="text-sm font-medium text-gray-900 mb-3">管理员账号</h4>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="adminUsername" className="block text-sm font-medium text-gray-700">
                      用户名
                    </label>
                    <input
                      id="adminUsername"
                      type="text"
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="管理员用户名"
                    />
                  </div>
                  <div>
                    <label htmlFor="adminPassword" className="block text-sm font-medium text-gray-700">
                      密码
                    </label>
                    <input
                      id="adminPassword"
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="留空则不修改密码"
                    />
                    <p className="mt-1 text-xs text-gray-500">留空表示不修改现有密码</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <h4 className="text-sm font-medium text-gray-900 mb-3">普通用户账号</h4>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="normalUsername" className="block text-sm font-medium text-gray-700">
                      用户名
                    </label>
                    <input
                      id="normalUsername"
                      type="text"
                      value={normalUsername}
                      onChange={(e) => setNormalUsername(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="普通用户名"
                    />
                  </div>
                  <div>
                    <label htmlFor="normalPassword" className="block text-sm font-medium text-gray-700">
                      密码
                    </label>
                    <input
                      id="normalPassword"
                      type="password"
                      value={normalPassword}
                      onChange={(e) => setNormalPassword(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="留空则不修改密码"
                    />
                    <p className="mt-1 text-xs text-gray-500">留空表示不修改现有密码</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowEnvConfigModal(false);
                  setSelectedProject(null);
                  setEnvironmentUrl('');
                  setAdminUsername('');
                  setAdminPassword('');
                  setNormalUsername('');
                  setNormalPassword('');
                }}
                disabled={uploading}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={saveEnvConfig}
                disabled={uploading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? '保存中...' : '保存配置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
