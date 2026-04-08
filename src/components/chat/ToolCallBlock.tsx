'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  Terminal,
  FileText,
  FolderOpen,
  Search,
  Edit,
  Globe,
  Database,
  Code,
  Wrench,
} from 'lucide-react';

interface ToolCallBlockProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult?: unknown;
  status: 'pending' | 'running' | 'success' | 'error';
  isExpanded?: boolean;
  errorMessage?: string;
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
  if (name.includes('fetch') || name.includes('web')) return Globe;
  if (name.includes('lsp') || name.includes('code')) return Code;
  if (name.includes('sql') || name.includes('db')) return Database;
  return Wrench;
};

// 状态配置
const statusConfig = {
  pending: {
    icon: Play,
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    label: '等待中',
  },
  running: {
    icon: Loader2,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    label: '运行中',
  },
  success: {
    icon: CheckCircle,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    label: '成功',
  },
  error: {
    icon: XCircle,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    label: '失败',
  },
};

export function ToolCallBlock({
  toolName,
  toolInput,
  toolResult,
  status,
  isExpanded = false,
  errorMessage,
  className = '',
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(isExpanded);
  const [showInput, setShowInput] = useState(false);
  const [showResult, setShowResult] = useState(false);

  const config = statusConfig[status];
  const Icon = getToolIcon(toolName);
  const StatusIcon = config.icon;

  return (
    <div
      className={`rounded-lg border ${config.borderColor} ${config.bgColor} ${className}`}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center space-x-2">
          <Icon size={16} className="text-gray-600" />
          <span className="text-sm font-medium text-gray-900">{toolName}</span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.color}`}
          >
            {status === 'running' ? (
              <StatusIcon size={12} className="animate-spin mr-1" />
            ) : (
              <StatusIcon size={12} className="mr-1" />
            )}
            {config.label}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-gray-200 bg-white">
          {/* 输入参数 */}
          <div className="border-b border-gray-100">
            <button
              onClick={() => setShowInput(!showInput)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors"
            >
              <span className="text-xs font-medium text-gray-600">输入参数</span>
              {showInput ? (
                <ChevronUp size={14} className="text-gray-400" />
              ) : (
                <ChevronDown size={14} className="text-gray-400" />
              )}
            </button>
            {showInput && (
              <div className="px-3 py-2 bg-gray-50">
                <pre className="text-xs font-mono text-gray-800 whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(toolInput, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* 执行结果 */}
          {(toolResult !== undefined || errorMessage) && (
            <div>
              <button
                onClick={() => setShowResult(!showResult)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors"
              >
                <span className="text-xs font-medium text-gray-600">
                  {status === 'error' ? '错误信息' : '执行结果'}
                </span>
                {showResult ? (
                  <ChevronUp size={14} className="text-gray-400" />
                ) : (
                  <ChevronDown size={14} className="text-gray-400" />
                )}
              </button>
              {showResult && (
                <div className="px-3 py-2 bg-gray-50">
                  {errorMessage ? (
                    <p className="text-xs text-red-600 whitespace-pre-wrap">
                      {errorMessage}
                    </p>
                  ) : (
                    <pre className="text-xs font-mono text-gray-800 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
                      {typeof toolResult === 'string'
                        ? toolResult
                        : JSON.stringify(toolResult, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
