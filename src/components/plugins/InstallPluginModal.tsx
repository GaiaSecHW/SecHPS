'use client';

import { useState, useRef } from 'react';
import {
  X,
  Upload,
  Link,
  Package,
  Loader2,
  AlertCircle,
  Check,
  FileArchive,
} from 'lucide-react';

interface InstallPluginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type InstallMethod = 'upload' | 'url';

interface FormData {
  method: InstallMethod;
  url: string;
}

export default function InstallPluginModal({
  isOpen,
  onClose,
  onSuccess,
}: InstallPluginModalProps) {
  const [formData, setFormData] = useState<FormData>({
    method: 'upload',
    url: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // 验证文件类型
      const validTypes = ['.zip', '.tar.gz', '.tgz'];
      const fileName = selectedFile.name.toLowerCase();
      const isValid = validTypes.some(ext => fileName.endsWith(ext));
      
      if (!isValid) {
        setError('请上传 .zip、.tar.gz 或 .tgz 格式的压缩文件');
        return;
      }
      
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      const validTypes = ['.zip', '.tar.gz', '.tgz'];
      const fileName = droppedFile.name.toLowerCase();
      const isValid = validTypes.some(ext => fileName.endsWith(ext));
      
      if (!isValid) {
        setError('请上传 .zip、.tar.gz 或 .tgz 格式的压缩文件');
        return;
      }
      
      setFile(droppedFile);
      setError(null);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('请先登录');
      }

      let response: Response;

      if (formData.method === 'upload') {
        // 上传压缩文件安装
        if (!file) {
          throw new Error('请选择要上传的插件压缩文件');
        }

        const formDataObj = new FormData();
        formDataObj.append('file', file);

        response = await fetch('/api/plugins/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formDataObj,
        });
      } else {
        // 从 URL 安装
        if (!formData.url) {
          throw new Error('请输入插件 URL');
        }

        response = await fetch('/api/plugins/install', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ url: formData.url }),
        });
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '安装失败');
      }

      setSuccess(true);
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-dark-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
            <Package className="h-5 w-5" />
            安装插件
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* 安装方式选择 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              安装方式
            </label>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, method: 'upload' })}
                className={`flex-1 px-4 py-3 border rounded-lg flex items-center justify-center gap-2 transition-colors ${
                  formData.method === 'upload'
                    ? 'border-blue-500 bg-primary-600/15 text-blue-700'
                    : 'border-gray-600 hover:bg-dark-surface-hover'
                }`}
              >
                <Upload className="h-4 w-4" />
                上传压缩文件
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, method: 'url' })}
                className={`flex-1 px-4 py-3 border rounded-lg flex items-center justify-center gap-2 transition-colors ${
                  formData.method === 'url'
                    ? 'border-blue-500 bg-primary-600/15 text-blue-700'
                    : 'border-gray-600 hover:bg-dark-surface-hover'
                }`}
              >
                <Link className="h-4 w-4" />
                从 URL 安装
              </button>
            </div>
          </div>

          {/* 上传文件表单 */}
          {formData.method === 'upload' && (
            <div className="space-y-4">
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  file ? 'border-green-300 bg-green-50' : 'border-gray-600 hover:border-gray-400'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,.tar.gz,.tgz"
                  onChange={handleFileChange}
                  className="hidden"
                  id="plugin-file-upload"
                />
                
                {file ? (
                  <div className="space-y-3">
                    <FileArchive className="h-12 w-12 text-green-500 mx-auto" />
                    <div>
                      <p className="text-sm font-medium text-gray-100">{file.name}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }}
                      className="text-sm text-red-400 hover:text-red-400"
                    >
                      移除文件
                    </button>
                  </div>
                ) : (
                  <label
                    htmlFor="plugin-file-upload"
                    className="cursor-pointer"
                  >
                    <Upload className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-sm text-gray-600 mb-1">
                      拖拽文件到此处，或点击选择文件
                    </p>
                    <p className="text-xs text-gray-500">
                      支持 .zip、.tar.gz、.tgz 格式
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      压缩包根目录必须包含 manifest.json 文件
                    </p>
                  </label>
                )}
              </div>

              <div className="bg-[#0F172A] rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">压缩包结构要求</h4>
                <ul className="text-xs text-gray-600 space-y-1">
                  <li>• 根目录必须包含 <code className="bg-gray-700 px-1 rounded">manifest.json</code> 文件</li>
                  <li>• manifest.json 必须包含 name、displayName、version 字段</li>
                  <li>• 可选包含 index.js 或其他插件代码文件</li>
                </ul>
              </div>
            </div>
          )}

          {/* URL 安装表单 */}
          {formData.method === 'url' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                插件 URL *
              </label>
              <input
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://example.com/plugins/my-plugin/manifest.json"
                className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                插件 manifest.json 文件的 URL，或包含 manifest.json 的压缩包 URL
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-4 bg-red-900/20 border border-red-500/20 text-red-400 px-4 py-3 rounded-md flex items-center gap-2">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="mt-4 bg-green-900/20 border border-green-500/20 text-green-400 px-4 py-3 rounded-md flex items-center gap-2">
              <Check className="h-5 w-5 flex-shrink-0" />
              插件安装成功！
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700/50 bg-[#0F172A]">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-dark-surface border border-gray-600 rounded-md hover:bg-dark-surface-hover transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || (formData.method === 'upload' && !file)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                安装中...
              </>
            ) : (
              <>
                <Package className="h-4 w-4" />
                安装
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
