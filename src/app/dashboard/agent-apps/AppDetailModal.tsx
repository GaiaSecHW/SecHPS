'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Upload, File, Loader2, Save } from 'lucide-react';
import toast from 'react-hot-toast';

interface AgentApp {
  id: string;
  name: string;
  engine: string;
  defaultAgentName: string;
  startCommand?: string | null;
  inputRequirements?: string | null;
  isPublic: boolean;
  tenantId?: string | null;
  createdAt: string;
  updatedAt: string;
}

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

interface Props {
  isOpen: boolean;
  onClose: () => void;
  app: AgentApp | null;
  onUpdate: (appId: string, formData: FormData, agentHarnessFile?: AgentHarnessFileData, isPublic?: boolean) => Promise<void>;
}

export default function AppDetailModal({ isOpen, onClose, app, onUpdate }: Props) {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    engine: '',
    defaultAgentName: '',
    startCommand: '',
    inputRequirements: '',
    tenantId: '',
  });
  const [agentHarnessFile, setAgentHarnessFile] = useState<AgentHarnessFileData | null>(null);
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

  useEffect(() => {
    if (app && isOpen) {
      setFormData({
        name: app.name,
        engine: app.engine as any,
        defaultAgentName: app.defaultAgentName || '',
        startCommand: app.startCommand || '',
        inputRequirements: app.inputRequirements || '',
        tenantId: app.isPublic ? '__public__' : (app.tenantId || ''),
      });
      setAgentHarnessFile(null);
    }
  }, [app, isOpen]);

  if (!isOpen || !app) return null;

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error('请输入Agent名称');
      return;
    }
    if (!formData.engine) {
      toast.error('请选择使用引擎');
      return;
    }
    

    setIsSubmitting(true);
    try {
      const isPublic = formData.tenantId === '__public__';
      await onUpdate(app.id, formData, agentHarnessFile || undefined, isPublic);
      toast.success('Agent更新成功');
      handleClose();
    } catch (error: any) {
      toast.error(error.message || '更新失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFormData({ name: '', engine: '', defaultAgentName: '', startCommand: '', inputRequirements: '', tenantId: '' });
    setAgentHarnessFile(null);
    onClose();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const firstFile = files[0];
      if (firstFile.webkitRelativePath) {
        setAgentHarnessFile({
          type: 'folder',
          name: firstFile.webkitRelativePath.split('/')[0],
          files: Array.from(files),
        });
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
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-dark-surface rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-gray-100">Agent详情</h2>
          {!isSubmitting && (
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-400 rounded-full">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="px-6 py-4 space-y-5 overflow-y-auto">
          <div className="text-sm text-gray-500 space-y-1 mb-4">
            <p>创建时间: {new Date(app.createdAt).toLocaleString('zh-CN')}</p>
            <p>更新时间: {new Date(app.updatedAt).toLocaleString('zh-CN')}</p>
            <p>AgentID: {app.id}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Agent名称 <span className="text-red-500">*</span>
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
              onChange={(e) => setFormData({ ...formData, engine: e.target.value as any })}
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
                租户
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
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">AgentHarness 文件更新（可选）</label>
            {!agentHarnessFile ? (
              <div>
                <div
                  className="border border-gray-700/50 rounded-md p-3 hover:border-primary-500 cursor-pointer bg-dark-bg"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="flex items-center justify-center gap-2 text-gray-500">
                    <Upload size={16} />
                    <span className="text-sm">点击上传新的压缩包或文件夹</span>
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
            <label className="block text-sm font-medium text-gray-300 mb-2">
              默认Agent名称
            </label>
            <input
              type="text"
              value={formData.defaultAgentName}
              onChange={(e) => setFormData({ ...formData, defaultAgentName: e.target.value })}
              placeholder="例如: code-assistant"
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              启动命令
            </label>
            <input
              type="text"
              value={formData.startCommand}
              onChange={(e) => setFormData({ ...formData, startCommand: e.target.value })}
              placeholder="例如: opencode run skill.md"
              className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            />
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

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700/50 bg-dark-bg">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-dark-surface border border-gray-600 rounded-md hover:bg-dark-bg disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {isSubmitting ? '更新中...' : '更新'}
          </button>
        </div>
      </div>
    </div>
  );
}
