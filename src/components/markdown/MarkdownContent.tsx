'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownContentProps {
  children?: string;
  className?: string;
  maxWidth?: 'narrow' | 'default' | 'wide' | 'full';
  variant?: 'default' | 'docs' | 'chat';
}

const maxWidthClasses: Record<string, string> = {
  narrow: 'max-w-prose-narrow',
  default: 'max-w-prose',
  wide: 'max-w-prose-wide',
  full: 'max-w-full',
};

const variantStyles: Record<string, string> = {
  default: 'prose prose-sm md:prose-base lg:prose-lg prose-invert',
  docs: 'prose prose-sm md:prose-base prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-cyan-400 prose-code:text-cyan-400 prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800',
  chat: 'prose prose-sm prose-invert prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
};

export function MarkdownContent({
  children,
  className = '',
  maxWidth = 'default',
  variant = 'default',
}: MarkdownContentProps) {
  if (!children) return null;

  return (
    <div className={cn(
      'w-full mx-auto px-4 md:px-6 lg:px-8',
      maxWidthClasses[maxWidth],
      className
    )}>
      <div className={cn(
        'overflow-x-auto',
        variantStyles[variant]
      )}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="text-xl md:text-2xl lg:text-3xl font-semibold text-zinc-100 mb-4 mt-6 first:mt-0">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-lg md:text-xl lg:text-2xl font-semibold text-zinc-100 mb-3 mt-5">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-base md:text-lg font-semibold text-zinc-100 mb-2 mt-4">
                {children}
              </h3>
            ),
            h4: ({ children }) => (
              <h4 className="text-sm md:text-base font-semibold text-zinc-100 mb-2 mt-3">
                {children}
              </h4>
            ),
            p: ({ children }) => (
              <p className="text-sm md:text-base text-zinc-300 leading-relaxed mb-3 last:mb-0">
                {children}
              </p>
            ),
            ul: ({ children }) => (
              <ul className="list-disc list-inside text-sm md:text-base text-zinc-300 mb-3 space-y-1">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal list-inside text-sm md:text-base text-zinc-300 mb-3 space-y-1">
                {children}
              </ol>
            ),
            li: ({ children }) => (
              <li className="text-sm md:text-base text-zinc-300 leading-relaxed">
                {children}
              </li>
            ),
            a: ({ href, children }) => (
              <a 
                href={href} 
                className="text-cyan-400 hover:text-cyan-300 underline transition-colors"
                target={href?.startsWith('http') ? '_blank' : undefined}
                rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
              >
                {children}
              </a>
            ),
            code: ({ className, children, ...props }) => {
              const isInline = !className;
              if (isInline) {
                return (
                  <code className="px-1.5 py-0.5 bg-zinc-800/50 text-cyan-400 rounded text-sm font-mono" {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <code className={cn('text-sm md:text-base', className)} {...props}>
                  {children}
                </code>
              );
            },
            pre: ({ children }) => (
              <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 md:p-5 mb-4 overflow-x-auto text-sm md:text-base">
                {children}
              </pre>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-cyan-500/50 pl-4 py-2 bg-zinc-900/30 rounded-r-lg mb-4 text-sm md:text-base text-zinc-400 italic">
                {children}
              </blockquote>
            ),
            table: ({ children }) => (
              <div className="overflow-x-auto mb-4">
                <table className="min-w-full border-collapse text-sm md:text-base">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-zinc-800 px-3 md:px-4 py-2 text-left text-sm md:text-base font-semibold text-zinc-100 bg-zinc-900">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-zinc-800 px-3 md:px-4 py-2 text-sm md:text-base text-zinc-300">
                {children}
              </td>
            ),
            hr: () => (
              <hr className="border-zinc-800 my-6" />
            ),
            img: ({ src, alt }) => (
              <img 
                src={src} 
                alt={alt} 
                className="max-w-full h-auto rounded-lg my-4" 
                loading="lazy"
              />
            ),
          }}
        >
          {children}
        </ReactMarkdown>
      </div>
    </div>
  );
}

interface MarkdownReaderProps {
  children?: string;
  title?: string;
  className?: string;
  showToc?: boolean;
}

export function MarkdownReader({
  children,
  title,
  className = '',
  showToc = false,
}: MarkdownReaderProps) {
  return (
    <article className={cn(
      'min-h-full py-6 md:py-8 lg:py-10',
      className
    )}>
      {title && (
        <header className="max-w-prose mx-auto px-4 md:px-6 lg:px-8 mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-zinc-100 tracking-tight">
            {title}
          </h1>
        </header>
      )}
      
      <MarkdownContent maxWidth="default" variant="docs">
        {children}
      </MarkdownContent>
    </article>
  );
}

interface MarkdownChatProps {
  children?: string;
  className?: string;
}

export function MarkdownChat({
  children,
  className = '',
}: MarkdownChatProps) {
  return (
    <div className={cn(
      'w-full',
      className
    )}>
      <MarkdownContent maxWidth="full" variant="chat">
        {children}
      </MarkdownContent>
    </div>
  );
}

interface CodeBlockProps {
  children?: string;
  language?: string;
  className?: string;
  filename?: string;
  showCopy?: boolean;
}

export function CodeBlock({
  children,
  language,
  className = '',
  filename,
  showCopy = true,
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    if (children) {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={cn('relative group rounded-lg overflow-hidden', className)}>
      {(filename || showCopy) && (
        <div className="flex items-center justify-between bg-zinc-900 border-b border-zinc-800 px-4 py-2">
          {filename && (
            <span className="text-sm text-zinc-400 font-mono">{filename}</span>
          )}
          {showCopy && (
            <button
              onClick={handleCopy}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded"
            >
              {copied ? '已复制' : '复制'}
            </button>
          )}
        </div>
      )}
      <pre className="bg-zinc-950 p-4 md:p-5 overflow-x-auto text-sm md:text-base">
        <code className={`language-${language || 'text'} font-mono text-zinc-300`}>
          {children}
        </code>
      </pre>
    </div>
  );
}