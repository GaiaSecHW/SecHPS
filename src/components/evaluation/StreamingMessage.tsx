'use client';

import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
  className?: string;
}

export function StreamingMessage({
  content,
  isStreaming,
  className = '',
}: StreamingMessageProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (containerRef.current && isStreaming) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  return (
    <div
      ref={containerRef}
      className={`prose prose-sm prose-invert max-w-none bg-dark-surface rounded-lg p-4 max-h-[600px] overflow-y-auto border border-gray-700/50 ${className}`}
    >
      {content ? (
        <ReactMarkdown>{content}</ReactMarkdown>
      ) : (
        <span className="text-gray-500">等待响应...</span>
      )}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />
      )}
    </div>
  );
}
