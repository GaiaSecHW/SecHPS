'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Upload, File, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface AgentApp {
  id: string;
  name: string;
  engine: string;
  startCommand: string;
  notes: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: { name: string; agentId: string; agentName: string; description: string }, file: File | null) => Promise<void>;
}

export default function TaskCreateModal({ isOpen, onClose, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentApps, setAgentApps] = useState<AgentApp[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      fetchAgentApps();
      setName('');
      setDescription('');
      setSelectedAgentId('');
      setSelectedFile(null);
    }
  }, [isOpen]);

  const fetchAgentApps = async () => {
    setLoadingAgents(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/agent-apps', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setAgentApps(data.apps || []);
      } else {
        toast.error('获取 Agent 应用列表失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setLoadingAgents(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const maxSize = 5 * 1024 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error('文件大小不能超过 5GB');
        return;
      }
      setSelectedFile(file);
      if (!name) {
        setName(file.name.split('.')[0]);
      }
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('请输入任务名称');
      return;
    }
    if (!selectedAgentId) {
      toast.error('请选择 Agent');
      return;
    }

    const selectedAgent = agentApps.find(a => a.id === selectedAgentId);
    
    setIsSubmitting(true);
    try {
      await onSubmit(
        {
          name: name.trim(),
          agentId: selectedAgentId,
          agentName: selectedAgent?.name || '',
          description: description.trim(),
        },
        selectedFile
      );
      onClose();
    } catch {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setSelectedAgentId('');
    setSelectedFile(null);
    setIsSubmitting(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">创建任务实例</h3>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="taskName" className="block text-sm font-medium text-gray-700">
              任务名称 *
            </label>
            <input
              id="taskName"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="请输入任务名称"
            />
          </div>

          <div>
            <label htmlFor="taskDescription" className="block text-sm font-medium text-gray-700">
              任务描述
            </label>
            <textarea
              id="taskDescription"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="请输入任务描述（可选）"
            />
          </div>

          <div>
            <label htmlFor="agentSelect" className="block text-sm font-medium text-gray-700">
              选择 Agent *
            </label>
            {loadingAgents ? (
              <div className="mt-1 flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-blue-600" />
              </div>
            ) : agentApps.length === 0 ? (
              <div className="mt-1 text-center py-8 text-gray-500 text-sm bg-gray-50 border border-gray-200 rounded-md">
                暂无可用 Agent 应用，请在 Agent应用开发页面创建
              </div>
            ) : (
              <select
                id="agentSelect"
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">请选择 Agent</option>
                {agentApps.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agent.engine})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              上传文件
            </label>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept=".zip,.jar,.war,.ear,.tar,.gz,.rar,.7z,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.yaml,.yml"
              className="hidden"
            />
            {selectedFile ? (
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-md">
                <div className="flex items-center space-x-2">
                  <File size={16} className="text-gray-400" />
                  <span className="text-sm text-gray-900 truncate max-w-[300px]">{selectedFile.name}</span>
                  <span className="text-xs text-gray-500">
                    {selectedFile.size > 1024 * 1024
                      ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                      : `${(selectedFile.size / 1024).toFixed(2)} KB`}
                  </span>
                </div>
                <button
                  onClick={handleRemoveFile}
                  className="p-1 text-red-600 hover:text-red-800"
                  title="删除文件"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-md p-6 hover:border-blue-400 transition-colors cursor-pointer"
              >
                <div className="text-center">
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="mt-4">
                    <span className="text-sm text-gray-600">点击上传文件</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    支持多种格式：压缩包、文档、数据文件，最大 5GB
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim() || !selectedAgentId}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting && <Loader2 size={14} className="animate-spin" />}
            {isSubmitting ? '创建中...' : '创建任务'}
          </button>
        </div>
      </div>
    </div>
  );
}