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
      toast.error('请输入应用名称');
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
    if (!formData.defaultAgentName.trim()) {
      toast.error('请输入默认智能体名称');
      return;
    }
    if (isIcsOrAdmin && !formData.tenantId) {
      toast.error('请选择租户');
      return;
    }

    setIsSubmitting(true);
    try {
      const isPublic = formData.tenantId === '__public__';
      await onSubmit(formData, agentHarnessFile, isPublic);
      toast.success('应用创建成功');
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
        toast.success(`检测到 ${info.agents.length} 个智能体, ${info.commands.length} 个命令`, { duration: 3000 });
      } else if (info.agents.length > 0) {
        toast.success(`检测到 ${info.agents.length} 个智能体`, { duration: 3000 });
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
        if (!firstFile.name.match(/\.(zip|rar|7z|tar\.gz)$/)) {
          toast.error('请上传压缩包（zip/rar/7z/tar.gz）或文件夹');
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-surface rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-gray-100">创建新应用</h2>
          { !isSubmitting && (
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-400 rounded-full">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="px-6 py-4 space-y-5 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              应用名称 <span className="text-red-500">*</span>
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
            <label className="block text-sm font-medium text-gray-300 mb-2">
              使用引擎 <span className="text-red-500">*</span>
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
              <label className="block text-sm font-medium text-gray-300 mb-2">
                租户 <span className="text-red-500">*</span>
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
              <p className="mt-1 text-xs text-gray-500">选择"所有租户共享"则不绑定任何租户，所有用户可见</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              AgentHarness 文件上传 <span className="text-red-500">*</span>
            </label>
            {!agentHarnessFile ? (
              <div>
                <div
                  className="border-2 border-dashed border-gray-600 rounded-md p-6 hover:border-primary-500 cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="flex flex-col items-center justify-center text-gray-500">
                    <Upload size={24} className="mb-2" />
                    <p className="text-sm">点击上传压缩包或文件夹</p>
                    <p className="text-xs mt-1">支持 zip/rar/7z/tar.gz 格式</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,.rar,.7z,.tar.gz"
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={isSubmitting}
                  />
                </div>
                <div className="mt-2 flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (fileInputRef.current) {
                        fileInputRef.current.webkitdirectory = true;
                        fileInputRef.current.click();
                      }
                    }}
                    className="text-sm text-primary-600 hover:text-primary-700"
                    disabled={isSubmitting}
                  >
                    或选择文件夹
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-gray-600 rounded-md p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <File size={20} className="text-primary-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-100">
                      {agentHarnessFile.type === 'folder' ? `📁 ${agentHarnessFile.name}` : agentHarnessFile.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {agentHarnessFile.type === 'folder'
                        ? `${agentHarnessFile.files?.length || 0} 个文件`
                        : `${((agentHarnessFile.size || 0) / 1024).toFixed(2)} KB`
                      }
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAgentHarnessFile(null)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  disabled={isSubmitting}
                >
                  <X size={20} />
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              默认智能体名称
              <span className="text-green-500">
                {formData.engine === 'claudecode'
                  ? '(自动识别 .claude/agents/)'
                  : '(自动识别 default_agent)'}
              </span>{' '}
              <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.defaultAgentName}
              onChange={(e) => setFormData({ ...formData, defaultAgentName: e.target.value })}
              placeholder={formData.engine === 'claudecode' ? '例如: security-scanner' : '例如: code-assistant'}
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            />
            {formData.engine === 'claudecode' && claudeCodeInfo && claudeCodeInfo.agents.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {claudeCodeInfo.agents.map(a => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, defaultAgentName: a }))}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                      formData.defaultAgentName === a
                        ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                        : 'border-gray-600 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              启动命令
            </label>
            <input
              type="text"
              value={formData.startCommand}
              onChange={(e) => setFormData({ ...formData, startCommand: e.target.value })}
              placeholder={
                formData.engine === 'claudecode'
                  ? '例如: /project:security-scan'
                  : '例如: /nazhua-audit'
              }
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            />
            {formData.engine === 'claudecode' && claudeCodeInfo && claudeCodeInfo.commands.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <p className="text-xs text-gray-500">检测到命令（点击选择）：</p>
                <div className="flex flex-wrap gap-1.5">
                  {claudeCodeInfo.commands.map(cmd => (
                    <button
                      key={cmd}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, startCommand: `/project:${cmd}` }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        formData.startCommand === `/project:${cmd}`
                          ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                          : 'border-gray-600 text-gray-400 hover:border-primary-500 hover:text-primary-400'
                      }`}
                    >
                      /project:{cmd}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              文件结构要求
            </label>
            <textarea
              value={formData.inputRequirements}
              onChange={(e) => setFormData({ ...formData, inputRequirements: e.target.value })}
              placeholder="描述上传文件的内容结构要求，如：必须包含 pom.xml 和 src 目录，属于 Java/Maven 项目结构"
              rows={3}
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              disabled={isSubmitting}
            />
            <p className="mt-1 text-xs text-gray-500">留空则不校验上传文件的目录结构</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700/50 bg-[#0F172A]">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-dark-surface border border-gray-600 rounded-md hover:bg-[#0F172A] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting && <Loader2 size={16} className="animate-spin" />}
            {isSubmitting ? '创建中...' : '创建应用'}
          </button>
        </div>
      </div>
    </div>
  );
}
