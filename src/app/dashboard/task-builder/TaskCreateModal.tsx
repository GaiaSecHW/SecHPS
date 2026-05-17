'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Upload, File, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import ProductTreeSelect from '@/components/ui/ProductTreeSelect';

interface AgentApp {
  id: string;
  name: string;
  engine: string;
  startCommand: string;
  notes: string | null;
}

interface ModelConfig {
  id: string;
  name: string;
  providerType: string;
  models: string[];
  isActive: boolean;
  isDefault: boolean;
}

// 展平后的单条选项
interface ModelOption {
  key: string;       // "modelId::modelName"
  modelId: string;
  modelName: string;
  label: string;     // "配置名 - 模型名"
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: {
    name: string;
    agents: { agentId: string; agentName: string }[];
    modelId: string;
    modelName: string;
    description: string;
    targetProduct: string;
  }, file: File | null) => Promise<void>;
}

export default function TaskCreateModal({ isOpen, onClose, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [agentApps, setAgentApps] = useState<AgentApp[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetProduct, setTargetProduct] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      fetchAgentApps();
      fetchModels();
      setName('');
      setDescription('');
      setSelectedAgentIds(new Set());
      setSelectedModelKey('');
      setSelectedFile(null);
      setTargetProduct('');
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

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/models?isActive=true&forEvaluation=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const configs: ModelConfig[] = data.models || [];

        // 展平：每个配置 × 每个模型名 = 一条选项
        const options: ModelOption[] = [];
        for (const cfg of configs) {
          for (const modelName of cfg.models || []) {
            const suffix = cfg.isDefault ? ' [默认]' : '';
            options.push({
              key: `${cfg.id}::${modelName}`,
              modelId: cfg.id,
              modelName,
              label: `${cfg.name} - ${modelName}${suffix}`,
            });
          }
        }
        setModelOptions(options);

        // 自动选中默认配置的第一个模型
        const defaultCfg = configs.find(m => m.isDefault);
        if (defaultCfg && defaultCfg.models?.length > 0) {
          setSelectedModelKey(`${defaultCfg.id}::${defaultCfg.models[0]}`);
        } else if (options.length > 0) {
          setSelectedModelKey(options[0].key);
        }
      } else {
        toast.error('获取模型列表失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setLoadingModels(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024 * 1024) {
        toast.error('文件大小不能超过 5GB');
        return;
      }
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const allowed = ['.zip','.jar','.war','.ear','.tar','.gz','.rar','.7z',
        '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt',
        '.md','.csv','.json','.xml','.yaml','.yml'];
      if (!allowed.includes(ext)) {
        toast.error('文件格式不支持，仅支持 ZIP、JAR、WAR 等格式');
        return;
      }
      setSelectedFile(file);
      if (!name) setName(file.name.split('.')[0]);
    }
  };

  const handleFileDrop = (files: FileList) => {
    const file = files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 * 1024) {
      toast.error('文件大小不能超过 5GB');
      return;
    }
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    const allowed = ['.zip','.jar','.war','.ear','.tar','.gz','.rar','.7z',
      '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt',
      '.md','.csv','.json','.xml','.yaml','.yml'];
    if (!allowed.includes(ext)) {
      toast.error('文件格式不支持，仅支持 ZIP、JAR、WAR 等格式');
      return;
    }
    setSelectedFile(file);
    if (!name) setName(file.name.split('.')[0]);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('请输入任务名称'); return; }
    if (selectedAgentIds.size === 0) { toast.error('请至少选择一个 Agent'); return; }
    if (!selectedModelKey) { toast.error('请选择模型'); return; }

    const option = modelOptions.find(o => o.key === selectedModelKey);
    if (!option) { toast.error('请选择模型'); return; }

    const agents = agentApps
      .filter(a => selectedAgentIds.has(a.id))
      .map(a => ({ agentId: a.id, agentName: a.name }));

    setIsSubmitting(true);
    try {
      await onSubmit(
        { name: name.trim(), agents, modelId: option.modelId, modelName: option.modelName, description: description.trim(), targetProduct },
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
    setSelectedAgentIds(new Set());
    setSelectedModelKey('');
    setSelectedFile(null);
    setIsSubmitting(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-dark-surface rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-100">创建任务</h3>
          <button onClick={handleClose} disabled={isSubmitting} className="text-gray-400 hover:text-gray-300 disabled:opacity-50">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 产品名称 */}
          <div>
            <div className="flex items-center gap-2">
              <label className="block text-sm font-medium text-gray-300">产品名称</label>
              <span className="text-xs text-red-400">选择产品可以匹配知识图谱，任务扫描更加精准</span>
            </div>
            <div className="mt-1">
              <ProductTreeSelect value={targetProduct} onChange={setTargetProduct} />
            </div>
          </div>

          {/* 任务名称 */}
          <div>
            <label htmlFor="taskName" className="block text-sm font-medium text-gray-300">任务名称 *</label>
            <input
              id="taskName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="请输入任务名称"
            />
          </div>

          {/* 任务描述 */}
          <div>
            <label htmlFor="taskDescription" className="block text-sm font-medium text-gray-300">任务描述</label>
            <textarea
              id="taskDescription"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="对任务的简要描述（可选）..."
            />
          </div>

          {/* 选择 Agent */}
          <div>
            <label className="block text-sm font-medium text-gray-300">
              选择 Agent *
              {selectedAgentIds.size > 0 && (
                <span className="ml-2 text-xs text-blue-400 font-normal">
                  已选 {selectedAgentIds.size} 个，将创建 {selectedAgentIds.size} 个任务
                </span>
              )}
            </label>
            {loadingAgents ? (
              <div className="mt-1 flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-blue-400" />
              </div>
            ) : agentApps.length === 0 ? (
              <div className="mt-1 text-center py-8 text-gray-500 text-sm bg-[#0F172A] border border-gray-700/50 rounded-md">
                暂无可用 Agent 应用，请在 Agent应用开发页面创建
              </div>
            ) : (
              <div className="mt-1 border border-gray-600 rounded-md divide-y divide-gray-700/50 max-h-48 overflow-y-auto">
                {agentApps.map((agent) => (
                  <label key={agent.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-dark-surface-hover transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedAgentIds.has(agent.id)}
                      onChange={() => toggleAgent(agent.id)}
                      className="w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 bg-dark-bg"
                    />
                    <span className="text-sm text-gray-200">{agent.name}</span>
                    <span className="text-xs text-gray-500 ml-auto">{agent.engine}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 选择模型（合并为一个下拉） */}
          <div>
            <label htmlFor="modelSelect" className="block text-sm font-medium text-gray-300">选择模型 *</label>
            {loadingModels ? (
              <div className="mt-1 flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-blue-400" />
              </div>
            ) : modelOptions.length === 0 ? (
              <div className="mt-1 text-center py-8 text-gray-500 text-sm bg-[#0F172A] border border-gray-700/50 rounded-md">
                暂无可用模型，请在 我的模型页面创建
              </div>
            ) : (
              <select
                id="modelSelect"
                value={selectedModelKey}
                onChange={(e) => setSelectedModelKey(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">请选择模型</option>
                {modelOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            )}
          </div>

          {/* 上传文件 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">上传文件</label>
            {selectedFile ? (
              <div className="flex items-center justify-between p-3 bg-[#0F172A] border border-gray-700/50 rounded-md">
                <div className="flex items-center space-x-2">
                  <File size={16} className="text-gray-400" />
                  <span className="text-sm text-gray-100 truncate max-w-[300px]">{selectedFile.name}</span>
                  <span className="text-xs text-gray-500">
                    {selectedFile.size > 1024 * 1024
                      ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                      : `${(selectedFile.size / 1024).toFixed(2)} KB`}
                  </span>
                </div>
                <button onClick={handleRemoveFile} className="p-1 text-red-400 hover:text-red-300">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-gray-600 rounded-md p-6 hover:border-blue-400 transition-colors"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-900/20'); }}
                onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-900/20'); }}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-900/20'); if (e.dataTransfer.files.length > 0) handleFileDrop(e.dataTransfer.files); }}
              >
                <div className="text-center">
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="mt-4">
                    <label htmlFor="file-upload-task" className="cursor-pointer font-medium text-blue-400 hover:text-blue-500">
                      <span>点击上传文件</span>
                      <input
                        id="file-upload-task"
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept=".zip,.jar,.war,.ear,.tar,.gz,.rar,.7z,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.yaml,.yml"
                        className="sr-only"
                      />
                    </label>
                    <p className="pl-1">或拖拽文件到此处</p>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    支持 ZIP、JAR、WAR、PDF、DOC、TXT、JSON 等格式，单个文件最大 5GB
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-700/50 flex justify-end space-x-3">
          <button onClick={handleClose} disabled={isSubmitting} className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A] disabled:opacity-50">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim() || selectedAgentIds.size === 0 || !selectedModelKey}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting && <Loader2 size={14} className="animate-spin" />}
            {isSubmitting ? '创建中...' : selectedAgentIds.size > 1 ? `创建 ${selectedAgentIds.size} 个任务` : '创建任务'}
          </button>
        </div>
      </div>
    </div>
  );
}
