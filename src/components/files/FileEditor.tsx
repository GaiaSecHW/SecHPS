'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { safeClipboardWrite } from '@/lib/clipboard';
import DOMPurify from 'dompurify';
import {
  Save,
  X,
  Loader2,
  FileCode,
  AlertCircle,
  CheckCircle,
  Edit3,
  Eye,
  Copy,
  Download,
  FileText,
} from 'lucide-react';

// 文件内容响应接口
interface FileContent {
  content: string | null;
  size: number;
  language: string;
  encoding: string;
  path: string;
  fileName: string;
  isBinary: boolean;
  message?: string;
}

// 语法高亮关键字定义
const SYNTAX_HIGHLIGHTS: Record<string, { keywords: string[]; color: string }> = {
  TypeScript: {
    keywords: [
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
      'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new',
      'class', 'interface', 'type', 'enum', 'extends', 'implements', 'import', 'export',
      'from', 'default', 'as', 'async', 'await', 'yield', 'static', 'public', 'private',
      'protected', 'readonly', 'abstract', 'override', 'namespace', 'module', 'declare',
      'typeof', 'keyof', 'infer', 'never', 'unknown', 'any', 'void', 'null', 'undefined',
      'true', 'false', 'this', 'super', 'constructor', 'get', 'set', 'in', 'of',
    ],
    color: 'text-purple-600',
  },
  JavaScript: {
    keywords: [
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
      'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new',
      'class', 'extends', 'import', 'export', 'from', 'default', 'as', 'async', 'await',
      'yield', 'static', 'this', 'super', 'constructor', 'get', 'set', 'in', 'of',
      'true', 'false', 'null', 'undefined', 'typeof', 'instanceof',
    ],
    color: 'text-purple-600',
  },
  Python: {
    keywords: [
      'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally',
      'with', 'as', 'import', 'from', 'return', 'yield', 'raise', 'pass', 'break',
      'continue', 'lambda', 'and', 'or', 'not', 'in', 'is', 'True', 'False', 'None',
      'global', 'nonlocal', 'assert', 'del', 'async', 'await',
    ],
    color: 'text-green-600',
  },
  Java: {
    keywords: [
      'public', 'private', 'protected', 'class', 'interface', 'extends', 'implements',
      'static', 'final', 'abstract', 'void', 'return', 'if', 'else', 'for', 'while',
      'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
      'throws', 'new', 'this', 'super', 'import', 'package', 'synchronized', 'volatile',
      'transient', 'native', 'strictfp', 'assert', 'enum', 'const', 'goto', 'true',
      'false', 'null', 'instanceof',
    ],
    color: 'text-red-600',
  },
  Go: {
    keywords: [
      'package', 'import', 'func', 'return', 'var', 'const', 'type', 'struct', 'interface',
      'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue',
      'goto', 'fallthrough', 'defer', 'go', 'select', 'chan', 'map', 'make', 'new',
      'len', 'cap', 'append', 'copy', 'delete', 'close', 'panic', 'recover', 'true',
      'false', 'nil',
    ],
    color: 'text-cyan-600',
  },
  Rust: {
    keywords: [
      'fn', 'let', 'mut', 'const', 'static', 'pub', 'mod', 'use', 'crate', 'self',
      'super', 'struct', 'enum', 'trait', 'impl', 'type', 'where', 'for', 'loop',
      'while', 'if', 'else', 'match', 'return', 'break', 'continue', 'move', 'ref',
      'as', 'in', 'unsafe', 'extern', 'async', 'await', 'dyn', 'box', 'macro_rules',
      'true', 'false', 'Some', 'None', 'Ok', 'Err',
    ],
    color: 'text-orange-600',
  },
  SQL: {
    keywords: [
      'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS',
      'NULL', 'AS', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'GROUP', 'HAVING',
      'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'INSERT', 'INTO', 'VALUES',
      'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER', 'ADD', 'COLUMN',
      'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'DEFAULT', 'CHECK',
      'CONSTRAINT', 'VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'DATABASE', 'SCHEMA',
    ],
    color: 'text-blue-500',
  },
  CSS: {
    keywords: [
      'important', 'inherit', 'initial', 'unset', 'revert', 'auto', 'none', 'block',
      'inline', 'flex', 'grid', 'hidden', 'visible', 'scroll', 'fixed', 'absolute',
      'relative', 'sticky', 'static', 'center', 'left', 'right', 'top', 'bottom',
      'width', 'height', 'min', 'max', 'margin', 'padding', 'border', 'color',
      'background', 'font', 'text', 'display', 'position', 'overflow', 'z-index',
    ],
    color: 'text-blue-400',
  },
  JSON: {
    keywords: ['true', 'false', 'null'],
    color: 'text-purple-500',
  },
  YAML: {
    keywords: ['true', 'false', 'null', 'yes', 'no', 'on', 'off'],
    color: 'text-red-400',
  },
  Shell: {
    keywords: [
      'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac',
      'function', 'return', 'exit', 'break', 'continue', 'local', 'export', 'source',
      'alias', 'unset', 'readonly', 'declare', 'typeset', 'true', 'false', 'test',
      'echo', 'printf', 'read', 'cd', 'pwd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat',
    ],
    color: 'text-green-400',
  },
};

