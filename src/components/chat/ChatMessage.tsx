'use client';

import { useState } from 'react';
import { MarkdownRenderer } from '@/components/markdown';
import {
  User,
  Bot,
  Copy,
  Check,
  AlertCircle,
  Code,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { PermissionRequest } from './PermissionRequest';

// 消息内容部分类型
interface MessagePart {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'permission_request';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  toolStatus?: 'pending' | 'running' | 'success' | 'error';
  errorMessage?: string;
  thinking?: string;
}

interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | MessagePart[];
  timestamp?: string;
  isStreaming?: boolean;
  thinking?: string;
  onApprovePermission?: () => void;
  onRejectPermission?: () => void;
  className?: string;
  /** 消息类型，用于显示自定义标题（如 tool_use, tool_result） */
  messageType?: string;
}

export function ChatMessage({
  role,
  content,
  timestamp,
  isStreaming = false,
  thinking,
  onApprovePermission,
  onRejectPermission,
  className = '',
  messageType,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [isContentExpanded, setIsContentExpanded] = useState(false);

  const handleCopy = async () => {
    const textContent = typeof content === 'string'
      ? content
      : content
          .filter((part) => part.type === 'text')
          .map((part) => part.text || '')
          .join('\n');

    await navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isUser = role === 'user';
  const isSystem = role === 'system';
  const isTool = role === 'tool';

  // 检查内容是否为空
  const getTextContent = () => {
    if (typeof content === 'string') {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const textParts = content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n');
      return textParts.trim();
    }
    return '';
  };

  const textContent = getTextContent();
  const hasThinking = thinking && thinking.trim().length > 0;

  // 计算是否是长内容
  const plainText = textContent.replace(/```[\s\S]*?```/g, '[代码块]').replace(/`[^`]+`/g, '[代码]');
  const lines = plainText.split('\n');
  const isLongContent = lines.length > 3;

  // 获取角色图标
  const getRoleIcon = () => {
    if (isUser) return <User size={16} className="text-blue-400" />;
    if (isSystem) return <AlertCircle size={16} className="text-yellow-400" />;
    if (isTool) return <Code size={16} className="text-purple-400" />;
    return <Bot size={16} className="text-green-400" />;
  };

  // 获取角色名称
  const getRoleName = () => {
    if (isUser) return '用户';
    if (isSystem) return '系统';
    // 根据 messageType 显示更具体的标签
    if (isTool) {
      if (messageType === 'tool_use') return '工具调用';
      if (messageType === 'tool_result') return '执行结果';
      return '工具';
    }
    return 'AI 助手';
  };

  // 渲染文本内容（支持折叠）
  const renderTextContent = (text: string) => {
    return (
      <div className="relative">
        <div
          className={`prose prose-sm prose-invert max-w-none transition-all duration-200 ${
            !isContentExpanded && isLongContent ? 'max-h-20 overflow-hidden relative' : ''
          }`}
        >
          <MarkdownRenderer content={text} />
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />
          )}
          {/* 渐变遮罩 */}
          {!isContentExpanded && isLongContent && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-dark-surface to-transparent pointer-events-none" />
          )}
        </div>
      </div>
    );
  };

  // 渲染结构化内容
  const renderStructuredContent = (parts: MessagePart[]) => {
    return (
      <div className="space-y-3">
        {parts.map((part, index) => {
          switch (part.type) {
            case 'text':
              return (
                <div key={index}>
                  {renderTextContent(part.text || '')}
                </div>
              );

            case 'thinking':
              return (
                <ThinkingBlock
                  key={index}
                  content={part.thinking || ''}
                />
              );

            case 'tool_use':
              return (
                <ToolCallBlock
                  key={index}
                  toolName={part.toolName || 'unknown'}
                  toolInput={part.toolInput || {}}
                  status={part.toolStatus || 'pending'}
                />
              );

            case 'tool_result':
              return (
                <ToolCallBlock
                  key={index}
                  toolName={part.toolName || 'unknown'}
                  toolInput={part.toolInput || {}}
                  toolResult={part.toolResult}
                  status={part.toolStatus || 'success'}
                  errorMessage={part.errorMessage}
                />
              );

            case 'permission_request':
              return (
                <PermissionRequest
                  key={index}
                  toolName={part.toolName || 'unknown'}
                  toolInput={part.toolInput || {}}
                  onApprove={onApprovePermission || (() => {})}
                  onReject={onRejectPermission || (() => {})}
                />
              );

            default:
              return null;
          }
        })}
      </div>
    );
  };

  // 系统消息样式
  if (isSystem) {
    const textContent = typeof content === 'string'
      ? content
      : content
          .filter((part) => part.type === 'text')
          .map((part) => part.text || '')
          .join('\n');

    return (
      <div className={`flex justify-center ${className}`}>
        <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg px-4 py-2 max-w-[80%]">
          <div className="flex items-center space-x-2 mb-1">
            {getRoleIcon()}
            <span className="text-xs font-medium text-yellow-300">系统消息</span>
            {timestamp && (
              <span className="text-xs text-yellow-500">
                {new Date(timestamp).toLocaleTimeString('zh-CN')}
              </span>
            )}
          </div>
          <p className="text-sm text-yellow-300">{textContent}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${className}`}>
      <div
        className={`max-w-[85%] rounded-lg ${
          isUser
            ? 'bg-primary-600 text-white'
            : 'bg-dark-surface border border-gray-700/50 shadow-sm'
        }`}
      >
        {/* 头部 */}
        <div
          className={`flex items-center justify-between px-3 py-2 border-b ${
            isUser ? 'border-primary-500' : 'border-gray-700/50'
          }`}
        >
          <div className="flex items-center space-x-2">
            {getRoleIcon()}
            <span
              className={`text-xs font-medium ${
                isUser ? 'text-blue-100' : 'text-gray-400'
              }`}
            >
              {getRoleName()}
            </span>
            {/* 展开/收起按钮 */}
            {isLongContent && !isStreaming && (
              <button
                onClick={() => setIsContentExpanded(!isContentExpanded)}
                className={`flex items-center gap-0.5 text-xs ${
                  isUser ? 'text-blue-200 hover:text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {isContentExpanded ? (
                  <>
                    <ChevronUp size={12} />
                    收起
                  </>
                ) : (
                  <>
                    <ChevronDown size={12} />
                    展开
                  </>
                )}
              </button>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {timestamp && (
              <span
                className={`text-xs ${isUser ? 'text-blue-200' : 'text-gray-500'}`}
              >
                {new Date(timestamp).toLocaleTimeString('zh-CN')}
              </span>
            )}
            <button
              onClick={handleCopy}
              className={`p-1 rounded transition-colors ${
                isUser
                  ? 'text-blue-200 hover:text-white hover:bg-primary-500'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-dark-surface-hover'
              }`}
              title="复制内容"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className={`px-3 py-2 ${isUser ? 'text-white' : 'text-gray-200'}`}>
          {/* 思考过程 */}
          {thinking && <ThinkingBlock content={thinking} className="mb-2" />}

          {/* 主要内容 */}
          {typeof content === 'string'
            ? renderTextContent(content)
            : renderStructuredContent(content)}
        </div>
      </div>
    </div>
  );
}
