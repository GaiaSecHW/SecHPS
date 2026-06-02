'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Upload, File, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import JSZip from 'jszip';

interface Tenant {
  id: string;
  name: string;
}

interface FormData {
  name: string;
  engine: 'opencode' | 'claudecode' | 'agentflow' | '';
  defaultAgentName: string;
  startCommand?: string;
  inputRequirements?: string;
  requireCodedmap?: boolean;
  tenantId: string;
}

interface AgentHarnessFileData {
  type: 'folder' | 'archive';
  name: string;
  files?: File[];
  file?: File;
  size?: number;
}

interface ClaudeCodeInfo {
  agents: string[];
  commands: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData, agentHarnessFile: AgentHarnessFileData, isPublic: boolean) => Promise<void>;
}

export default function CreateAgentAppModal({ isOpen, onClose, onSubmit }: Props) {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    engine: '',
    defaultAgentName: '',
    startCommand: '',
    tenantId: '',
  });
  const [agentHarnessFile, setAgentHarnessFile] = useState<AgentHarnessFileData | null>(null);
  const [claudeCodeInfo, setClaudeCodeInfo] = useState<ClaudeCodeInfo | null>(null);
  const [requireCodedmap, setRequireCodedmap] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isIcsOrAdmin, setIsIcsOrAdmin] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const roles = Array.isArray(payload.roles) ? payload.roles : [];
        const admin =
          payload.isIcsTenant === true ||
          payload.isPlatformAdmin === true ||
          (payload.tenantId == null && roles.includes('admin'));
        setIsIcsOrAdmin(admin);

        if (admin) {
          fetch('/api/admin/tenants', {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then(res => res.json())
            .then(data => setTenants(data.tenants ?? []))
            .catch(() => {});
        }
      } catch {
        setIsIcsOrAdmin(false);
      }
    }
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error('请输入Agent名称');
      return;
    }
    if (!formData.engine) {
      toast.error('请选择使用引擎');
      return;
    }
    if (!agentHarnessFile) {
      toast.error('请上传 AgentHarness 文件');
      return;
    }
    if (isIcsOrAdmin && !formData.tenantId) {
      toast.error('请选择租户');
      return;
    }

    setIsSubmitting(true);
    try {
      const isPublic = formData.tenantId === '__public__';
      await onSubmit({ ...formData, requireCodedmap }, agentHarnessFile, isPublic);
      toast.success('Agent创建成功');
      handleClose();
    } catch (error: any) {
      toast.error(error.message || '创建失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFormData({ name: '', engine: '', defaultAgentName: '', startCommand: '', inputRequirements: '', tenantId: '' });
    setAgentHarnessFile(null);
    setClaudeCodeInfo(null);
    setRequireCodedmap(false);
    onClose();
  };

  const extractAgentNameFromFolder = async (files: File[], engine: string): Promise<string | null> => {
    try {
      if (engine === 'opencode') {
        const openCodeFile = files.find(f => /(?:^|\/)opencode\.json$/i.test(f.webkitRelativePath || f.name));
        if (openCodeFile) {
          const content = await openCodeFile.text();
          const config = JSON.parse(content.replace(/^﻿/, ''));
          if (config.default_agent) return config.default_agent;
        }
      }

      if (engine === 'claudecode') {
        const agentFile = files.find(f => {
          const normalized = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
          return /(?:^|\/)\.claude\/agents\/([^/]+)\.md$/i.test(normalized);
        });
        if (agentFile) {
          const normalized = (agentFile.webkitRelativePath || agentFile.name).replace(/\\/g, '/');
          const match = normalized.match(/(?:^|\/)\.claude\/agents\/([^/]+)\.md$/i);
          if (match) return match[1];
        }
      }

      return null;
    } catch (err) {
      console.error('[AutoDetect] extractAgentNameFromFolder error:', err);
      return null;
    }
  };

  const extractAgentNameFromZip = async (file: File, engine: string): Promise<string | null> => {
    try {
      console.log('[AutoDetect] extractAgentNameFromZip called:', { fileName: file.name, engine, fileSize: file.size });
      const zip = await JSZip.loadAsync(file);
      console.log('[AutoDetect] JSZip loaded, files:', Object.keys(zip.files));

      if (engine === 'opencode') {
        const matched = zip.file(/(?:^|\/)opencode\.json$/i)[0];
        if (matched) {
          const content = await matched.async('string');
          const config = JSON.parse(content.replace(/^﻿/, ''));
          if (config.default_agent) return config.default_agent;
        }
      }

      if (engine === 'claudecode') {
        // 从 .claude/agents/*.md 文件名提取
        for (const [path, entry] of Object.entries(zip.files)) {
          if (entry.dir) continue;
          const normalized = path.replace(/\\/g, '/');
          const agentMatch = normalized.match(/(?:^|\/)\.claude\/agents\/([^/]+)\.md$/i);
          if (agentMatch) return agentMatch[1];
        }
      }

      return null;
    } catch (err) {
      console.error('[AutoDetect] extractAgentNameFromZip error:', err);
      return null;
    }
  };

  const detectClaudeCodeFromFolder = (files: File[]): ClaudeCodeInfo => {
    const agents: string[] = [];
    const commands: string[] = [];
    for (const f of files) {
      const normalized = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
      const agentMatch = normalized.match(/(?:^|\/)\.claude\/agents\/([^/]+)\.md$/i);
      if (agentMatch && !agents.includes(agentMatch[1])) agents.push(agentMatch[1]);
      const cmdMatch = normalized.match(/(?:^|\/)\.claude\/commands\/([^/]+)\.md$/i);
      if (cmdMatch && !commands.includes(cmdMatch[1])) commands.push(cmdMatch[1]);
    }
    return { agents, commands };
  };

  const detectClaudeCodeFromZip = async (file: File): Promise<ClaudeCodeInfo> => {
    const zip = await JSZip.loadAsync(file);
    const agents: string[] = [];
    const commands: string[] = [];
    for (const [p, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const normalized = p.replace(/\\/g, '/');
      const agentMatch = normalized.match(/(?:^|\/)\.claude\/agents\/([^/]+)\.md$/i);
      if (agentMatch && !agents.includes(agentMatch[1])) agents.push(agentMatch[1]);
      const cmdMatch = normalized.match(/(?:^|\/)\.claude\/commands\/([^/]+)\.md$/i);
      if (cmdMatch && !commands.includes(cmdMatch[1])) commands.push(cmdMatch[1]);
    }
    return { agents, commands };
  };

  const applyClaudeCodeDetection = (info: ClaudeCodeInfo) => {
    setClaudeCodeInfo(info);
    if (info.agents.length > 0 || info.commands.length > 0) {
      setFormData(prev => ({
        ...prev,
        defaultAgentName: prev.defaultAgentName.trim()
          ? prev.defaultAgentName
          : info.agents[0] || '',
        startCommand: prev.startCommand?.trim()
          ? prev.startCommand
          : info.commands.length > 0
            ? `/project:${info.commands[0]}`
            : info.agents.length > 0
              ? `/project:${info.agents[0]}`
              : prev.startCommand || '',
      }));
      if (info.commands.length > 0) {
        toast.success(`检测到 ${info.agents.length} 个Agent, ${info.commands.length} 个命令`, { duration: 3000 });
      } else if (info.agents.length > 0) {
        toast.success(`检测到 ${info.agents.length} 个Agent`, { duration: 3000 });
      }
    }
  };

  const tryAutoFillAgentName = async (file: File, engine: string) => {
    console.log('[AutoDetect] tryAutoFillAgentName called:', { fileName: file.name, engine });
    if (!engine || !file.name.match(/\.zip$/)) {
      console.log('[AutoDetect] skipped:', { hasEngine: !!engine, isZip: !!file.name.match(/\.zip$/) });
      return;
    }
    if (engine === 'claudecode') {
      const info = await detectClaudeCodeFromZip(file);
      applyClaudeCodeDetection(info);
      return;
    }
    const agentName = await extractAgentNameFromZip(file, engine);
    console.log('[AutoDetect] detected agent name:', agentName);
    if (agentName) {
      setFormData(prev => ({
        ...prev,
        defaultAgentName: prev.defaultAgentName.trim() ? prev.defaultAgentName : agentName,
        startCommand: prev.startCommand?.trim() ? prev.startCommand : `/${agentName}`,
      }));
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const firstFile = files[0];
      if (firstFile.webkitRelativePath) {
        const allFiles = Array.from(files);
        setAgentHarnessFile({
          type: 'folder',
          name: firstFile.webkitRelativePath.split('/')[0],
          files: allFiles,
        });

        if (formData.engine) {
          if (formData.engine === 'claudecode') {
            const info = detectClaudeCodeFromFolder(allFiles);
            applyClaudeCodeDetection(info);
          } else {
            const agentName = await extractAgentNameFromFolder(allFiles, formData.engine);
            if (agentName) {
              setFormData(prev => ({
                ...prev,
                defaultAgentName: prev.defaultAgentName.trim() ? prev.defaultAgentName : agentName,
                startCommand: prev.startCommand?.trim() ? prev.startCommand : `/${agentName}`,
              }));
            }
          }
        }
      } else {
        if (!firstFile.name.match(/\.(zip|7z|tar|tar\.gz|tgz)$/i)) {
          toast.error('请上传 ZIP、TAR、TAR.GZ、TGZ、7Z 压缩包或文件夹；暂不支持 RAR');
          return;
        }
        setAgentHarnessFile({
          type: 'archive',
          name: firstFile.name,
          file: firstFile,
          size: firstFile.size,
        });

        if (firstFile.name.match(/\.zip$/) && formData.engine) {
          await tryAutoFillAgentName(firstFile, formData.engine);
        }
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-surface rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
          <h2 className="text-base font-semibold text-gray-100">创建新Agent</h2>
          {!isSubmitting && (
            <button onClick={handleClose} className="h-7 px-2 rounded-md text-gray-400 hover:text-gray-300 hover:bg-gray-700/30">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="px-4 py-3 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Agent名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              使用引擎 <span className="text-red-400">*</span>
            </label>
            <select
              value={formData.engine}
              onChange={async (e) => {
                const newEngine = e.target.value as any;
                setFormData({ ...formData, engine: newEngine });
                setClaudeCodeInfo(null);
                if (!newEngine) return;
                if (agentHarnessFile?.type === 'archive' && agentHarnessFile.file) {
                  tryAutoFillAgentName(agentHarnessFile.file, newEngine);
                } else if (agentHarnessFile?.type === 'folder' && agentHarnessFile.files) {
                  if (newEngine === 'claudecode') {
                    const info = detectClaudeCodeFromFolder(agentHarnessFile.files);
                    applyClaudeCodeDetection(info);
                  } else {
                    const agentName = await extractAgentNameFromFolder(agentHarnessFile.files, newEngine);
                    if (agentName) {
                      setFormData(prev => ({
                        ...prev,
                        defaultAgentName: prev.defaultAgentName.trim() ? prev.defaultAgentName : agentName,
                        startCommand: prev.startCommand?.trim() ? prev.startCommand : `/${agentName}`,
                      }));
                    }
                  }
                }
              }}
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            >
              <option value="">请选择引擎</option>
              <option value="opencode">opencode</option>
              <option value="claudecode">claudecode</option>
              <option value="agentflow">AgentFlow</option>
            </select>
          </div>

          {isIcsOrAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                租户 <span className="text-red-400">*</span>
              </label>
              <select
                value={formData.tenantId}
                onChange={(e) => setFormData({ ...formData, tenantId: e.target.value })}
className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            >
              <option value="">请选择租户</option>
                <option value="__public__">所有租户共享（公开）</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">选择"所有租户共享"则不绑定任何租户</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              AgentHarness 文件上传 <span className="text-red-400">*</span>
            </label>
            {!agentHarnessFile ? (
              <div>
                <div
                  className="border border-gray-700/50 rounded-md p-3 hover:border-primary-500 cursor-pointer bg-dark-bg"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="flex items-center justify-center gap-2 text-gray-500">
                    <Upload size={16} />
                    <span className="text-sm">点击上传压缩包或文件夹</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,.7z,.tar,.tar.gz,.tgz"
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            ) : (
              <div className="border border-gray-700/50 rounded-md px-3 py-2 flex items-center justify-between bg-dark-bg">
                <div className="flex items-center gap-2">
                  <File size={16} className="text-primary-400" />
                  <div>
                    <span className="text-sm text-gray-200">
                      {agentHarnessFile.type === 'folder' ? `📁 ${agentHarnessFile.name}` : agentHarnessFile.name}
                    </span>
                    <span className="text-xs text-gray-500 ml-1.5">
                      {agentHarnessFile.type === 'folder'
                        ? `${agentHarnessFile.files?.length || 0} 个文件`
                        : `${((agentHarnessFile.size || 0) / 1024).toFixed(1)} KB`
                      }
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAgentHarnessFile(null)}
                  className="h-7 px-2 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/15"
                  disabled={isSubmitting}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              默认Agent名称 <span className="text-xs text-green-500">(自动识别)</span>
            </label>
            <input
              type="text"
              value={formData.defaultAgentName}
              onChange={(e) => setFormData({ ...formData, defaultAgentName: e.target.value })}
              placeholder="例如: code-assistant"
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            />
            {formData.engine === 'claudecode' && claudeCodeInfo && claudeCodeInfo.agents.length > 1 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {claudeCodeInfo.agents.map(a => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, defaultAgentName: a }))}
                    className={`h-6 px-2 rounded-full text-xs transition-colors ${
                      formData.defaultAgentName === a
                        ? 'bg-primary-500/15 text-primary-400 border border-primary-500/50'
                        : 'text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">启动命令</label>
            <input
              type="text"
              value={formData.startCommand}
              onChange={(e) => setFormData({ ...formData, startCommand: e.target.value })}
              placeholder="例如: /nazhua-audit"
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            />
            {formData.engine === 'claudecode' && claudeCodeInfo && claudeCodeInfo.commands.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {claudeCodeInfo.commands.map(cmd => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, startCommand: `/project:${cmd}` }))}
                    className={`h-6 px-2 rounded-full text-xs transition-colors ${
                      formData.startCommand === `/project:${cmd}`
                        ? 'bg-primary-500/15 text-primary-400 border border-primary-500/50'
                        : 'text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    /project:{cmd}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">文件结构要求</label>
            <textarea
              value={formData.inputRequirements}
              onChange={(e) => setFormData({ ...formData, inputRequirements: e.target.value })}
              placeholder="描述上传文件的内容结构要求"
              rows={2}
              className="w-full px-3 py-2 bg-dark-bg border border-gray-700/50 rounded-md text-sm text-gray-200 placeholder:text-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              disabled={isSubmitting}
            />
          </div>

          <div className="flex items-center justify-between py-1">
            <div>
              <span className="text-sm font-medium text-gray-300">需要知识图谱</span>
              <p className="text-xs text-gray-500">启用后，使用此 Agent 的任务会自动加载知识图谱</p>
            </div>
            <button
              type="button"
              onClick={() => setRequireCodedmap(!requireCodedmap)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${requireCodedmap ? 'bg-primary-500' : 'bg-gray-600'}`}
              disabled={isSubmitting}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${requireCodedmap ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-700/50 bg-dark-bg">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="h-[38px] px-3 rounded-md text-sm font-medium text-gray-400 bg-dark-surface hover:bg-gray-700/50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="h-[38px] px-3 rounded-md text-sm font-medium bg-primary-500 text-white hover:bg-primary-400 disabled:opacity-50 flex items-center gap-1.5"
          >
            {isSubmitting && <Loader2 size={14} className="animate-spin" />}
            {isSubmitting ? '创建中...' : '创建Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
