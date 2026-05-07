'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, ClipboardList, Play, Trash2, Eye, Calendar, User, Shield, Bug, Sword, Network, Loader2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import TaskCreateModal from './TaskCreateModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

import { TaskInstance } from './types';

const iconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Shield,
  Bug,
  Sword,
  Network,
};

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-700', label: '待执行' },
  running: { bg: 'bg-blue-100', text: 'text-blue-700', label: '执行中' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: '已完成' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: '执行失败' },
};

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50];
const DEFAULT_PAGE_SIZE = 10;

const STATIC_TASKS: TaskInstance[] = [
  {
    id: 'task-1',
    name: 'Java代码审计-示例项目',
    templateId: 'code-review',
    templateName: '代码审计',
    status: 'completed',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T12:45:00Z',
    parameters: {
      targetPath: '/src/main/java',
      language: 'Java',
      depth: '标准审计',
    },
    notes: '示例项目安全审计',
    userName: 'admin',
  },
  {
    id: 'task-2',
    name: 'Web应用漏洞扫描',
    templateId: 'vuln-scan',
    templateName: '漏洞扫描',
    status: 'running',
    createdAt: '2024-01-16T09:00:00Z',
    updatedAt: '2024-01-16T09:00:00Z',
    parameters: {
      targetUrl: 'https://example.com',
      scanType: '主动扫描',
    },
    userName: 'admin',
  },
  {
    id: 'task-3',
    name: '支付模块渗透测试',
    templateId: 'penetration-test',
    templateName: '渗透测试',
    status: 'pending',
    createdAt: '2024-01-17T14:20:00Z',
    updatedAt: '2024-01-17T14:20:00Z',
    parameters: {
      targetUrl: 'https://pay.example.com',
      testScope: '支付接口、订单管理',
      testStrategy: '灰盒测试',
    },
    userName: 'developer',
  },
  {
    id: 'task-4',
    name: '电商系统威胁建模',
    templateId: 'threat-modeling',
    templateName: '威胁建模',
    status: 'completed',
    createdAt: '2024-01-18T08:00:00Z',
    updatedAt: '2024-01-18T10:30:00Z',
    parameters: {
      systemDesc: '电商平台，包含用户管理、订单处理、支付系统',
      keyAssets: '用户数据、支付信息、订单记录',
      framework: 'STRIDE',
    },
    userName: 'admin',
  },
  {
    id: 'task-5',
    name: 'Python代码安全审计',
    templateId: 'code-review',
    templateName: '代码审计',
    status: 'pending',
    createdAt: '2024-01-19T11:00:00Z',
    updatedAt: '2024-01-19T11:00:00Z',
    parameters: {
      targetPath: '/app',
      language: 'Python',
      depth: '深度分析',
      focusAreas: 'SQL注入、XSS、敏感信息泄露',
    },
    userName: 'tester',
  },
  {
    id: 'task-6',
    name: 'API接口漏洞扫描',
    templateId: 'vuln-scan',
    templateName: '漏洞扫描',
    status: 'failed',
    createdAt: '2024-01-20T15:30:00Z',
    updatedAt: '2024-01-20T16:00:00Z',
    parameters: {
      targetUrl: 'https://api.example.com',
      scanType: '全面扫描',
      vulnCategories: '注入类',
    },
    notes: '扫描过程中出现网络超时',
    userName: 'developer',
  },
  {
    id: 'task-7',
    name: '内部管理系统渗透测试',
    templateId: 'penetration-test',
    templateName: '渗透测试',
    status: 'completed',
    createdAt: '2024-01-21T09:00:00Z',
    updatedAt: '2024-01-21T17:00:00Z',
    parameters: {
      targetUrl: 'https://internal.example.com',
      testScope: '用户管理、权限控制、数据导出',
      authType: '管理员账号',
      testStrategy: '白盒测试',
    },
    userName: 'admin',
  },
  {
    id: 'task-8',
    name: '微服务架构威胁建模',
    templateId: 'threat-modeling',
    templateName: '威胁建模',
    status: 'pending',
    createdAt: '2024-01-22T10:00:00Z',
    updatedAt: '2024-01-22T10:00:00Z',
    parameters: {
      systemDesc: '微服务架构，包含服务网关、认证服务、业务服务',
      keyAssets: 'API密钥、用户Token、业务数据',
      trustBoundary: '外部网络与网关边界、服务间边界',
      framework: 'PASTA',
    },
    userName: 'architect',
  },
  {
    id: 'task-9',
    name: '移动App代码审计',
    templateId: 'code-review',
    templateName: '代码审计',
    status: 'running',
    createdAt: '2024-01-23T08:30:00Z',
    updatedAt: '2024-01-23T08:30:00Z',
    parameters: {
      targetPath: '/mobile-app/src',
      language: 'Java',
      depth: '标准审计',
    },
    userName: 'admin',
  },
  {
    id: 'task-10',
    name: 'OAuth认证漏洞扫描',
    templateId: 'vuln-scan',
    templateName: '漏洞扫描',
    status: 'completed',
    createdAt: '2024-01-24T13:00:00Z',
    updatedAt: '2024-01-24T14:30:00Z',
    parameters: {
      targetUrl: 'https://auth.example.com',
      scanType: '主动扫描',
      vulnCategories: '认证类',
    },
    userName: 'security',
  },
  {
    id: 'task-11',
    name: '数据库服务渗透测试',
    templateId: 'penetration-test',
    templateName: '渗透测试',
    status: 'pending',
    createdAt: '2024-01-25T09:00:00Z',
    updatedAt: '2024-01-25T09:00:00Z',
    parameters: {
      targetUrl: 'db.example.com:3306',
      testScope: '数据库访问控制、权限配置',
      testStrategy: '灰盒测试',
    },
    userName: 'dba',
  },
  {
    id: 'task-12',
    name: '云平台威胁建模',
    templateId: 'threat-modeling',
    templateName: '威胁建模',
    status: 'completed',
    createdAt: '2024-01-26T11:00:00Z',
    updatedAt: '2024-01-26T15:00:00Z',
    parameters: {
      systemDesc: '云平台基础设施，包含计算、存储、网络服务',
      keyAssets: '用户数据、配置信息、访问密钥',
      framework: 'STRIDE',
    },
    userName: 'cloud-admin',
  },
];

