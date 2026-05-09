'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Check, Copy, AlertCircle } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  onCopy?: () => void;
}

export default function MarkdownRenderer({ content, onCopy }: MarkdownRendererProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (onCopy) {
      onCopy();
    }
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="prose prose-sm prose-invert max-w-none">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <AlertCircle className="h-4 w-4 text-blue-400" />
          <span className="text-sm text-gray-400">AI 回复</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-md bg-dark-surface hover:bg-dark-surface-hover transition-colors border border-gray-700/50"
          title="复制到剪贴板"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-green-400" />
              <span className="text-sm text-green-400">已复制!</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-400">复制</span>
            </>
          )}
        </button>
      </div>

      <div className="bg-dark-surface rounded-lg p-6 shadow-sm border border-gray-700/50">
        <ReactMarkdown
          components={{
            // 自定义代码块样式
            code: ({ node, inline, className, children, ...props }: any) => {
              if (inline) {
                return (
                  <code
                    className="px-1.5 py-0.5 rounded bg-gray-800 text-blue-400 font-mono text-sm"
                    {...props}
                  >
                    {children}
                  </code>
                );
              }
              return (
                <code
                  className="block px-4 py-3 rounded-lg bg-gray-900 text-gray-100 font-mono text-sm overflow-x-auto"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            // 自定义代码块样式
            pre: ({ node, inline, className, children, ...props }: any) => {
              if (inline) {
                return (
                  <code
                    className="px-1.5 py-0.5 rounded bg-gray-800 text-blue-400 font-mono text-sm"
                    {...props}
                  >
                    {children}
                  </code>
                );
              }
              return (
                <pre
                  className="px-4 py-3 rounded-lg bg-gray-900 text-gray-100 font-mono text-sm overflow-x-auto"
                  {...props}
                >
                  {children}
                </pre>
              );
            },
            // 自定义标题样式
            h1: ({ children, ...props }: any) => (
              <h1
                className="text-2xl font-bold text-gray-100 mt-6 mb-4 pb-2 border-b border-gray-700/50"
                {...props}
              >
                {children}
              </h1>
            ),
            h2: ({ children, ...props }: any) => (
              <h2
                className="text-xl font-semibold text-gray-100 mt-5 mb-3 pb-2 border-b border-gray-700/50"
                {...props}
              >
                {children}
              </h2>
            ),
            h3: ({ children, ...props }: any) => (
              <h3
                className="text-lg font-semibold text-gray-100 mt-4 mb-2"
                {...props}
              >
                {children}
              </h3>
            ),
            h4: ({ children, ...props }: any) => (
              <h4
                className="text-base font-semibold text-gray-100 mt-3 mb-2"
                {...props}
              >
                {children}
              </h4>
            ),
            // 自定义列表样式
            ul: ({ children, ...props }: any) => (
              <ul
                className="mt-4 space-y-2 list-disc list-inside marker:text-blue-400"
                {...props}
              >
                {children}
              </ul>
            ),
            li: ({ children, ...props }: any) => (
              <li
                className="text-gray-300 ml-6"
                {...props}
              >
                {children}
              </li>
            ),
            // 自定义引用块样式
            blockquote: ({ children, ...props }: any) => (
              <blockquote
                className="border-l-4 border-blue-500 pl pl-4 italic my-4 text-gray-400"
                {...props}
              >
                {children}
              </blockquote>
            ),
            // 自定义表格样式
            table: ({ children, ...props }: any) => (
              <div className="my-6 overflow-x-auto">
                <table
                  className="min-w-full divide-y divide-gray-700/50 border border-gray-600"
                  {...props}
                >
                  {children}
                </table>
              </div>
            ),
            thead: ({ children, ...props }: any) => (
              <thead
                className="bg-[#162032]"
                {...props}
              >
                {children}
              </thead>
            ),
            tbody: ({ children, ...props }: any) => (
              <tbody
                className="divide-y divide-gray-700/50"
                {...props}
              >
                {children}
              </tbody>
            ),
            tr: ({ children, ...props }: any) => (
              <tr
                className="hover:bg-dark-surface-hover"
                {...props}
              >
                {children}
              </tr>
            ),
            th: ({ children, ...props }: any) => (
              <th
                className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider"
                {...props}
              >
                {children}
              </th>
            ),
            td: ({ children, ...props }: any) => (
              <td
                className="px-4 py-2 text-sm text-gray-300"
                {...props}
              >
                {children}
              </td>
            ),
            // 自定义链接样式
            a: ({ children, href, ...props }: any) => (
              <a
                href={href}
                className="text-blue-400 hover:text-blue-300 underline"
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            ),
            // 自定义强调样式
            strong: ({ children, ...props }: any) => (
              <strong
                className="font-semibold text-gray-100"
                {...props}
              >
                {children}
              </strong>
            ),
            // 自定义删除线样式
            del: ({ children, ...props }: any) => (
              <del
                className="text-red-400 line-through"
                {...props}
              >
                {children}
              </del>
            ),
            // 自定义引用样式
            p: ({ children, ...props }: any) => (
              <p
                className="text-gray-300 leading-relaxed"
                {...props}
              >
                {children}
              </p>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
