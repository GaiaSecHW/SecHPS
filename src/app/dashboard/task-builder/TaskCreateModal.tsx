'use client';

import { useState, useEffect, useRef } from 'react';
import { X, CheckCircle2, ArrowRight, ArrowLeft, Upload, File, Loader2, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import toast from 'react-hot-toast';

interface Agent {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  category: string;
  model: string;
  skills: string | null;
  isBuiltin: boolean;
}

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  cwe: string | null;
}

interface TaskFormData {
  name: string;
  agentId: string;
  agentName: string;
  notes: string;
  selectedSkills: string[];
  selectedScripts: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: TaskFormData, file: File | null) => Promise<void>;
}

const STEPS = [
  { id: 'select', label: '选择 Agent' },
  { id: 'resources', label: '注入资源' },
  { id: 'configure', label: '配置任务' },
] as const;

type StepId = typeof STEPS[number]['id'];

const initialFormData: TaskFormData = {
  name: '',
  agentId: '',
  agentName: '',
  notes: '',
  selectedSkills: [],
  selectedScripts: [],
};

export default function TaskCreateModal({ isOpen, onClose, onSubmit }: Props) {
  const [currentStep, setCurrentStep] = useState<StepId>('select');
  const [formData, setFormData] = useState<TaskFormData>(initialFormData);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [availableScripts, setAvailableScripts] = useState<string[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scriptUploadRef = useRef<HTMLInputElement>(null);
  const [uploadingScript, setUploadingScript] = useState(false);

  const currentStepIndex = STEPS.findIndex(s => s.id === currentStep);

  useEffect(() => {
    if (isOpen) {
      fetchAgents();
    }
  }, [isOpen]);

  const fetchAgents = async () => {
    setLoadingAgents(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/agent-definitions', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setAgents(data.agents || []);
      } else {
        toast.error('获取 Agent 列表失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setLoadingAgents(false);
    }
  };

  const fetchResources = async () => {
    setLoadingResources(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/task-builder/available-resources', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setSkills(data.skills || []);
        setAvailableScripts(data.scripts || []);
      } else {
        toast.error('获取资源列表失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setLoadingResources(false);
    }
  };

  const handleAgentSelect = (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      setFormData({
        ...formData,
        agentId,
        agentName: agent.displayName || agent.name,
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const maxSize = 100 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error('文件大小不能超过 100MB');
        return;
      }
      setSelectedFile(file);
      if (!formData.name) {
        setFormData({ ...formData, name: file.name.split('.')[0] });
      }
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const toggleSkill = (skillId: string) => {
    const newSkills = formData.selectedSkills.includes(skillId)
      ? formData.selectedSkills.filter(id => id !== skillId)
      : [...formData.selectedSkills, skillId];
    setFormData({ ...formData, selectedSkills: newSkills });
  };

  const toggleScript = (scriptName: string) => {
    const newScripts = formData.selectedScripts.includes(scriptName)
      ? formData.selectedScripts.filter(name => name !== scriptName)
      : [...formData.selectedScripts, scriptName];
    setFormData({ ...formData, selectedScripts: newScripts });
  };

  const handleScriptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedExtensions = ['.sh', '.py', '.js', '.ts'];
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    if (!ext || !allowedExtensions.includes(`.${ext}`)) {
      toast.error(`不支持的文件类型，仅支持: ${allowedExtensions.join(', ')}`);
      if (scriptUploadRef.current) {
        scriptUploadRef.current.value = '';
      }
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('文件大小不能超过 10MB');
      if (scriptUploadRef.current) {
        scriptUploadRef.current.value = '';
      }
      return;
    }

    setUploadingScript(true);
    try {
      const token = localStorage.getItem('token');
      const form = new FormData();
      form.append('file', file);

      const response = await fetch('/api/task-builder/scripts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '上传失败');
      }

      toast.success('脚本上传成功');
      setAvailableScripts(prev => [...prev, file.name]);
      setFormData(prev => ({
        ...prev,
        selectedScripts: [...prev.selectedScripts, file.name],
      }));

      if (scriptUploadRef.current) {
        scriptUploadRef.current.value = '';
      }
    } catch (error) {
      toast.error(`上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setUploadingScript(false);
    }
  };

  const handleNext = () => {
    if (currentStep === 'select' && formData.agentId) {
      fetchResources();
      setCurrentStep('resources');
    } else if (currentStep === 'resources') {
      setCurrentStep('configure');
    }
  };

  const handlePrevious = () => {
    if (currentStep === 'configure') {
      setCurrentStep('resources');
    } else if (currentStep === 'resources') {
      setCurrentStep('select');
    }
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error('请输入任务名称');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(formData, selectedFile);
      resetAndClose();
    } catch {
      setIsSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setCurrentStep('select');
    setFormData(initialFormData);
    setSelectedFile(null);
    setIsSubmitting(false);
    setUploadingScript(false);
    if (scriptUploadRef.current) {
      scriptUploadRef.current.value = '';
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} size="xl" showCloseButton={false}>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">创建任务实例</h2>
            <div className="flex items-center gap-2 mt-2">
              {STEPS.map((step, index) => {
                const isActive = step.id === currentStep;
                const isCompleted = index < currentStepIndex;

                return (
                  <div key={step.id} className="flex items-center">
                    <div
                      className={`flex items-center gap-1 ${
                        isActive ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-400'
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : isCompleted
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {isCompleted ? <CheckCircle2 size={12} /> : index + 1}
                      </div>
                      <span className="text-sm">{step.label}</span>
                    </div>
                    {index < STEPS.length - 1 && (
                      <ArrowRight size={16} className="mx-2 text-gray-300" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <button
            onClick={resetAndClose}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {currentStep === 'select' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">选择 Agent：</p>
              {loadingAgents ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-blue-600" />
                </div>
              ) : agents.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  暂无可用 Agent，请联系管理员创建
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      onClick={() => handleAgentSelect(agent.id)}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        formData.agentId === agent.id
                          ? 'bg-blue-50 border-blue-500 shadow-md'
                          : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900">
                          {agent.displayName || agent.name}
                        </span>
                        {formData.agentId === agent.id && (
                          <CheckCircle2 size={16} className="text-blue-600" />
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {agent.description || '无描述'}
                      </p>
                      <div className="flex gap-1 mt-2">
                        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                          {agent.category}
                        </span>
                        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                          {agent.model}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {currentStep === 'resources' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  为 Agent <span className="font-medium">{formData.agentName}</span> 注入额外的 Skills 和脚本
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择 Skills <span className="text-gray-500 text-xs ml-1">(可选，多选)</span>
                </label>
                {loadingResources ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={20} className="animate-spin text-blue-600" />
                  </div>
                ) : skills.length === 0 ? (
                  <p className="text-sm text-gray-500">暂无可用 Skills</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {skills.map((skill) => (
                      <div
                        key={skill.id}
                        onClick={() => toggleSkill(skill.id)}
                        className={`p-2 rounded border cursor-pointer transition-all ${
                          formData.selectedSkills.includes(skill.id)
                            ? 'bg-blue-50 border-blue-500'
                            : 'bg-white border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">
                            {skill.displayName}
                          </span>
                          {formData.selectedSkills.includes(skill.id) && (
                            <CheckCircle2 size={14} className="text-blue-600" />
                          )}
                        </div>
                        {skill.description && (
                          <p className="text-xs text-gray-600 mt-1 line-clamp-1">
                            {skill.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择脚本文件 <span className="text-gray-500 text-xs ml-1">(可选，多选)</span>
                </label>
                <input
                  ref={scriptUploadRef}
                  type="file"
                  accept=".sh,.py,.js,.ts"
                  onChange={handleScriptUpload}
                  className="hidden"
                />
                <button
                  onClick={() => scriptUploadRef.current?.click()}
                  disabled={uploadingScript}
                  className="w-full mb-3 p-2 border-2 border-dashed border-blue-300 rounded-md hover:border-blue-500 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 text-blue-600 disabled:opacity-50"
                >
                  {uploadingScript ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-sm">上传中...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={16} />
                      <span className="text-sm">上传自定义脚本 (.sh, .py, .js, .ts)</span>
                    </>
                  )}
                </button>
                {loadingResources ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={20} className="animate-spin text-blue-600" />
                  </div>
                ) : availableScripts.length === 0 ? (
                  <div className="text-center py-4 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md">
                    暂无可用脚本，请上传自定义脚本
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {availableScripts.map((script) => (
                      <div
                        key={script}
                        onClick={() => toggleScript(script)}
                        className={`p-2 rounded border cursor-pointer transition-all ${
                          formData.selectedScripts.includes(script)
                            ? 'bg-blue-50 border-blue-500'
                            : 'bg-white border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">{script}</span>
                          {formData.selectedScripts.includes(script) && (
                            <CheckCircle2 size={14} className="text-blue-600" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {currentStep === 'configure' && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm text-green-800">
                  已选择 Agent：<span className="font-medium">{formData.agentName}</span>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  任务名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="输入任务名称"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  上传文件 <span className="text-gray-500 text-xs ml-1">(可选，最大 100MB)</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {selectedFile ? (
                  <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-md">
                    <File size={16} className="text-gray-600" />
                    <span className="text-sm text-gray-700 flex-1 truncate">{selectedFile.name}</span>
                    <span className="text-xs text-gray-500">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                    <button
                      onClick={handleRemoveFile}
                      className="p-1 text-red-600 hover:text-red-800 rounded"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full p-3 border-2 border-dashed border-gray-300 rounded-md hover:border-blue-500 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 text-gray-600"
                  >
                    <Upload size={16} />
                    <span className="text-sm">点击上传文件</span>
                  </button>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  备注说明 <span className="text-gray-500 text-xs ml-1">(可选)</span>
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="添加任务备注..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={handlePrevious}
            disabled={currentStep === 'select'}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft size={16} />
            上一步
          </button>

          {currentStep === 'select' || currentStep === 'resources' ? (
            <button
              onClick={handleNext}
              disabled={currentStep === 'select' && !formData.agentId}
              className="flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !formData.name.trim()}
              className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              创建任务
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}