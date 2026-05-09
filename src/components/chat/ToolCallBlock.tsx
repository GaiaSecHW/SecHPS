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
    color: 'text-gray-400',
    bgColor: 'bg-[#0F172A]',
    borderColor: 'border-gray-700/50',
    label: '等待中',
  },
  running: {
    icon: Loader2,
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/20',
    borderColor: 'border-blue-500/30',
    label: '运行中',
  },
  success: {
    icon: CheckCircle,
    color: 'text-green-400',
    bgColor: 'bg-green-900/20',
    borderColor: 'border-green-500/30',
    label: '成功',
  },
  error: {
    icon: XCircle,
    color: 'text-red-400',
    bgColor: 'bg-red-900/20',
    borderColor: 'border-red-500/30',
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
          <Icon size={16} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-100">{toolName}</span>
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
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-gray-700/50 bg-[#0F172A]">
          {/* 输入参数 */}
          <div className="border-b border-gray-700/50">
            <button
              onClick={() => setShowInput(!showInput)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-dark-surface-hover transition-colors"
            >
              <span className="text-xs font-medium text-gray-400">输入参数</span>
              {showInput ? (
                <ChevronUp size={14} className="text-gray-500" />
              ) : (
                <ChevronDown size={14} className="text-gray-500" />
              )}
            </button>
            {showInput && (
              <div className="px-3 py-2 bg-dark-surface">
                <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap overflow-x-auto">
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
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-dark-surface-hover transition-colors"
              >
                <span className="text-xs font-medium text-gray-400">
                  {status === 'error' ? '错误信息' : '执行结果'}
                </span>
                {showResult ? (
                  <ChevronUp size={14} className="text-gray-500" />
                ) : (
                  <ChevronDown size={14} className="text-gray-500" />
                )}
              </button>
              {showResult && (
                <div className="px-3 py-2 bg-dark-surface">
                  {errorMessage ? (
                    <p className="text-xs text-red-400 whitespace-pre-wrap">
                      {errorMessage}
                    </p>
                  ) : (
                    <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
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
