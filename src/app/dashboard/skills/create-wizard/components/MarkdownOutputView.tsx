'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { FileText, Code, Eye, EyeOff } from 'lucide-react';

interface MarkdownOutputViewProps {
  vulnerabilityReport?: string;
  securityAnalysis?: string;
  outputs?: Record<string, string | undefined>;
}

export default function MarkdownOutputView({
  vulnerabilityReport,
  securityAnalysis,
  outputs,
}: MarkdownOutputViewProps) {
  const [activeTab, setActiveTab] = useState<'vulnerability' | 'analysis' | 'other'>('vulnerability');
  const [showRaw, setShowRaw] = useState(false);

  // 收集所有输出文件
  const allOutputs: Record<string, string> = {};
  if (vulnerabilityReport) allOutputs['vulnerability_report.md'] = vulnerabilityReport;
  if (securityAnalysis) allOutputs['security_analysis.md'] = securityAnalysis;
  if (outputs) {
    Object.entries(outputs).forEach(([key, value]) => {
      if (value && key !== 'vulnerability_report' && key !== 'security_analysis') {
        allOutputs[key] = value;
      }
    });
  }

  const hasVulnerabilityReport = !!vulnerabilityReport;
  const hasSecurityAnalysis = !!securityAnalysis;
  const hasOtherOutputs = outputs && Object.keys(outputs).some(
    k => k !== 'vulnerability_report' && k !== 'security_analysis' && outputs[k]
  );

  const getCurrentContent = () => {
    if (activeTab === 'vulnerability' && vulnerabilityReport) {
      return vulnerabilityReport;
    }
    if (activeTab === 'analysis' && securityAnalysis) {
      return securityAnalysis;
    }
    if (activeTab === 'other' && outputs) {
      const otherKeys = Object.keys(outputs).filter(
        k => k !== 'vulnerability_report' && k !== 'security_analysis' && outputs[k]
      );
      if (otherKeys.length > 0) {
        return outputs[otherKeys[0]] || '';
      }
    }
    return '';
  };

  const currentContent = getCurrentContent();

  if (Object.keys(allOutputs).length === 0) {
    return (
      <div className="bg-[#0F172A] border border-gray-700/50 rounded-lg p-4 text-center">
        <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-500">暂无输出文件</p>
      </div>
    );
  }

  return (
    <div className="bg-dark-surface border border-gray-700/50 rounded-lg overflow-hidden">
      {/* Tab 切换 */}
      <div className="flex items-center justify-between bg-[#0F172A] border-b border-gray-700/50 px-4">
        <div className="flex space-x-1">
          {hasVulnerabilityReport && (
            <button
              onClick={() => setActiveTab('vulnerability')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'vulnerability'
                  ? 'border-blue-600 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <FileText size={16} className="inline mr-1" />
              漏洞报告
            </button>
          )}
          {hasSecurityAnalysis && (
            <button
              onClick={() => setActiveTab('analysis')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'analysis'
                  ? 'border-blue-600 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <FileText size={16} className="inline mr-1" />
              安全分析
            </button>
          )}
          {hasOtherOutputs && (
            <button
              onClick={() => setActiveTab('other')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'other'
                  ? 'border-blue-600 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Code size={16} className="inline mr-1" />
              其他输出
            </button>
          )}
        </div>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="flex items-center space-x-1 px-3 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-dark-surface-hover rounded"
        >
          {showRaw ? <Eye size={14} /> : <EyeOff size={14} />}
          <span>{showRaw ? '渲染视图' : '源码视图'}</span>
        </button>
      </div>

      {/* 内容区域 */}
      <div className="p-4 max-h-96 overflow-y-auto">
        {showRaw ? (
          <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono bg-[#0F172A] p-3 rounded border border-gray-700/50">
            {currentContent}
          </pre>
        ) : (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              components={{
                // 自定义样式
                h1: ({ children }) => (
                  <h1 className="text-lg font-bold text-gray-100 mb-3 mt-0">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-base font-semibold text-gray-100 mb-2 mt-3">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-sm font-semibold text-gray-200 mb-2 mt-2">{children}</h3>
                ),
                p: ({ children }) => (
                  <p className="text-sm text-gray-300 mb-2">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside text-sm text-gray-300 space-y-1 mb-2">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside text-sm text-gray-300 space-y-1 mb-2">{children}</ol>
                ),
                code: ({ children, className }) => {
                  const isInline = !className;
                  return isInline ? (
                    <code className="px-1 py-0.5 bg-gray-100 text-gray-200 rounded text-xs font-mono">
                      {children}
                    </code>
                  ) : (
                    <code className="block bg-gray-900 text-gray-100 p-3 rounded text-xs font-mono overflow-x-auto">
                      {children}
                    </code>
                  );
                },
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-blue-500 pl-4 py-1 my-2 bg-blue-500/10 text-sm text-gray-300">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-2">
                    <table className="min-w-full text-sm border border-gray-700/50">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-[#0F172A] border-b border-gray-700/50">{children}</thead>
                ),
                th: ({ children }) => (
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-300">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="px-3 py-2 border-b border-gray-700/50 text-xs text-gray-400">{children}</td>
                ),
              }}
            >
              {currentContent}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