export default function TaskBuilderPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    fetchTasks(currentPage, pageSize);
  }, [currentPage, pageSize]);

  const fetchTasks = async (page: number, size: number) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/task-builder/tasks?page=${page}&limit=${size}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks || []);
        setTotalCount(data.pagination?.total || 0);
        setTotalPages(data.pagination?.totalPages || 0);
      } else {
        useStaticData(page, size);
      }
    } catch {
      useStaticData(page, size);
    } finally {
      setLoading(false);
    }
  };

  const useStaticData = (page: number, size: number) => {
    const total = STATIC_TASKS.length;
    const totalPages = Math.ceil(total / size);
    const start = (page - 1) * size;
    const end = start + size;
    const pageTasks = STATIC_TASKS.slice(start, end);
    
    setTasks(pageTasks);
    setTotalCount(total);
    setTotalPages(totalPages);
  };

  const handleCreateTask = async (formData: any) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/task-builder/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '创建失败');
      }

      toast.success('任务实例创建成功');
      setShowCreateModal(false);
      setCurrentPage(1);
      await fetchTasks(1, pageSize);
    } catch (error) {
      toast.error(`创建失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleViewDetail = (taskId: string) => {
    router.push(`/dashboard/task-builder/${taskId}`);
  };

  const handleRunTask = async (taskId: string) => {
    toast('任务执行功能待实现', { icon: '🔧' });
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('确定要删除此任务实例吗？')) return;
    toast('删除功能待实现', { icon: '🔧' });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">任务实例</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理您的安全审计任务实例
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchTasks(currentPage, pageSize)}
            disabled={loading}
            className="flex items-center space-x-2 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Plus size={20} />
            <span>创建任务</span>
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <ClipboardList className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">暂无任务实例</h3>
          <p className="mt-2 text-sm text-gray-600">
            点击右上角"创建任务"开始构建安全审计任务
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    任务名称
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    模板类型
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    创建时间
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    创建人
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {tasks.map((task) => {
                  const Icon = iconMap[task.templateId === 'code-review' ? 'Shield' :
                                     task.templateId === 'vuln-scan' ? 'Bug' :
                                     task.templateId === 'penetration-test' ? 'Sword' : 'Network'];
                  const config = statusConfig[task.status] || statusConfig.pending;

                  return (
                    <tr key={task.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Icon size={16} className="text-gray-500" />
                          <span className="text-sm font-medium text-gray-900">
                            {task.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-600">
                          {task.templateName}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
                          {config.label}
                          {task.status === 'running' && <Loader2 size={12} className="ml-1 animate-spin" />}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-500 flex items-center gap-1">
                          <Calendar size={14} className="text-gray-400" />
                          {formatDate(task.createdAt)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-500 flex items-center gap-1">
                          <User size={14} className="text-gray-400" />
                          {task.userName || '未知'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          {task.status === 'pending' && (
                            <button
                              onClick={() => handleRunTask(task.id)}
                              className="text-green-600 hover:text-green-900 flex items-center gap-1"
                            >
                              <Play size={14} />
                              执行
                            </button>
                          )}
                          <button
                            onClick={() => handleViewDetail(task.id)}
                            className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                          >
                            <Eye size={14} />
                            详情
                          </button>
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="text-red-600 hover:text-red-900 flex items-center gap-1"
                          >
                            <Trash2 size={14} />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 分页信息 - 始终显示 */}
      <div className="bg-white px-6 py-3 border border-gray-200 rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-600">
            {totalCount > 0 
              ? `共 ${totalCount} 条记录，第 ${currentPage} / ${totalPages || 1} 页`
              : '暂无记录'}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>每页显示</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="px-2 py-1 border border-gray-300 rounded-md bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} 条
                </option>
              ))}
            </select>
          </div>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft size={16} />
              上一页
            </button>
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              下一页
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      <TaskCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateTask}
      />
    </div>
  );
}