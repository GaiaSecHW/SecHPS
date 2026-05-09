'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Upload, File, Loader2, Save } from 'lucide-react';
import toast from 'react-hot-toast';

interface AgentApp {
  id: string;
  name: string;
  engine: string;
  startCommand: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  name: string;
  engine: 'opencode' | 'claudecode' | '';
  startCommand: string;
  notes: string;
}

interface SkillFileData {
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
  onUpdate: (appId: string, formData: FormData, skillFile?: SkillFileData) => Promise<void>;
}

export default function AppDetailModal({ isOpen, onClose, app, onUpdate }: Props) {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    engine: '',
    startCommand: '',
    notes: '',
  });
  const [skillFile, setSkillFile] = useState<SkillFileData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (app && isOpen) {
      setFormData({
        name: app.name,
        engine: app.engine as any,
        startCommand: app.startCommand,
        notes: app.notes || '',
      });
      setSkillFile(null);
    }
  }, [app, isOpen]);

  if (!isOpen || !app) return null;

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error('请输入应用名称');
      return;
    }
    if (!formData.engine) {
      toast.error('请选择使用引擎');
      return;
    }
    if (!formData.startCommand.trim()) {
      toast.error('请输入启动命令');
      return;
    }

    setIsSubmitting(true);
    try {
      await onUpdate(app.id, formData, skillFile || undefined);
      toast.success('应用更新成功');
      handleClose();
    } catch (error: any) {
      toast.error(error.message || '更新失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFormData({ name: '', engine: '', startCommand: '', notes: '' });
    setSkillFile(null);
    onClose();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const firstFile = files[0];
      if (firstFile.webkitRelativePath) {
        setSkillFile({
          type: 'folder',
          name: firstFile.webkitRelativePath.split('/')[0],
          files: Array.from(files),
        });
      } else {
        if (!firstFile.name.match(/\.(zip|rar|7z|tar\.gz)$/)) {
          toast.error('请上传压缩包（zip/rar/7z/tar.gz）或文件夹');
          return;
        }
        setSkillFile({
          type: 'archive',
          name: firstFile.name,
          file: firstFile,
          size: firstFile.size,
        });
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">应用详情</h2>
          {!isSubmitting && (
            <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-full">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="px-6 py-4 space-y-5 overflow-y-auto">
          <div className="text-sm text-gray-500 space-y-1 mb-4">
            <p>创建时间: {new Date(app.createdAt).toLocaleString('zh-CN')}</p>
            <p>更新时间: {new Date(app.updatedAt).toLocaleString('zh-CN')}</p>
            <p>应用ID: {app.id}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              应用名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              使用引擎 <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.engine}
              onChange={(e) => setFormData({ ...formData, engine: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            >
              <option value="">请选择引擎</option>
              <option value="opencode">opencode</option>
              <option value="claudecode">claudecode</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Skill 文件更新（可选）</label>
            {!skillFile ? (
              <div>
                <div
                  className="border-2 border-dashed border-gray-300 rounded-md p-4 hover:border-primary-500 cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="flex flex-col items-center justify-center text-gray-500">
                    <Upload size={20} className="mb-2" />
                    <p className="text-sm">点击上传新的压缩包或文件夹</p>
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
              <div className="border border-gray-300 rounded-md p-3 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <File size={18} className="text-primary-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {skillFile.type === 'folder' ? `📁 ${skillFile.name}` : skillFile.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {skillFile.type === 'folder' 
                        ? `${skillFile.files?.length || 0} 个文件`
                        : `${((skillFile.size || 0) / 1024).toFixed(2)} KB`
                      }
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSkillFile(null)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  disabled={isSubmitting}
                >
                  <X size={18} />
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              启动命令 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.startCommand}
              onChange={(e) => setFormData({ ...formData, startCommand: e.target.value })}
              placeholder="例如: opencode run skill.md"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">备注说明</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              disabled={isSubmitting}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
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