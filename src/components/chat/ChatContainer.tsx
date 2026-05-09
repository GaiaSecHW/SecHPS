'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { ChatMessage } from './ChatMessage';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | any[];
  timestamp?: string;
  thinking?: string;
  /** 消息类型，用于显示自定义标签 */
  messageType?: string;
}

interface ChatContainerProps {
  messages: Message[];
  isStreaming?: boolean;
  onApprovePermission?: () => void;
  onRejectPermission?: () => void;
  className?: string;
  autoScroll?: boolean;
}

export interface ChatContainerHandle {
  scrollToBottom: () => void;
  getAutoScroll: () => boolean;
  setAutoScroll: (value: boolean) => void;
}

export const ChatContainer = forwardRef<ChatContainerHandle, ChatContainerProps>(function ChatContainer({
  messages,
  isStreaming = false,
  onApprovePermission,
  onRejectPermission,
  className = '',
  autoScroll: externalAutoScroll,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const internalAutoScroll = useRef(true);

  // 获取当前的 autoScroll 状态（优先使用外部传入的）
  const isAutoScrollEnabled = externalAutoScroll !== undefined ? externalAutoScroll : internalAutoScroll.current;

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    },
    getAutoScroll: () => isAutoScrollEnabled,
    setAutoScroll: (value: boolean) => {
      internalAutoScroll.current = value;
    },
  }));

  // 自动滚动到底部（当有新消息且 autoScroll 为 true 时）
  useEffect(() => {
    if (isAutoScrollEnabled && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isAutoScrollEnabled]);

  // 空状态
  if (messages.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center h-full bg-[#0B1120] ${className}`}
      >
        <MessageSquare size={48} className="text-gray-600 mb-4" />
        <p className="text-gray-500 text-center">
          暂无消息
          <br />
          <span className="text-sm">发送消息开始对话</span>
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex flex-col overflow-y-auto bg-[#0B1120] p-4 ${className}`}
    >
      {/* 消息列表 */}
      <div className="flex-1 space-y-4">
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            role={message.role}
            content={message.content}
            timestamp={message.timestamp}
            thinking={message.thinking}
            messageType={message.messageType}
            onApprovePermission={onApprovePermission}
            onRejectPermission={onRejectPermission}
          />
        ))}

        {/* 流式输出指示器 */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="bg-dark-surface border border-gray-700/50 rounded-lg px-3 py-2 shadow-sm">
              <div className="flex items-center space-x-2">
                <Loader2 size={14} className="animate-spin text-blue-400" />
                <span className="text-sm text-gray-400">正在思考...</span>
              </div>
            </div>
          </div>
        )}

        {/* 底部锚点 */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});
