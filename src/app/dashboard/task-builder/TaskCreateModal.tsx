'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Upload, File, Loader2, ChevronDown, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import ProductTreeSelect from '@/components/ui/ProductTreeSelect';
import { useAuth } from '@/hooks/useAuth';

interface AgentApp {
  id: string;
  name: string;
  engine: string;
  startCommand: string;
  notes: string | null;
  inputRequirements: string | null;
  requireCodedmap?: boolean;
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
  providerType: string; // 提供商类型，用于颜色标记
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

// Agent 引擎 → 兼容的 Model providerType 映射
const ENGINE_PROVIDER_MAP: Record<string, string[]> = {
  claudecode: ['claude'],
  opencode: ['openai'],
  agentflow: ['openai', 'claude'],
};

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
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  // 选中的 Agent 是否需要知识图谱（动态计算）
  const needsCodedmap = agentApps.some(a => selectedAgentIds.has(a.id) && a.requireCodedmap);

  const MAX_UPLOAD_MB = parseInt(process.env.NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB || '500', 10);
  const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

  function generateDefaultTaskName(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const prefix = user?.username || '任务';
    return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  const compatibleProviderTypes = useMemo(() => {
    const selectedEngines = agentApps
      .filter(a => selectedAgentIds.has(a.id))
      .map(a => a.engine);

    if (selectedEngines.length === 0) return null;

    const providerLists = selectedEngines.map(e => ENGINE_PROVIDER_MAP[e] || []);
    if (providerLists.length === 1) return providerLists[0];

    const first = providerLists[0];
    return first.filter(p => providerLists.every(list => list.includes(p)));
  }, [agentApps, selectedAgentIds]);

  const filteredModelOptions = useMemo(() => {
    if (compatibleProviderTypes === null) return modelOptions;
    return modelOptions.filter(o => compatibleProviderTypes.includes(o.providerType));
  }, [modelOptions, compatibleProviderTypes]);

  useEffect(() => {
    if (isOpen) {
      fetchAgentApps();
      fetchModels();
      setName(generateDefaultTaskName());
      setDescription('');
      setSelectedAgentIds(new Set());
      setSelectedModelKey('');
      setSelectedFile(null);
      setTargetProduct('');
      setModelDropdownOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // 选中的 Agent 不再需要知识图谱时，清空已选的产品名称
  useEffect(() => {
    if (!needsCodedmap && targetProduct) {
      setTargetProduct('');
    }
  }, [needsCodedmap]);

  useEffect(() => {
    const currentValid = filteredModelOptions.find(o => o.key === selectedModelKey);
    if (!currentValid && filteredModelOptions.length > 0) {
      const defaultOpt = filteredModelOptions.find(o => o.label.includes('[默认]'));
      setSelectedModelKey(defaultOpt?.key || filteredModelOptions[0].key);
    } else if (!currentValid && filteredModelOptions.length === 0) {
      setSelectedModelKey('');
    }
  }, [filteredModelOptions, selectedModelKey]);

  const getProviderColor = (providerType: string) => {
    const type = providerType.toLowerCase();
    if (type === 'anthropic') return 'text-orange-400 bg-orange-500/20 border-orange-500/50';
    if (type === 'openai') return 'text-green-400 bg-green-500/20 border-green-500/50';
    if (type === 'deepseek') return 'text-blue-400 bg-blue-500/20 border-blue-500/50';
    if (type === 'google') return 'text-purple-400 bg-purple-500/20 border-purple-500/50';
    if (type === 'azure') return 'text-cyan-400 bg-cyan-500/20 border-cyan-500/50';
    return 'text-gray-400 bg-gray-500/20 border-gray-500/50';
  };

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
              providerType: cfg.providerType || '',
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
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`文件大小不能超过 ${MAX_UPLOAD_MB}MB`);
        return;
      }
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const allowed = ['.zip', '.jar', '.tar', '.gz', '.tgz'];
      if (!allowed.includes(ext)) {
        toast.error('文件格式不支持，仅支持 ZIP、JAR、TAR 格式');
        return;
      }
      setSelectedFile(file);
      if (!name) setName(file.name.split('.')[0]);
    }
  };

