'use client';

import { useMemo, useState, useCallback } from 'react';
import ReactMarkdown, { Components, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy, Code2 } from 'lucide-react';
import { safeClipboardWrite } from '@/lib/clipboard';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

type CodeProps = React.ClassAttributes<HTMLElement> & 
  React.HTMLAttributes<HTMLElement> & 
  ExtraProps;

function CodeBlock({ 
  children, 
  className 
}: { 
  children?: React.ReactNode; 
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = useCallback(() => {
    const text = String(children || '').replace(/\n$/, '');
    safeClipboardWrite(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';
  const codeContent = String(children || '').replace(/\n$/, '');

  return (
    <div className="group relative my-4 not-prose">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/80 border border-zinc-800 border-b-0 rounded-t-xl">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-zinc-500" />
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
            {language}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium
            bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/50
            text-zinc-400 hover:text-zinc-200 transition-all duration-200"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-400">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      
      {/* Code */}
      <div className="rounded-b-xl border border-zinc-800 border-t-0 overflow-hidden">
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          PreTag="div"
          CodeTag="code"
          customStyle={{
            margin: 0,
            padding: '1rem',
            background: 'rgba(24, 24, 27, 0.5)',
            borderRadius: 0,
            fontSize: '0.875rem',
            lineHeight: '1.625',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            }
          }}
        >
          {codeContent}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

function InlineCode({ children }: { children?: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded-md bg-zinc-800/80 text-cyan-400 font-mono text-[0.875em] border border-zinc-700/50">
      {children}
    </code>
  );
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight mt-8 mb-4 pb-3 border-b border-zinc-800">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold text-zinc-100 tracking-tight mt-6 mb-3">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold text-zinc-100 tracking-tight mt-5 mb-2">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold text-zinc-100 tracking-tight mt-4 mb-2">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-sm font-semibold text-zinc-100 tracking-tight mt-3 mb-1.5">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-sm font-medium text-zinc-200 tracking-tight mt-3 mb-1.5">
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p className="text-zinc-300 leading-[1.75] mb-4 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-4 space-y-2 ml-6 list-disc [&>li]:marker:text-zinc-500">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 space-y-2 ml-6 list-decimal [&>li]:marker:text-zinc-500">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-zinc-300 leading-relaxed pl-1">{children}</li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-zinc-100">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-zinc-300">{children}</em>
  ),
  a: ({ href, children }) => (
    <a 
      href={href} 
      target="_blank" 
      rel="noreferrer noopener"
      className="text-cyan-400 hover:text-cyan-300 hover:underline underline-offset-2 transition-colors duration-200"
    >
      {children}
    </a>
  ),
  code: ({ className, children }: CodeProps) => {
    const isInline = !className;
    
    if (isInline) {
      return <InlineCode>{children}</InlineCode>;
    }
    
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  pre: ({ children }) => {
    return <>{children}</>;
  },
  blockquote: ({ children }) => (
    <blockquote className="my-4 pl-4 py-3 border-l-4 border-primary-500 bg-zinc-900/40 rounded-r-lg">
      <div className="text-zinc-300 leading-relaxed">{children}</div>
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-zinc-800">
      <table className="min-w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-zinc-900/60">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-zinc-800">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-zinc-800/40 transition-colors">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-3 text-zinc-300">{children}</td>
  ),
  hr: () => (
    <hr className="my-8 border-zinc-800" />
  ),
  img: ({ src, alt }) => (
    <img 
      src={src} 
      alt={alt || ''} 
      className="my-4 rounded-xl border border-zinc-800 shadow-2xl shadow-zinc-900/50 max-w-full h-auto"
      loading="lazy"
    />
  ),
};

export default function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const memoizedContent = useMemo(() => content, [content]);
  
  return (
    <div className={`prose prose-invert prose-zinc max-w-none ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {memoizedContent}
      </ReactMarkdown>
    </div>
  );
}