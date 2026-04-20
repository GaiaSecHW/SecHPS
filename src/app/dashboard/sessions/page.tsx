'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Plus, MessageSquare, Share2, RotateCcw, Trash2, Upload, X, File, AlertCircle, AlertTriangle, CheckCircle, Play, Edit2, Download, History, Settings, Shield, Square, Zap, Bug, Loader2, Workflow, ChevronLeft, ChevronRight, Search, RefreshCw, Copy, XCircle, User } from 'lucide-react';
import { useTechStackOptionsWithIds } from '@/hooks/useTechStackOptions';

// 格式化漏洞描述 - 按语义分行
function formatDescription(text: string): string {
  if (!text) return '';
  
  // 如果已经有换行符，直接返回
  if (text.includes('\n')) return text;
  
  // 按句号、问号、感叹号分行（中文和英文）
  let formatted = text
    // 处理中文标点
    .replace(/([。！？])/g, '$1\n')
    // 处理英文标点后跟空格的情况
    .replace(/([.!?])\s+/g, '$1\n')
    // 处理分号
    .replace(/([；;])/g, '$1\n')
    // 清理多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
    
  return formatted;
}

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
  endReason?: 'completed' | 'stopped' | 'error' | null;
  endMessage?: string | null;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  projectPath?: string;
  techStack?: string;  // JSON 字符串
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
  // 运行状态
  hasRunningEvaluation?: boolean;
  // 漏洞数量
  vulnerabilityCount?: number;
  // 共享字段
  isPublic?: boolean;
  userId?: string;
  userName?: string;
  userUsername?: string;
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
  // 当前用户信息
  const [user, setUser] = useState<{ id?: string; roles?: string[] } | null>(null);
  // 技术栈选择状态
  const [projectTechStack, setProjectTechStack] = useState<string[]>([]);
  const [techStackSearch, setTechStackSearch] = useState('');
  const [showTechStackDropdown, setShowTechStackDropdown] = useState(false);
  const { options: techStackOptions, loading: loadingTechStack } = useTechStackOptionsWithIds();
  // 环境配置表单状态
  const [environmentUrl, setEnvironmentUrl] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [normalUsername, setNormalUsername] = useState('');
  const [normalPassword, setNormalPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const filesModalInputRef = useRef<HTMLInputElement>(null);
  
  // 工作流相关状态
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  
  // 模型选择相关状态
  const [showModelModal, setShowModelModal] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  
  // 角色模型配置相关状态
  const [showRoleModelModal, setShowRoleModelModal] = useState(false);
  const [workflowRoles, setWorkflowRoles] = useState<any[]>([]);
  const [roleModels, setRoleModels] = useState<{ roleId: string; modelId: string }[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  
  // 漏洞管理相关状态
  const [showVulnerabilityModal, setShowVulnerabilityModal] = useState(false);
  const [vulnerabilityProject, setVulnerabilityProject] = useState<Project | null>(null);
  const [vulnerabilities, setVulnerabilities] = useState<any[]>([]);
  const [loadingVulnerabilities, setLoadingVulnerabilities] = useState(false);
  const [selectedVulnerability, setSelectedVulnerability] = useState<any | null>(null);
  const [vulnPage, setVulnPage] = useState(1);
  const [vulnTotalCount, setVulnTotalCount] = useState(0);
  const vulnPageSize = 10;
  // 漏洞过滤状态
  const [vulnSearchTerm, setVulnSearchTerm] = useState('');
  const [vulnStatusFilter, setVulnStatusFilter] = useState('');

  // 检查是否有运行中的评估
  const hasRunningEvaluation = projects.some(p => 
    p.evaluations?.some((e: any) => e.status === 'running')
  );

  // 定义 fetchWorkflows 函数（在 useEffect 之前，避免引用错误）
  const fetchWorkflows = async () => {
    try {
      setLoadingWorkflows(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/workflows', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error('获取工作流列表失败');
        return;
      }

      const data = await response.json();
      // 只显示已发布的工作流，并映射 nodeCount
      const publishedWorkflows = (data.data || [])
        .filter((w: any) => w.status === 'published')
        .map((w: any) => ({
          ...w,
          nodeCount: w._count?.WorkflowNode || 0,
        }));
      setWorkflows(publishedWorkflows);
    } catch (err) {
      console.error('获取工作流失败:', err);
    } finally {
      setLoadingWorkflows(false);
    }
  };

  useEffect(() => {
    // 获取当前用户信息
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    fetchProjects();
    fetchWorkflows();
  }, []); // 只在组件挂载时执行一次

  // 单独的 effect 处理自动刷新
  useEffect(() => {
    if (!hasRunningEvaluation) {
      return; // 如果没有运行中的评估，不启动定时器
    }

    console.log('[Auto Refresh] Starting auto-refresh due to running evaluation');
    
    const interval = setInterval(() => {
      fetchProjects();
    }, 5000);
    
    return () => {
      console.log('[Auto Refresh] Clearing auto-refresh interval');
      clearInterval(interval);
    };
  }, [hasRunningEvaluation]); // 只在 hasRunningEvaluation 变化时重新运行

  // 获取模型列表（评估时使用：用户自己的模型 + 公开的模型）
  const fetchModels = async () => {
    try {
      setLoadingModels(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/models?forEvaluation=true&isActive=true', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error('获取模型列表失败');
        return;
      }

      const data = await response.json();
      setModels(data.models || []);
    } catch (err) {
      console.error('获取模型列表错误:', err);
    } finally {
      setLoadingModels(false);
    }
  };

  // 获取工作流角色列表
  const fetchWorkflowRoles = async (workflowId: string) => {
    try {
      setLoadingRoles(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/workflows/${workflowId}/roles`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        console.error('获取工作流角色失败');
        return;
      }

      const data = await response.json();
      let roles = data.roles || [];
      
      // 过滤掉没有节点的角色（不需要为空角色配置模型）
      roles = roles.filter((r: any) => r.nodes && r.nodes.length > 0);
      
      // 检查是否有未分配角色的节点
      // 如果有，添加"默认角色"
      const workflowResponse = await fetch(`/api/workflows/${workflowId}/data`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (workflowResponse.ok) {
        const workflowData = await workflowResponse.json();
        const nodes = workflowData.nodes || [];
        const nodesWithoutRole = nodes.filter((n: any) => !n.roleId && n.type !== 'subtask');
        
        if (nodesWithoutRole.length > 0) {
          // 添加默认角色
          roles.push({
            id: 'default',
            name: '默认角色',
            description: '未分配角色的节点将使用此模型',
            color: '#gray',
            nodeCount: nodesWithoutRole.length,
            nodes: nodesWithoutRole,  // 添加节点信息
          });
        }
      }
      
      setWorkflowRoles(roles);
      
      // 初始化 roleModels 状态
      const initialRoleModels = roles.map((r: any) => ({
        roleId: r.id,
        modelId: '',
      }));
      setRoleModels(initialRoleModels);
    } catch (err) {
      console.error('获取工作流角色错误:', err);
    } finally {
      setLoadingRoles(false);
    }
  };

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects?include=evaluations', {
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
      
      console.log('[Projects] Loaded', data.projects?.length || 0, 'projects with evaluations');
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
        toast.error(`文件 ${file.name} 超过 5GB 限制，无法上传`);
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
        toast.error(`文件 ${file.name} 格式不支持，仅支持 ZIP、JAR 等格式`);
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

  // 处理拖拽上传
  const handleFileDrop = (files: File[]) => {
    const newFiles: UploadedFile[] = [];
    const maxSize = 5 * 1024 * 1024 * 1024; // 5GB

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // 检查文件大小
      if (file.size > maxSize) {
        toast.error(`文件 ${file.name} 超过 5GB 限制，无法上传`);
        continue;
      }

      // 检查文件格式
      const allowedTypes = [
        '.zip', '.jar', '.war', '.ear', '.tar', '.gz', '.rar', '.7z',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
        '.md', '.csv', '.json', '.xml', '.yaml', '.yml'
      ];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!allowedTypes.includes(ext)) {
        toast.error(`文件 ${file.name} 格式不支持，仅支持 ZIP、JAR 等格式`);
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
  };

  const handleAdditionalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: UploadedFile[] = [];
    const maxSize = 5 * 1024 * 1024 * 1024; // 5GB

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.size > maxSize) {
        toast.error(`文件 ${file.name} 超过 5GB 限制，无法上传`);
        continue;
      }

      const allowedTypes = [
        '.zip', '.jar', '.war', '.ear', '.tar', '.gz', '.rar', '.7z',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
        '.md', '.csv', '.json', '.xml', '.yaml', '.yml'
      ];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!allowedTypes.includes(ext)) {
        toast.error(`文件 ${file.name} 格式不支持`);
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
        toast.error(`文件 ${file.name} 超过 5GB 限制，无法上传`);
        continue;
      }

      const allowedTypes = [
        '.zip', '.jar', '.war', '.ear', '.tar', '.gz', '.rar', '.7z',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
        '.md', '.csv', '.json', '.xml', '.yaml', '.yml'
      ];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!allowedTypes.includes(ext)) {
        toast.error(`文件 ${file.name} 格式不支持`);
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
        toast.error(data.error || '上传文件失败');
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
      toast.error('网络错误，请重试');
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
      toast.error('请输入项目名称');
      return;
    }

    if (uploadedFiles.length === 0) {
      toast.error('请至少上传一个文件');
      return;
    }

    setUploading(true);

    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('name', projectName);
      formData.append('description', projectDescription);
      formData.append('techStack', JSON.stringify(projectTechStack));

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
        toast.error(data.error || '创建项目失败');
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
        setProjectTechStack([]);
        setTechStackSearch('');
      }, 1000);

      await fetchProjects();
    } catch (err) {
      toast.error('网络错误，请重试');
      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'error' as const, error: '网络错误' })));
    } finally {
      setUploading(false);
    }
  };

  const startProject = async (
    projectId: string,
    workflowId?: string | null,
    roleModelsOrModelId?: { roleId: string; modelId: string }[] | string | null
  ) => {
    setStartingProject(projectId);

    // 判断参数类型：roleModels array 或 modelId string
    const isRoleModels = Array.isArray(roleModelsOrModelId);
    const roleModelsParam = isRoleModels ? roleModelsOrModelId : null;
    const modelId = isRoleModels ? null : roleModelsOrModelId;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workflowId: workflowId || undefined,
          modelId: modelId || undefined,
          roleModels: roleModelsParam || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setStartingProject(null);
        
        // 显示详细的错误弹窗
        alert(`启动评估失败\n\n${data.error || '未知错误'}`);
        toast.error(data.error || '启动项目失败');
        return;
      }

      // 立即刷新项目列表以显示"评估运行中"状态
      await fetchProjects();

      // 处理 SSE 流式响应（后台监听，不阻塞UI）
      const reader = response.body?.getReader();
      if (!reader) {
        console.warn('[SSE] 响应体不可读，但评估已启动');
        setStartingProject(null);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      // 后台监听 SSE 流
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const event = JSON.parse(data);

                  if (event.type === 'message') {
                    // 实时显示评估内容
                    console.log('[评估]', event.content);
                  } else if (event.type === 'done') {
                    console.log('[评估完成]');
                    await fetchProjects();
                    setStartingProject(null);
                    return;
                  } else if (event.type === 'error') {
                    console.error('[评估失败]', event.error);
                    await fetchProjects();
                    setStartingProject(null);
                    return;
                  } else if (event.type === 'aborted') {
                    console.log('[评估已中止]', event.message);
                    toast.error(`评估已中止: ${event.message || '用户手动中止'}`);
                    await fetchProjects();
                    setStartingProject(null);
                    return;
                  }
                } catch {
                  // 忽略解析错误
                }
              }
            }
          }
        } catch (error) {
          console.error('[SSE] 流处理错误:', error);
        } finally {
          setStartingProject(null);
        }
      })();
    } catch (err) {
      toast.error('网络错误，请重试');
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
        toast.error(data.error || '删除项目失败');
        return;
      }

      await fetchProjects();
    } catch (err) {
      toast.error('网络错误，请重试');
    }
  };

  const openEditModal = (project: Project) => {
    setSelectedProject(project);
    setProjectName(project.name || '');
    setProjectDescription(project.description || '');
    // 加载项目的技术栈
    if (project.techStack) {
      try {
        setProjectTechStack(JSON.parse(project.techStack));
      } catch {
        setProjectTechStack([]);
      }
    } else {
      setProjectTechStack([]);
    }
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
      
      // 从 session.list() 获取评估历史
      const response = await fetch(`/api/projects/${project.id}/sessions`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '获取评估历史失败');
        return;
      }

      const data = await response.json();
      
      // 转换数据格式以匹配前端期望
      const evaluations = (data.sessions || []).map((session: any, index: number) => ({
        id: session.id,
        opencodeSessionId: session.id,
        status: session.status || 'completed',
        startedAt: session.createdAt || new Date().toISOString(),
        completedAt: session.updatedAt || new Date().toISOString(),
        title: session.title || `评估 #${index + 1}`,
      }));
      
      setSelectedProject({
        ...project,
        evaluations,
      });
      setShowHistoryModal(true);
    } catch (err) {
      console.error('获取评估历史失败:', err);
      toast.error('网络错误，请重试');
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
        toast.error(data.error || '保存环境配置失败');
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
      toast.error('网络错误，请重试');
    } finally {
      setUploading(false);
    }
  };

  const handleAIPenetration = (project: Project) => {
    // 检查是否配置了环境 URL
    if (!project.environmentUrl) {
      toast.error('请先配置环境 URL（点击设置按钮进行配置）');
      return;
    }
    // TODO: 调用 AI 渗透测试 API
    toast(`环境 AI 渗透功能开发中\n\n目标环境: ${project.environmentUrl}`, { icon: '🔧' });
  };

  const handleVulnerabilityManagement = async (project: Project, page: number = 1) => {
    setVulnerabilityProject(project);
    setShowVulnerabilityModal(true);
    setLoadingVulnerabilities(true);
    setVulnerabilities([]);
    setSelectedVulnerability(null);
    setVulnPage(page);
    
    try {
      const token = localStorage.getItem('token');
      // 构建查询参数
      const params = new URLSearchParams({
        projectId: project.id,
        page: String(page),
        limit: String(vulnPageSize),
      });
      if (vulnSearchTerm) params.append('search', vulnSearchTerm);
      if (vulnStatusFilter) params.append('status', vulnStatusFilter);
      
      const response = await fetch(`/api/vulnerabilities?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        // API 返回格式: { data: [...], pagination: {...} }
        setVulnerabilities(data.data || []);
        setVulnTotalCount(data.pagination?.total || 0);
      } else {
        console.error('获取漏洞列表失败');
      }
    } catch (err) {
      console.error('获取漏洞列表错误:', err);
    } finally {
      setLoadingVulnerabilities(false);
    }
  };

  const handleVulnerabilityStatusChange = async (vulnId: string, action: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/vulnerabilities/${vulnId}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '操作失败');
        return;
      }
      
      // 刷新漏洞列表
      if (vulnerabilityProject) {
        handleVulnerabilityManagement(vulnerabilityProject);
      }
      setSelectedVulnerability(null);
    } catch (err) {
      toast.error('操作失败，请重试');
    }
  };

  // 复制漏洞详情为 Markdown 格式
  const handleCopyVulnerabilityAsMarkdown = (vuln: any) => {
    const statusLabels: Record<string, string> = {
      'new': '新建',
      'confirmed': '已确认',
      'false-positive': '误报',
      'fixed': '已修复',
      'verified': '已验证',
    };

    const markdown = `# 漏洞报告：${vuln.title}

## 基本信息

| 字段 | 内容 |
|------|------|
| 漏洞类型 | ${vuln.type || '未知'} |
| CWE 编号 | ${vuln.cwe || '无'} |
| 状态 | ${statusLabels[vuln.status] || vuln.status} |
| 发现工具 | ${vuln.skill || '未知'} |
| 发现时间 | ${new Date(vuln.createdAt).toLocaleString('zh-CN')} |
| 所属项目 | ${vulnerabilityProject?.name || '无'} |

## 漏洞描述

${vuln.description || '无描述'}

## 问题代码位置

${vuln.filePath || '无'}

## POC / 代码片段

${vuln.codeSnippet ? '```\n' + vuln.codeSnippet + '\n```' : '无'}

---
*报告生成时间：${new Date().toLocaleString('zh-CN')}*
`;

    navigator.clipboard.writeText(markdown).then(() => {
      toast.success('已复制为 Markdown 格式');
    }).catch(() => {
      toast.error('复制失败');
    });
  };

  const downloadFile = async (projectId: string, fileId: string, fileName: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}/files/${fileId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data.error || '下载文件失败');
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
      toast.error('下载文件失败，请重试');
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
        toast.error(data.error || '删除文件失败');
        return;
      }

      toast.success('文件已删除');
      
      // 刷新项目列表
      await fetchProjects();
      
      // 直接从 API 获取更新后的项目详情
      if (selectedProject) {
        const detailResponse = await fetch(`/api/projects/${projectId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (detailResponse.ok) {
          const detailData = await detailResponse.json();
          setSelectedProject(detailData.project);
        }
      }
    } catch (err) {
      toast.error('网络错误，请重试');
    }
  };

  const updateProject = async () => {
    if (!selectedProject || !projectName.trim()) {
toast.error('请输入项目名称');
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
          name: projectName,
          description: projectDescription,
          techStack: projectTechStack.length > 0 ? JSON.stringify(projectTechStack) : null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
toast.error(data.error || '更新项目失败');
        setUploading(false);
        return;
      }

      setShowEditModal(false);
      setSelectedProject(null);
      setProjectName('');
      setProjectDescription('');
      setProjectTechStack([]);
      setUploadedFiles([]);

      await fetchProjects();
    } catch (err) {
      toast.error('网络错误，请重试');
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
          <h1 className="text-2xl font-bold text-gray-900">我的项目</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理您的 AI 编程评估项目
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
        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(365px, 1fr))' }}>
          {projects.map((project) => (
            <div
              key={project.id}
              className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
            >
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {project.name || '未命名项目'}
                    </h3>
                    {/* 共享状态标签 */}
                    {project.isPublic && (
                      <span className="inline-flex items-center px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                        <Share2 size={12} className="mr-1" />
                        公开
                      </span>
                    )}
                    {/* 所有者标签（显示别人的项目时） */}
                    {project.userName && project.userId !== user?.id && (
                      <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                        <User size={12} className="mr-1" />
                        {project.userName || project.userUsername}
                      </span>
                    )}
                  </div>
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

                {/* 技术栈显示 */}
                {project.techStack && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(() => {
                      try {
                        const techStackArr = JSON.parse(project.techStack);
                        return techStackArr.map((ts: string) => (
                          <span
                            key={ts}
                            className="inline-flex items-center px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs"
                          >
                            {ts}
                          </span>
                        ));
                      } catch {
                        return null;
                      }
                    })()}
                  </div>
                )}

                <p className="mt-2 text-sm text-gray-600">
                  创建于 {new Date(project.createdAt).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                  })}
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

              {/* 最新评估会话信息 - 运行中时显示运行状态，否则显示最新评估状态 */}
              {(() => {
                const allEvals = project.evaluations || [];
                const runningEval = allEvals.find((e: any) => e.status === 'running' || e.status === 'queued');
                const latestEval = runningEval || allEvals
                  .sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
                
                if (!latestEval) return null;
                
                const isRunning = latestEval.status === 'running' || latestEval.status === 'queued';
                const evalTime = latestEval.startedAt ? new Date(latestEval.startedAt) : null;
                const timeStr = evalTime ? evalTime.toLocaleString('zh-CN', { 
                  month: '2-digit', 
                  day: '2-digit', 
                  hour: '2-digit', 
                  minute: '2-digit',
                  second: '2-digit'
                }) : '';
                
                const statusConfig: Record<string, { bg: string; border: string; text: string; label: string }> = {
                  running: { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-700', label: '运行中' },
                  queued: { bg: 'bg-yellow-50', border: 'border-yellow-100', text: 'text-yellow-700', label: '排队中' },
                  completed: { bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-700', label: '已完成' },
                  failed: { bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-700', label: '异常' },
                  cancelled: { bg: 'bg-gray-100', border: 'border-gray-200', text: 'text-gray-700', label: '已中止' },
                };
                const config = statusConfig[latestEval.status] || statusConfig.completed;
                
                return (
                  <div className={`${config.bg} px-6 py-2 border-t ${config.border}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center space-x-2">
                          {isRunning && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
                          <span className={`text-sm font-medium ${config.text}`}>
                            {config.label}
                          </span>
                        </div>
                        {timeStr && (
                          <span className={`text-xs opacity-75 ${config.text}`}>
                            启动: {timeStr}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/dashboard/sessions/${latestEval.id}?evaluationId=${latestEval.id}`}
                          className={`text-xs ${config.text} hover:opacity-80 flex items-center space-x-1`}
                        >
                          <MessageSquare size={12} />
                          <span>详情</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })()}

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
                    <button
                      onClick={() => handleVulnerabilityManagement(project)}
                      className="flex items-center space-x-1 px-3 py-1 text-sm font-medium text-red-600 hover:text-red-800"
                      title="漏洞管理"
                    >
                      <Bug size={16} />
                      <span>漏洞管理</span>
                      {project.vulnerabilityCount && project.vulnerabilityCount > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
                          {project.vulnerabilityCount}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
                {/* 第二行：启动评估、编辑、文件管理、删除 */}
                <div className="flex items-center justify-between">
                  <div className="flex space-x-2">
                    {/* 启动评估按钮 - 只有项目所有者和管理员可见 */}
                    {(user?.id === project.userId || user?.roles?.includes('admin')) && (
                      <button
                        onClick={() => {
                          setStartingProject(null);
                          setSelectedProject(project);
                          setSelectedWorkflow(null);
                          setShowWorkflowModal(true);
                        }}
                        disabled={project.hasRunningEvaluation || project.evaluations?.some((e: any) => e.status === 'running' || e.status === 'queued')}
                        className="flex items-center space-x-1 px-3 py-1 text-sm font-medium text-green-600 hover:text-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play size={16} />
                        <span>启动评估</span>
                      </button>
                    )}
                    {/* 编辑按钮 - 只有项目所有者和管理员可见 */}
                    {(user?.id === project.userId || user?.roles?.includes('admin')) && (
                      <button
                        onClick={() => openEditModal(project)}
                        className="flex items-center space-x-1 px-2 py-1 text-sm text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded"
                        title="编辑"
                      >
                        <Edit2 size={14} />
                        <span>编辑</span>
                      </button>
                    )}
                    <button
                      onClick={() => openFilesModal(project)}
                      className="flex items-center space-x-1 px-2 py-1 text-sm text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded"
                      title="文件管理"
                    >
                      <File size={14} />
                      <span>文件</span>
                    </button>
                    <button
                      onClick={() => openHistoryModal(project)}
                      className="flex items-center space-x-1 px-2 py-1 text-sm text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded"
                      title="评估历史"
                    >
                      <History size={14} />
                      <span>历史</span>
                    </button>
                    {/* 删除按钮 - 只有项目所有者和管理员可见 */}
                    {(user?.id === project.userId || user?.roles?.includes('admin')) && (
                      <button
                        onClick={() => deleteProject(project.id)}
                        className="flex items-center space-x-1 px-2 py-1 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                        title="删除"
                      >
                        <Trash2 size={14} />
                        <span>删除</span>
                      </button>
                    )}
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
                  setProjectTechStack([]);
                  setTechStackSearch('');
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

              {/* 技术栈选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  技术栈
                </label>
                <div className="relative">
                  {/* 已选择的技术栈标签 */}
                  <div className="flex flex-wrap gap-2 mb-2">
                    {projectTechStack.map((tsId) => {
                      const opt = techStackOptions.find(o => o.id === tsId);
                      return (
                      <span
                        key={tsId}
                        className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                      >
                        {opt?.name || tsId}
                        <button
                          type="button"
                          onClick={() => setProjectTechStack(projectTechStack.filter((t) => t !== tsId))}
                          className="ml-2 text-blue-600 hover:text-blue-800"
                        >
                          <X size={14} />
                        </button>
                      </span>
                      );
                    })}
                  </div>
                  {/* 技术栈搜索和选择 */}
                  <div className="relative">
                    <input
                      type="text"
                      value={techStackSearch}
                      onChange={(e) => {
                        setTechStackSearch(e.target.value);
                        setShowTechStackDropdown(true);
                      }}
                      onFocus={() => setShowTechStackDropdown(true)}
                      placeholder={loadingTechStack ? "加载中..." : "搜索并选择技术栈..."}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      disabled={loadingTechStack}
                    />
                    {/* 下拉选项 */}
                    {showTechStackDropdown && !loadingTechStack && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {techStackOptions
                          .filter((option) =>
                            option.name.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                            !projectTechStack.includes(option.id)
                          )

                          .map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setProjectTechStack([...projectTechStack, option.id]);
                                setTechStackSearch('');
                                setShowTechStackDropdown(false);
                              }}
                              className="w-full px-4 py-2 text-left hover:bg-gray-100 text-sm"
                            >
                              {option.name}
                            </button>
                          ))}
                        {techStackOptions.filter((option) =>
                          option.name.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                          !projectTechStack.includes(option.id)
                        ).length === 0 && (
                          <div className="px-4 py-2 text-sm text-gray-500">
                            无匹配选项
                          </div>
                        )}
                      </div>
                    )}
                    {loadingTechStack && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg p-4">
                        <div className="flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          <span className="text-sm text-gray-500">加载技术栈选项...</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    可选择多个技术栈，帮助匹配适合的审计工具
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  上传文件
                </label>
                <div 
                  className="border-2 border-dashed border-gray-300 rounded-md p-6 hover:border-blue-400 transition-colors"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.add('border-blue-400', 'bg-blue-50');
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50');
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50');
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length > 0) {
                      handleFileDrop(files);
                    }
                  }}
                >
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
                  setProjectTechStack([]);
                  setTechStackSearch('');
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

              {/* 技术栈选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  技术栈
                </label>
                <div className="relative">
                  {/* 已选择的技术栈标签 */}
                  <div className="flex flex-wrap gap-2 mb-2">
                    {projectTechStack.map((tsId) => {
                      const opt = techStackOptions.find(o => o.id === tsId);
                      return (
                      <span
                        key={tsId}
                        className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                      >
                        {opt?.name || tsId}
                        <button
                          type="button"
                          onClick={() => setProjectTechStack(projectTechStack.filter((t) => t !== tsId))}
                          className="ml-2 text-blue-600 hover:text-blue-800"
                        >
                          <X size={14} />
                        </button>
                      </span>
                      );
                    })}
                  </div>
                  {/* 技术栈搜索和选择 */}
                  <div className="relative">
                    <input
                      type="text"
                      value={techStackSearch}
                      onChange={(e) => {
                        setTechStackSearch(e.target.value);
                        setShowTechStackDropdown(true);
                      }}
                      onFocus={() => setShowTechStackDropdown(true)}
                      placeholder={loadingTechStack ? "加载中..." : "搜索并选择技术栈..."}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      disabled={loadingTechStack}
                    />
                    {/* 下拉选项 */}
                    {showTechStackDropdown && !loadingTechStack && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {techStackOptions
                          .filter((option) =>
                            option.name.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                            !projectTechStack.includes(option.id)
                          )

                          .map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setProjectTechStack([...projectTechStack, option.id]);
                                setTechStackSearch('');
                                setShowTechStackDropdown(false);
                              }}
                              className="w-full px-4 py-2 text-left hover:bg-gray-100 text-sm"
                            >
                              {option.name}
                            </button>
                          ))}
                        {techStackOptions.filter((option) =>
                          option.name.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                          !projectTechStack.includes(option.id)
                        ).length === 0 && (
                          <div className="px-4 py-2 text-sm text-gray-500">
                            无匹配选项
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    可选择多个技术栈，帮助匹配适合的审计工具
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedProject(null);
                  setProjectName('');
                  setProjectDescription('');
                  setProjectTechStack([]);
                  setTechStackSearch('');
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
                      {uploadingFiles ? '上传中...' : `确认上传这 ${uploadedFiles.length} 个文件`}
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
                                 : evaluation.status === 'cancelled'
                                 ? 'bg-yellow-100 text-yellow-800'
                                 : 'bg-red-100 text-red-800'
                             }`}
                           >
                             {evaluation.status === 'running'
                               ? '运行中'
                               : evaluation.status === 'completed'
                               ? '已完成'
                               : evaluation.status === 'cancelled'
                               ? '已停止'
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
                                      toast.error(data.error || '删除失败');
                                    }
                                  } catch (err) {
                                    toast.error('删除失败');
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
                         {/* 显示结束原因 */}
                         {evaluation.status !== 'running' && evaluation.endReason && (
                           <div className={`mt-2 p-2 rounded ${
                             evaluation.endReason === 'completed' 
                               ? 'bg-green-50 border border-green-200' 
                               : evaluation.endReason === 'stopped'
                               ? 'bg-yellow-50 border border-yellow-200'
                               : 'bg-red-50 border border-red-200'
                           }`}>
                             <p className={`font-medium ${
                               evaluation.endReason === 'completed' 
                                 ? 'text-green-700' 
                                 : evaluation.endReason === 'stopped'
                                 ? 'text-yellow-700'
                                 : 'text-red-700'
                             }`}>
                               {evaluation.endReason === 'completed' && '✅ 正常结束'}
                               {evaluation.endReason === 'stopped' && '⏹️ 手工停止'}
                               {evaluation.endReason === 'error' && '❌ 异常结束'}
                             </p>
                             {evaluation.endMessage && (
                               <p className={`text-xs mt-1 ${
                                 evaluation.endReason === 'completed' 
                                   ? 'text-green-600' 
                                   : evaluation.endReason === 'stopped'
                                   ? 'text-yellow-600'
                                   : 'text-red-600'
                               }`}>
                                 {evaluation.endMessage}
                               </p>
                             )}
                           </div>
                         )}
                         {evaluation.opencodeSessionId && (
                           <p>会话ID: {evaluation.opencodeSessionId}</p>
                         )}
                         {evaluation.errorMessage && !evaluation.endReason && (
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

      {/* 图片预览模态框 */}
      {showImagePreview && previewImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-75"
          onClick={() => {
            setShowImagePreview(false);
            setPreviewImage(null);
          }}
        >
          <div className="relative max-w-6xl max-h-full p-4">
            <button
              onClick={() => {
                setShowImagePreview(false);
                setPreviewImage(null);
              }}
              className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-lg hover:bg-gray-100 z-10"
            >
              <X size={24} className="text-gray-600" />
            </button>
            <img
              src={previewImage.src}
              alt={previewImage.alt}
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-50 text-white px-4 py-2 rounded-lg">
              {previewImage.alt}
            </div>
          </div>
        </div>
      )}

      {/* Workflow 选择对话框 */}
      {showWorkflowModal && selectedProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">选择评估工作流</h3>
                <p className="text-sm text-gray-500 mt-1">项目: {selectedProject.name}</p>
              </div>
              <button
                onClick={() => {
                  setShowWorkflowModal(false);
                  setSelectedProject(null);
                  setSelectedWorkflow(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              {loadingWorkflows ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  <span className="ml-2 text-gray-500">加载工作流列表中...</span>
                </div>
              ) : workflows.length === 0 ? (
                <div className="text-center py-12">
                  <Workflow className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-4 text-lg font-medium text-gray-900">
                    暂无可用工作流
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    请先在工作流管理中创建并发布工作流
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 mb-4">
                    选择一个已发布的工作流来执行评估。工作流定义了评估的步骤和使用的 Agent。
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {workflows.map((workflow) => (
                      <div
                        key={workflow.id}
                        onClick={() => setSelectedWorkflow(workflow.id)}
                        className={`border-2 rounded-lg p-4 cursor-pointer transition-all relative group ${
                          selectedWorkflow === workflow.id
                            ? 'border-blue-600 bg-blue-50 shadow-lg ring-2 ring-blue-200'
                            : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50 hover:shadow'
                        }`}
                      >
                        {/* 选中标记 - 更明显 */}
                        <div className={`absolute top-3 right-3 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          selectedWorkflow === workflow.id
                            ? 'border-blue-600 bg-blue-600'
                            : 'border-gray-300 group-hover:border-blue-400'
                        }`}>
                          {selectedWorkflow === workflow.id && (
                            <CheckCircle className="h-4 w-4 text-white" />
                          )}
                        </div>
                        
                        {/* 点击提示 - 未选中时显示 */}
                        {selectedWorkflow !== workflow.id && (
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            <span className="bg-blue-600 text-white text-xs px-3 py-1 rounded-full shadow">
                              点击选择
                            </span>
                          </div>
                        )}
                        
                        <div className="flex items-start justify-between pr-8">
                          <div className="flex-1">
                            <h4 className={`text-sm font-semibold ${
                              selectedWorkflow === workflow.id ? 'text-blue-700' : 'text-gray-900'
                            }`}>
                              {workflow.name}
                            </h4>
                            {workflow.description && (
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                {workflow.description}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                          <span>节点数: {workflow.nodeCount || 0}</span>
                          <span>
                            更新于 {new Date(workflow.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
{/* 缩略图预览 */}
                         {workflow.thumbnail && (
                           <div className="mt-3">
                             <img
                               src={`data:image/png;base64,${workflow.thumbnail}`}
                               alt={`${workflow.name} 缩略图`}
                               className="w-full h-24 object-cover rounded border border-gray-200"
                               onClick={(e) => {
                                 e.stopPropagation();
                                 setPreviewImage({ src: `data:image/png;base64,${workflow.thumbnail}`, alt: workflow.name });
                                 setShowImagePreview(true);
                               }}
                             />
                           </div>
                         )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
              <button
                onClick={() => {
                  setShowWorkflowModal(false);
                  setSelectedProject(null);
                  setSelectedWorkflow(null);
                }}
                disabled={!!startingProject}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <div className="flex items-center space-x-3">
                <button
                  onClick={async () => {
                    if (!selectedProject || !selectedWorkflow) return;
                    setShowWorkflowModal(false);
                    await fetchWorkflowRoles(selectedWorkflow);
                    await fetchModels();
                    setShowRoleModelModal(true);
                  }}
                  disabled={!selectedWorkflow || !!startingProject}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一步
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 角色模型配置对话框 */}
      {showRoleModelModal && selectedProject && selectedWorkflow && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">为角色配置模型</h3>
                <p className="text-sm text-gray-500 mt-1">
                  项目: {selectedProject.name} | 编排: {workflows.find(w => w.id === selectedWorkflow)?.name}
                </p>
              </div>
              <button onClick={() => {
                setShowRoleModelModal(false);
                setSelectedProject(null);
                setSelectedWorkflow(null);
                setWorkflowRoles([]);
                setRoleModels([]);
              }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              {loadingRoles ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  <span className="ml-2 text-gray-500">加载角色列表...</span>
                </div>
              ) : workflowRoles.length === 0 ? (
                <div className="text-center py-12">
                  <Workflow className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-4 text-lg font-medium text-gray-900">该编排无角色定义</h3>
                  <p className="mt-2 text-sm text-gray-600">请先在编排编辑器中定义角色</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 快速设置：全部使用同一模型 */}
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <label className="block text-sm font-medium text-blue-800 mb-2">
                      快速设置：为所有角色使用同一模型
                    </label>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          const newRoleModels = workflowRoles.map((r: any) => ({
                            roleId: r.id,
                            modelId: e.target.value,
                          }));
                          setRoleModels(newRoleModels);
                        }
                      }}
                      className="block w-full px-3 py-2 border border-blue-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      <option value="">选择模型应用到所有角色</option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} ({model.providerType})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 为每个角色配置模型 */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-700">角色模型配置</h4>
                    {workflowRoles.map((role: any) => (
                      <div key={role.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                        {/* 角色信息 */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {role.color && (
                              <div className={`w-4 h-4 rounded-full`} style={{ backgroundColor: role.color }} />
                            )}
                            <span className="font-medium text-gray-900">{role.name}</span>
                            {role.id === 'default' && (
                              <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">自动添加</span>
                            )}
                          </div>
                          {role.description && (
                            <p className="text-sm text-gray-500 mt-1">{role.description}</p>
                          )}
                          {role.nodes && (
                            <p className="text-xs text-gray-400 mt-1">节点数: {role.nodes.length}</p>
                          )}
                          {role.nodeCount && (
                            <p className="text-xs text-gray-400 mt-1">节点数: {role.nodeCount}</p>
                          )}
                        </div>
                        
                        {/* 模型选择 */}
                        <div className="w-64">
                          <select
                            value={roleModels.find(rm => rm.roleId === role.id)?.modelId || ''}
                            onChange={(e) => {
                              const newRoleModels = [...roleModels];
                              const index = newRoleModels.findIndex(rm => rm.roleId === role.id);
                              if (index >= 0) {
                                newRoleModels[index].modelId = e.target.value;
                              }
                              setRoleModels(newRoleModels);
                            }}
                            className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">选择模型</option>
                            {models.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.name} ({model.providerType})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
              <button
                onClick={() => {
                  setShowRoleModelModal(false);
                  setShowWorkflowModal(true);
                }}
                disabled={!!startingProject}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                上一步
              </button>
              <div className="flex items-center space-x-3">
                <button
                  onClick={async () => {
                    if (!selectedProject || !selectedWorkflow) return;
                    
                    // 验证所有角色都有模型
                    const allConfigured = roleModels.every(rm => rm.modelId);
                    if (!allConfigured) {
                      toast.error('请为所有角色配置模型');
                      return;
                    }
                    
                    // 关闭对话框
                    setShowRoleModelModal(false);
                    setSelectedProject(null);
                    setSelectedWorkflow(null);
                    setWorkflowRoles([]);
                    setRoleModels([]);
                    
                    // 启动评估，传递 roleModels
                    await startProject(selectedProject.id, selectedWorkflow, roleModels);
                  }}
                  disabled={!roleModels.every(rm => rm.modelId) || !!startingProject}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {startingProject ? '启动中...' : '启动评估'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 漏洞管理弹窗 */}
      {showVulnerabilityModal && vulnerabilityProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">漏洞管理</h3>
                <p className="text-sm text-gray-500 mt-1">{vulnerabilityProject.name}</p>
              </div>
              <button
                onClick={() => {
                  setShowVulnerabilityModal(false);
                  setVulnerabilityProject(null);
                  setVulnerabilities([]);
                  setSelectedVulnerability(null);
                  setVulnSearchTerm('');
                  setVulnStatusFilter('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            {/* 搜索和过滤 */}
            <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="搜索漏洞标题、类型..."
                  value={vulnSearchTerm}
                  onChange={(e) => {
                    setVulnSearchTerm(e.target.value);
                    setVulnPage(1);
                  }}
                  className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <select
                value={vulnStatusFilter}
                onChange={(e) => {
                  setVulnStatusFilter(e.target.value);
                  setVulnPage(1);
                }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部状态</option>
                <option value="new">新建</option>
                <option value="confirmed">已确认</option>
                <option value="fixed">已修复</option>
                <option value="verified">已验证</option>
                <option value="false-positive">误报</option>
              </select>
              <button
                onClick={() => vulnerabilityProject && handleVulnerabilityManagement(vulnerabilityProject, 1)}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-1"
              >
                <RefreshCw size={14} />
                查询
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingVulnerabilities ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  <span className="ml-2 text-gray-500">加载漏洞数据...</span>
                </div>
              ) : vulnerabilities.length === 0 ? (
                <div className="text-center py-12">
                  <Bug className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-4 text-lg font-medium text-gray-900">暂无漏洞</h3>
                  <p className="mt-2 text-sm text-gray-600">
                    该项目尚未发现漏洞，运行评估后会显示检测结果
                  </p>
                </div>
              ) : (
                <div className="flex h-full">
                  {/* 左侧：漏洞列表 */}
                  <div className={`border-r border-gray-200 ${selectedVulnerability ? 'w-1/2' : 'w-full'}`}>
                    <div className="p-4 border-b border-gray-100 bg-gray-50">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          共 {vulnTotalCount} 个漏洞
                        </span>
                        <div className="flex gap-2">
                          {['critical', 'high', 'medium', 'low'].map(severity => {
                            const count = vulnerabilities.filter(v => v.severity === severity).length;
                            if (count === 0) return null;
                            const colors: Record<string, string> = {
                              critical: 'bg-red-100 text-red-700',
                              high: 'bg-orange-100 text-orange-700',
                              medium: 'bg-yellow-100 text-yellow-700',
                              low: 'bg-blue-100 text-blue-700',
                            };
                            const labels: Record<string, string> = {
                              critical: '严重',
                              high: '高危',
                              medium: '中危',
                              low: '低危',
                            };
                            return (
                              <span key={severity} className={`px-2 py-0.5 text-xs rounded ${colors[severity]}`}>
                                {labels[severity]}: {count}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {vulnerabilities.map((vuln) => (
                        <div
                          key={vuln.id}
                          onClick={() => setSelectedVulnerability(vuln)}
                          className={`px-4 py-3 cursor-pointer transition-colors ${
                            selectedVulnerability?.id === vuln.id
                              ? 'bg-blue-50 border-l-4 border-blue-500'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 text-xs font-medium rounded flex-shrink-0 ${
                              vuln.status === 'new' ? 'bg-blue-100 text-blue-700' :
                              vuln.status === 'confirmed' ? 'bg-yellow-100 text-yellow-700' :
                              vuln.status === 'fixed' ? 'bg-green-100 text-green-700' :
                              vuln.status === 'verified' ? 'bg-purple-100 text-purple-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {vuln.status === 'new' ? '新建' :
                               vuln.status === 'confirmed' ? '已确认' :
                               vuln.status === 'fixed' ? '已修复' :
                               vuln.status === 'verified' ? '已验证' :
                               vuln.status === 'false-positive' ? '误报' : vuln.status}
                            </span>
                            <span className="text-xs text-gray-500 flex-shrink-0">{vuln.type}</span>
                            <h4 className="text-sm font-medium text-gray-900 truncate flex-1 min-w-0" title={vuln.title}>{vuln.title}</h4>
                            {vuln.createdAt && (
                              <span className="text-xs text-gray-400 flex-shrink-0">
                                {new Date(vuln.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* 分页 */}
                    {vulnTotalCount > vulnPageSize && (
                      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100">
                        <span className="text-xs text-gray-500">
                          共 {vulnTotalCount} 条，第 {vulnPage}/{Math.ceil(vulnTotalCount / vulnPageSize)} 页
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => vulnerabilityProject && handleVulnerabilityManagement(vulnerabilityProject, vulnPage - 1)}
                            disabled={vulnPage === 1}
                            className="p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span className="text-xs text-gray-600 px-2">{vulnPage}</span>
                          <button
                            onClick={() => vulnerabilityProject && handleVulnerabilityManagement(vulnerabilityProject, vulnPage + 1)}
                            disabled={vulnPage >= Math.ceil(vulnTotalCount / vulnPageSize)}
                            className="p-1 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 漏洞全屏详情 */}
      {selectedVulnerability && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white shrink-0">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setSelectedVulnerability(null)}
                className="flex items-center text-gray-500 hover:text-gray-800 transition-colors"
              >
                <X size={18} className="mr-1" />
                返回
              </button>
              <span className="text-gray-300">|</span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                selectedVulnerability.status === 'new' ? 'bg-blue-100 text-blue-700' :
                selectedVulnerability.status === 'confirmed' ? 'bg-yellow-100 text-yellow-700' :
                selectedVulnerability.status === 'fixed' ? 'bg-green-100 text-green-700' :
                selectedVulnerability.status === 'verified' ? 'bg-purple-100 text-purple-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {selectedVulnerability.status === 'new' ? '新建' :
                 selectedVulnerability.status === 'confirmed' ? '已确认' :
                 selectedVulnerability.status === 'fixed' ? '已修复' :
                 selectedVulnerability.status === 'verified' ? '已验证' :
                 selectedVulnerability.status === 'false-positive' ? '误报' : selectedVulnerability.status}
              </span>
              <h2 className="text-lg font-bold text-gray-900">{selectedVulnerability.title}</h2>
            </div>
            <div className="flex items-center gap-2">
              {selectedVulnerability.status === 'new' && (
                <>
                  <button onClick={() => handleCopyVulnerabilityAsMarkdown(selectedVulnerability)} className="inline-flex items-center px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 text-sm">
                    <Copy size={14} className="mr-1" />复制MD
                  </button>
                  <button onClick={() => handleVulnerabilityStatusChange(selectedVulnerability.id, 'confirm')} className="px-3 py-1.5 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 text-sm">确认漏洞</button>
                  <button onClick={() => handleVulnerabilityStatusChange(selectedVulnerability.id, 'false-positive')} className="px-3 py-1.5 bg-gray-100 text-gray-800 rounded hover:bg-gray-200 text-sm">标记误报</button>
                </>
              )}
              {selectedVulnerability.status === 'confirmed' && (
                <>
                  <button onClick={() => handleCopyVulnerabilityAsMarkdown(selectedVulnerability)} className="inline-flex items-center px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 text-sm">
                    <Copy size={14} className="mr-1" />复制MD
                  </button>
                  <button onClick={() => handleVulnerabilityStatusChange(selectedVulnerability.id, 'fix')} className="px-3 py-1.5 bg-green-100 text-green-800 rounded hover:bg-green-200 text-sm">标记已修复</button>
                </>
              )}
              {selectedVulnerability.status === 'fixed' && (
                <>
                  <button onClick={() => handleCopyVulnerabilityAsMarkdown(selectedVulnerability)} className="inline-flex items-center px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 text-sm">
                    <Copy size={14} className="mr-1" />复制MD
                  </button>
                  <button onClick={() => handleVulnerabilityStatusChange(selectedVulnerability.id, 'verify')} className="px-3 py-1.5 bg-purple-100 text-purple-800 rounded hover:bg-purple-200 text-sm">验证修复</button>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto p-6 space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-2 gap-3">
                <div><span className="text-xs text-gray-500">漏洞类型</span><p className="text-sm font-medium text-gray-900">{selectedVulnerability.type}</p></div>
                <div><span className="text-xs text-gray-500">CWE 编号</span><p className="text-sm font-medium text-gray-900">{selectedVulnerability.cwe || '无'}</p></div>
                <div><span className="text-xs text-gray-500">发现工具</span><p className="text-sm font-medium text-gray-900">{selectedVulnerability.skill || '未知'}</p></div>
                <div><span className="text-xs text-gray-500">发现时间</span><p className="text-sm font-medium text-gray-900">{new Date(selectedVulnerability.createdAt).toLocaleString('zh-CN')}</p></div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">漏洞描述</h4>
                <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{formatDescription(selectedVulnerability.description)}</div>
              </div>
              {selectedVulnerability.filePath && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">问题代码</h4>
                  <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto max-h-96 whitespace-pre-wrap">{selectedVulnerability.filePath}</pre>
                </div>
              )}
              {selectedVulnerability.codeSnippet && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">POC</h4>
                  <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto max-h-96 whitespace-pre-wrap">{selectedVulnerability.codeSnippet}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