  const handleFileDrop = (files: FileList) => {
    const file = files[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`文件大小不能超过 ${MAX_UPLOAD_MB}MB`);
      return;
    }
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    const allowed = ['.zip', '.jar', '.tar', '.gz', '.tgz'];
    if (!allowed.includes(ext)) {
      toast.error('文件格式不支持，仅支持 ZIP、JAR、TAR 格式');
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
    if (!selectedFile) { toast.error('请上传文件'); return; }

    const option = filteredModelOptions.find(o => o.key === selectedModelKey);
    if (!option) { toast.error('请选择模型'); return; }

    const agents = agentApps
      .filter(a => selectedAgentIds.has(a.id))
      .map(a => ({ agentId: a.id, agentName: a.name }));

    setIsSubmitting(true);
    try {
      const finalTargetProduct = needsCodedmap ? targetProduct : '';
      await onSubmit(
        { name: name.trim(), agents, modelId: option.modelId, modelName: option.modelName, description: description.trim(), targetProduct: finalTargetProduct },
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-dark-surface rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-100">创建任务</h3>
          <button onClick={handleClose} disabled={isSubmitting} className="text-gray-400 hover:text-gray-300 disabled:opacity-50">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 产品名称 — 仅选中的 Agent 需要知识图谱时显示 */}
          {needsCodedmap && (
          <div>
            <div className="flex items-center gap-2">
              <label className="block text-sm font-medium text-gray-300">产品名称</label>
              <span className="text-xs text-gray-400">选择产品可以匹配知识图谱，任务扫描更加精准</span>
            </div>
            <div className="mt-1">
              <ProductTreeSelect value={targetProduct} onChange={setTargetProduct} />
            </div>
          </div>
          )}

          {/* 任务名称 */}
          <div>
            <label htmlFor="taskName" className="block text-sm font-medium text-gray-300">任务名称 <span className="text-red-400">*</span></label>
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
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="对任务的简要描述（可选）..."
            />
          </div>

          {/* 选择 Agent */}
          <div>
            <label className="block text-sm font-medium text-gray-300">
              选择 Agent <span className="text-red-400">*</span>
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
            <label className="block text-sm font-medium text-gray-300">选择模型 <span className="text-red-400">*</span>
                {compatibleProviderTypes !== null && <span className="ml-2 text-xs text-blue-400 font-normal">已按引擎过滤</span>}
              </label>
            {loadingModels ? (
              <div className="mt-1 flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-blue-400" />
              </div>
            ) : filteredModelOptions.length === 0 ? (
              <div className="mt-1 text-center py-8 text-sm bg-[#0F172A] border border-gray-700/50 rounded-md">
                {modelOptions.length === 0
                  ? <span className="text-gray-500">暂无可用模型，请在 我的模型页面创建</span>
                  : <span className="text-yellow-400">选中的 Agent 没有兼容的模型配置</span>
                }
              </div>
            ) : (
              <div className="mt-1 relative" ref={modelDropdownRef}>
                <button
                  type="button"
                  onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                  className={`w-full px-3 py-2 border rounded-md text-left flex items-center justify-between transition-colors ${
                    modelDropdownOpen ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-600'
                  }`}
                >
                  {selectedModelKey ? (
                    <div className="flex items-center gap-2">
                      {(() => {
                        const opt = filteredModelOptions.find(o => o.key === selectedModelKey);
                        if (!opt) return <span className="text-gray-200">请选择模型</span>;
                        return (
                          <>
                            <span className={`px-1.5 py-0.5 text-xs font-medium rounded border ${getProviderColor(opt.providerType)}`}>
                              {opt.providerType || 'unknown'}
                            </span>
                            <span className="text-gray-200 truncate">{opt.label}</span>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <span className="text-gray-500">请选择模型</span>
                  )}
                  <ChevronDown size={16} className={`text-gray-400 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {modelDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full bg-[#0F172A] border border-gray-600 rounded-md shadow-xl max-h-60 overflow-y-auto">
                    {filteredModelOptions.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => { setSelectedModelKey(opt.key); setModelDropdownOpen(false); }}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-blue-900/30 transition-colors ${
                          selectedModelKey === opt.key ? 'bg-blue-900/40' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 text-xs font-medium rounded border ${getProviderColor(opt.providerType)}`}>
                            {opt.providerType || 'unknown'}
                          </span>
                          <span className={`text-sm truncate ${selectedModelKey === opt.key ? 'text-blue-300' : 'text-gray-200'}`}>
                            {opt.label}
                          </span>
                        </div>
                        {selectedModelKey === opt.key && <Check size={14} className="text-blue-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 文件要求提示 */}
          {(() => {
            const hints = agentApps
              .filter(a => selectedAgentIds.has(a.id) && a.inputRequirements?.trim())
              .map(a => ({ name: a.name, req: a.inputRequirements! }));
            if (hints.length === 0) return null;
            return (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2.5 text-sm text-yellow-300">
                <p className="font-medium mb-1">文件要求</p>
                {hints.map(h => (
                  <p key={h.name} className="text-yellow-400/80 text-xs leading-relaxed">
                    {hints.length > 1 && <span className="font-medium">[{h.name}] </span>}
                    {h.req}
                  </p>
                ))}
              </div>
            );
          })()}

          {/* 上传文件 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">上传文件 <span className="text-red-400">*</span></label>
            {selectedFile ? (
              <div className="border border-gray-700/50 rounded-md px-3 py-2 flex items-center justify-between bg-dark-bg">
                <div className="flex items-center gap-2">
                  <File size={16} className="text-primary-400" />
                  <span className="text-sm text-gray-200 truncate max-w-[280px]">{selectedFile.name}</span>
                  <span className="text-xs text-gray-500">
                    {selectedFile.size > 1024 * 1024
                      ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`
                      : `${(selectedFile.size / 1024).toFixed(1)} KB`}
                  </span>
                </div>
                <button onClick={handleRemoveFile} className="h-7 px-2 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/15">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div
                className="border border-gray-700/50 rounded-md p-3 hover:border-primary-500 cursor-pointer bg-dark-bg"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-primary-500', 'bg-primary-500/10'); }}
                onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-primary-500', 'bg-primary-500/10'); }}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-primary-500', 'bg-primary-500/10'); if (e.dataTransfer.files.length > 0) handleFileDrop(e.dataTransfer.files); }}
              >
                <div className="flex items-center justify-center gap-2 text-gray-500">
                  <Upload size={16} />
                  <span className="text-sm">点击或拖拽上传文件</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelect}
                    accept=".zip,.jar,.tar,.tar.gz,.tgz"
                    className="hidden"
                  />
                </div>
                <p className="text-xs text-gray-500 text-center mt-1">
                  仅支持 ZIP、JAR、TAR 格式，最大 5GB
                </p>
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
            disabled={isSubmitting || !name.trim() || selectedAgentIds.size === 0 || !selectedModelKey || !selectedFile}
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