// 注释模式定义
const COMMENT_PATTERNS: Record<string, { single?: string; multiStart?: string; multiEnd?: string }> = {
  TypeScript: { single: '//', multiStart: '/*', multiEnd: '*/' },
  JavaScript: { single: '//', multiStart: '/*', multiEnd: '*/' },
  Python: { single: '#' },
  Java: { single: '//', multiStart: '/*', multiEnd: '*/' },
  Go: { single: '//', multiStart: '/*', multiEnd: '*/' },
  Rust: { single: '//', multiStart: '/*', multiEnd: '*/' },
  SQL: { single: '--', multiStart: '/*', multiEnd: '*/' },
  CSS: { multiStart: '/*', multiEnd: '*/' },
  Shell: { single: '#' },
  YAML: { single: '#' },
  JSON: { single: '' }, // JSON 不支持注释
};

interface FileEditorProps {
  projectId: string;
  filePath: string | null;
  language: string;
  onClose: () => void;
  onSave?: (path: string) => void;
}

export default function FileEditor({ projectId, filePath, language, onClose, onSave }: FileEditorProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isEditing, setIsEditing] = useState(true);
  const [fileInfo, setFileInfo] = useState<FileContent | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // 加载文件内容
  useEffect(() => {
    if (!filePath) {
      setContent('');
      setOriginalContent('');
      setFileInfo(null);
      return;
    }

    const fetchContent = async () => {
      setLoading(true);
      setError('');
      setSuccess('');

      try {
        const token = localStorage.getItem('token');
        const response = await fetch(
          `/api/files/${projectId}/read?path=${encodeURIComponent(filePath)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: '读取文件失败' }));
          setError(data.error || '读取文件失败');
          setLoading(false);
          return;
        }

        const data: FileContent = await response.json();
        setFileInfo(data);

        if (data.isBinary) {
          setContent('');
          setOriginalContent('');
          setError(data.message || '二进制文件，无法以文本形式显示');
        } else {
          setContent(data.content || '');
          setOriginalContent(data.content || '');
        }
      } catch (err) {
        setError('网络错误，请重试');
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [projectId, filePath]);

  // 同步滚动行号
  const handleScroll = useCallback(() => {
    if (editorRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = editorRef.current.scrollTop;
    }
  }, []);

  // 保存文件
  const handleSave = async () => {
    if (!filePath || content === originalContent) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/files/${projectId}/write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          path: filePath,
          content,
          createBackup: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: '保存文件失败' }));
        setError(data.error || '保存文件失败');
        setSaving(false);
        return;
      }

      setOriginalContent(content);
      setSuccess('文件已保存');
      onSave?.(filePath);

      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setSaving(false);
    }
  };

  // 复制内容
  const handleCopy = async () => {
    if (!content) return;
    try {
      await safeClipboardWrite(content);
      setSuccess('已复制到剪贴板');
      setTimeout(() => setSuccess(''), 2000);
    } catch {
      setError('复制失败');
    }
  };

  // 下载文件
  const handleDownload = () => {
    if (!content || !filePath) return;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileInfo?.fileName || filePath.split('/').pop() || 'file';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  // 计算行号
  const lines = useMemo(() => {
    return content.split('\n');
  }, [content]);

  // 检查是否有修改
  const hasChanges = content !== originalContent;

  // 获取当前语言的语法高亮配置
  const syntaxConfig = useMemo(() => {
    return SYNTAX_HIGHLIGHTS[language] || { keywords: [], color: 'text-gray-600' };
  }, [language]);

  // HTML 转义函数 - 防止 XSS 攻击
  const escapeHtml = useCallback((str: string) => {
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return str.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
  }, []);

  // 简单的语法高亮（用于显示）
  const getHighlightedLine = useCallback((line: string) => {
    if (!isEditing) {
      // 首先对原始内容进行 HTML 转义，防止 XSS
      let highlighted = escapeHtml(line);
      
      // 高亮关键字
      syntaxConfig.keywords.forEach((keyword) => {
        const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
        highlighted = highlighted.replace(regex, `<span class="${syntaxConfig.color} font-medium">$1</span>`);
      });

      // 高亮字符串（单引号和双引号）
      highlighted = highlighted.replace(/(["'`])(?:(?!\1)[^\\]|\\.)*?\1/g, '<span class="text-green-600">$&</span>');

      // 高亮数字
      highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, '<span class="text-orange-500">$1</span>');

      // 高亮注释
      const commentPattern = COMMENT_PATTERNS[language];
      if (commentPattern?.single) {
        const commentIndex = highlighted.indexOf(commentPattern.single);
        if (commentIndex !== -1) {
          const beforeComment = highlighted.substring(0, commentIndex);
          const comment = highlighted.substring(commentIndex);
          highlighted = beforeComment + `<span class="text-gray-400 italic">${comment}</span>`;
        }
      }

      return highlighted;
    }
    return line;
  }, [isEditing, language, syntaxConfig, escapeHtml]);

  // 加载状态
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <Loader2 className="animate-spin h-8 w-8 text-blue-500" />
        <p className="mt-2 text-sm text-gray-500">加载文件...</p>
      </div>
    );
  }

  // 未选择文件
  if (!filePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <FileCode size={48} />
        <p className="mt-4 text-sm">选择一个文件查看内容</p>
      </div>
    );
  }

  // 二进制文件
  if (fileInfo?.isBinary) {
    return (
      <div className="flex flex-col h-full">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-[#0F172A]">
          <div className="flex items-center space-x-3">
            <FileText size={20} className="text-gray-500" />
            <div>
              <h3 className="text-sm font-medium text-gray-100 truncate max-w-md">
                {fileInfo.fileName}
              </h3>
              <p className="text-xs text-gray-500">{fileInfo.path}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <AlertCircle size={48} className="text-yellow-500" />
          <p className="mt-4 text-sm text-gray-400">{fileInfo.message}</p>
          <p className="mt-2 text-xs text-gray-400">大小: {(fileInfo.size / 1024).toFixed(2)} KB</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/50 bg-[#0F172A]">
        <div className="flex items-center space-x-3">
          <FileCode size={18} className="text-gray-500" />
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-100 truncate max-w-xs">
              {fileInfo?.fileName || filePath.split('/').pop()}
            </span>
            <span className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded">
              {language}
            </span>
            {fileInfo && (
              <span className="text-xs text-gray-400">
                {(fileInfo.size / 1024).toFixed(1)} KB
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* 模式切换 */}
          <div className="flex border border-gray-600 rounded overflow-hidden">
            <button
              onClick={() => setIsEditing(true)}
              className={`px-3 py-1 text-xs ${
                isEditing ? 'bg-blue-500 text-white' : 'bg-dark-surface text-gray-400 hover:bg-dark-surface-hover'
              }`}
            >
              <Edit3 size={14} className="inline mr-1" />
              编辑
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className={`px-3 py-1 text-xs ${
                !isEditing ? 'bg-blue-500 text-white' : 'bg-dark-surface text-gray-400 hover:bg-dark-surface-hover'
              }`}
            >
              <Eye size={14} className="inline mr-1" />
              预览
            </button>
          </div>

          {/* 操作按钮 */}
          <button
            onClick={handleCopy}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded border border-gray-600 hover:bg-dark-surface-hover"
            title="复制内容"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded border border-gray-600 hover:bg-dark-surface-hover"
            title="下载文件"
          >
            <Download size={16} />
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className={`flex items-center space-x-1 px-3 py-1.5 text-sm rounded ${
              hasChanges
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            <span>保存</span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded border border-gray-600 hover:bg-dark-surface-hover"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 状态提示 */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 flex items-center space-x-2">
          <AlertCircle size={16} className="text-red-500" />
          <span className="text-sm text-red-600">{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-400">
            <X size={14} />
          </button>
        </div>
      )}
      {success && (
        <div className="px-4 py-2 bg-green-50 border-b border-green-100 flex items-center space-x-2">
          <CheckCircle size={16} className="text-green-500" />
          <span className="text-sm text-green-600">{success}</span>
          <button onClick={() => setSuccess('')} className="ml-auto text-green-500 hover:text-green-400">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 编辑器区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 行号 */}
        <div
          ref={lineNumbersRef}
          className="flex-shrink-0 bg-[#0F172A] border-r border-gray-700/50 overflow-hidden select-none"
          style={{ width: '50px' }}
        >
          <div className="py-2 px-2 text-right font-mono text-xs text-gray-400 leading-6">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        </div>

        {/* 编辑/预览区域 */}
        {isEditing ? (
          <textarea
            ref={editorRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onScroll={handleScroll}
            className="flex-1 p-2 font-mono text-sm leading-6 resize-none focus:outline-none bg-[#0F172A]"
            spellCheck={false}
            style={{
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              overflowX: 'auto',
            }}
          />
        ) : (
          <div className="flex-1 overflow-auto bg-dark-surface">
            <pre className="p-2 font-mono text-sm leading-6">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className="hover:bg-dark-surface-hover"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(getHighlightedLine(line) || '&nbsp;') }}
                />
              ))}
            </pre>
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="flex items-center justify-between px-4 py-1 text-xs text-gray-400 border-t border-gray-700/50 bg-[#0F172A]">
        <div className="flex items-center space-x-4">
          <span>{lines.length} 行</span>
          <span>{content.length} 字符</span>
          <span>{fileInfo?.encoding || 'UTF-8'}</span>
        </div>
        <div className="flex items-center space-x-2">
          {hasChanges && (
            <span className="text-yellow-600">已修改</span>
          )}
          <span>{fileInfo?.path}</span>
        </div>
      </div>
    </div>
  );
}
