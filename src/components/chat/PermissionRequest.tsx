'use client';

import { Shield, Check, X, Loader2, Terminal, FileText, FolderOpen, Search, Edit, Wrench } from 'lucide-react';

interface PermissionRequestProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  onApprove: () => void;
  onReject: () => void;
  isPending?: boolean;
  className?: string;
}

// 工具图标映射
const getToolIcon = (toolName: string) => {
  const name = toolName.toLowerCase();
  if (name.includes('bash') || name.includes('shell')) return Terminal;
  if (name.includes('read')) return FileText;
  if (name.includes('write') || name.includes('edit')) return Edit;
  if (name.includes('glob') || name.includes('ls')) return FolderOpen;
  if (name.includes('grep') || name.includes('search')) return Search;
  return Wrench;
};

export function PermissionRequest({
  toolName,
  toolInput,
  onApprove,
  onReject,
  isPending = false,
  className = '',
}: PermissionRequestProps) {
  const Icon = getToolIcon(toolName);

  return (
    <div
      className={`bg-amber-50 border border-amber-200 rounded-lg ${className}`}
    >
      {/* 头部 */}
      <div className="flex items-center space-x-2 px-3 py-2 border-b border-amber-200">
        <Shield size={16} className="text-amber-600" />
        <span className="text-sm font-medium text-amber-800">权限请求</span>
      </div>

      {/* 内容 */}
      <div className="px-3 py-3">
        <p className="text-sm text-gray-700 mb-3">
          Claude 请求使用 <span className="font-semibold text-gray-900">{toolName}</span> 工具
        </p>

        {/* 工具信息 */}
        <div className="flex items-center space-x-2 mb-3 p-2 bg-white rounded border border-gray-200">
          <Icon size={14} className="text-gray-500" />
          <span className="text-xs font-mono text-gray-600">{toolName}</span>
        </div>

        {/* 参数预览 */}
        {Object.keys(toolInput).length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">参数预览:</p>
            <pre className="text-xs font-mono text-gray-700 bg-white p-2 rounded border border-gray-200 overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(toolInput, null, 2)}
            </pre>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center space-x-2">
          <button
            onClick={onApprove}
            disabled={isPending}
            className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            <span className="text-sm font-medium">批准</span>
          </button>
          <button
            onClick={onReject}
            disabled={isPending}
            className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <X size={14} />
            <span className="text-sm font-medium">拒绝</span>
          </button>
        </div>
      </div>
    </div>
  );
}
