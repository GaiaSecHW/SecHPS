'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Sparkles, CheckCircle, TrendingUp, AlertCircle, Copy, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  skillData: any;
  testCases: any[];
  evaluationData: any;
  iterations: any[];
  optimizationData: {
    optimizedSkill?: any;
    triggerAccuracy?: number;
    suggestions?: string[];
  };
  onChange: (data: any) => void;
  onNext: () => void;
  onPrevious: () => void;
}

export default function OptimizationStep({ 
  skillData, 
  testCases, 
  evaluationData, 
  iterations,
  optimizationData, 
  onChange, 
  onNext, 
  onPrevious 
}: Props) {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>('description');

  const handleOptimize = async () => {
    setIsOptimizing(true);
    try {
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/skills/optimize-skill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          skillData, 
          testCases,
          evaluationData,
          iterations,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '优化失败');
      }

      const result = await response.json();

      onChange({
        optimization: {
          optimizedSkill: result.optimizedSkill,
          triggerAccuracy: result.triggerAccuracy,
          suggestions: result.suggestions,
        },
      });
    } catch (error) {
      console.error('优化失败:', error);
      toast.error(error instanceof Error ? error.message : '优化失败，请重试');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleApplyOptimized = () => {
    if (optimizationData.optimizedSkill) {
      onChange({
        skill: optimizationData.optimizedSkill,
      });
      toast.success('已应用优化后的 Skill 定义！');
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const optimizedSkill = optimizationData.optimizedSkill;

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="bg-indigo-900/20 border border-indigo-200 rounded-lg p-4">
        <div className="flex items-start">
          <Sparkles className="w-5 h-5 text-indigo-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-indigo-800">
            <p className="font-medium mb-2">Skill 整体优化</p>
            <p className="text-indigo-700">
              AI 会分析你的 Skill 定义和测试用例，优化整个 Skill 包括：描述、系统提示词、用户提示词、工具列表等，提高触发准确性和执行效果。
            </p>
          </div>
        </div>
      </div>

      {/* 当前 Skill 概览 */}
      <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">当前 Skill 概览</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">名称:</span>
            <span className="ml-2 text-gray-100">{skillData.displayName || skillData.name}</span>
          </div>
          <div>
            <span className="text-gray-500">分类:</span>
            <span className="ml-2 text-gray-100">{skillData.category || 'code-audit'}</span>
          </div>
          <div>
            <span className="text-gray-500">测试用例:</span>
            <span className="ml-2 text-gray-100">{testCases?.length || 0} 个</span>
          </div>
          <div>
            <span className="text-gray-500">工具:</span>
            <span className="ml-2 text-gray-100">{skillData.tools?.length || 0} 个</span>
          </div>
        </div>
      </div>

      {/* 优化按钮 */}
      {!optimizedSkill && (
        <div className="flex justify-center">
          <button
            onClick={handleOptimize}
            disabled={isOptimizing}
            className="px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center"
          >
            {isOptimizing ? (
              <>
                <Sparkles size={20} className="mr-2 animate-pulse" />
                优化中...
              </>
            ) : (
              <>
                <Sparkles size={20} className="mr-2" />
                开始优化 Skill
              </>
            )}
          </button>
        </div>
      )}

      {/* 优化结果 */}
      {optimizedSkill && (
        <div className="space-y-4">
          {/* 准确率 */}
          <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-300">预估触发准确率</span>
                <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-400 rounded">模型预估</span>
              </div>
              <TrendingUp className="w-5 h-5 text-green-500" />
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <div className="w-full bg-gray-700 rounded-full h-3">
                  <div
                    className="bg-green-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${(optimizationData.triggerAccuracy || 0.85) * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-2xl font-bold text-green-400">
                {((optimizationData.triggerAccuracy || 0.85) * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              此数值由 AI 模型根据优化内容估算，仅供参考，不代表实际触发准确率。
            </p>
          </div>

          {/* 优化对比 */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-300">优化对比</h3>

            {/* 描述对比 */}
            <CompareSection
              title="描述"
              original={skillData.description}
              optimized={optimizedSkill.description}
              isExpanded={expandedSection === 'description'}
              onToggle={() => toggleSection('description')}
              onCopy={(text) => handleCopy(text, 'description')}
              copied={copied === 'description'}
            />

            {/* 系统提示词对比 */}
            <CompareSection
              title="系统提示词"
              original={skillData.systemPrompt}
              optimized={optimizedSkill.systemPrompt}
              isExpanded={expandedSection === 'systemPrompt'}
              onToggle={() => toggleSection('systemPrompt')}
              onCopy={(text) => handleCopy(text, 'systemPrompt')}
              copied={copied === 'systemPrompt'}
              isCode
            />

            {/* 用户提示词对比 */}
            <CompareSection
              title="用户提示词模板"
              original={skillData.userPrompt}
              optimized={optimizedSkill.userPrompt}
              isExpanded={expandedSection === 'userPrompt'}
              onToggle={() => toggleSection('userPrompt')}
              onCopy={(text) => handleCopy(text, 'userPrompt')}
              copied={copied === 'userPrompt'}
              isCode
            />

            {/* 触发关键词 */}
            {optimizedSkill.triggerKeywords && optimizedSkill.triggerKeywords.length > 0 && (
              <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-300">触发关键词</h4>
                  <button
                    onClick={() => handleCopy(optimizedSkill.triggerKeywords.join(', '), 'keywords')}
                    className="text-xs text-blue-400 hover:text-blue-800"
                  >
                    {copied === 'keywords' ? '已复制' : '复制'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {optimizedSkill.triggerKeywords.map((keyword: string, index: number) => (
                    <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 工具对比 */}
            <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-300 mb-2">工具列表</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">原始</p>
                  <div className="flex flex-wrap gap-1">
                    {(skillData.tools || []).map((tool: string, index: number) => (
                      <span key={index} className="px-2 py-0.5 bg-gray-100 text-gray-400 text-xs rounded">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-green-400 mb-1">优化后</p>
                  <div className="flex flex-wrap gap-1">
                    {(optimizedSkill.tools || []).map((tool: string, index: number) => (
                      <span key={index} className="px-2 py-0.5 bg-green-100 text-green-400 text-xs rounded">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 优化建议 */}
          {optimizationData.suggestions && optimizationData.suggestions.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 mr-3 flex-shrink-0" />
                <div className="text-sm text-yellow-800">
                  <p className="font-medium mb-2">优化建议</p>
                  <ul className="text-yellow-400 space-y-1">
                    {optimizationData.suggestions.map((suggestion, index) => (
                      <li key={index}>• {suggestion}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-center space-x-3">
            <button
              onClick={handleOptimize}
              disabled={isOptimizing}
              className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A] flex items-center disabled:opacity-50"
            >
              <Sparkles size={16} className="mr-2" />
              重新优化
            </button>
            <button
              onClick={handleApplyOptimized}
              className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center"
            >
              <CheckCircle size={16} className="mr-2" />
              应用优化
            </button>
          </div>
        </div>
      )}

      {/* 导航按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <button
          onClick={onPrevious}
          disabled={isOptimizing}
          className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A] disabled:opacity-50"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          完成创建
        </button>
      </div>
    </div>
  );
}

// 对比区域组件
function CompareSection({
  title,
  original,
  optimized,
  isExpanded,
  onToggle,
  onCopy,
  copied,
  isCode = false,
}: {
  title: string;
  original: string;
  optimized: string;
  isExpanded: boolean;
  onToggle: () => void;
  onCopy: (text: string) => void;
  copied: boolean;
  isCode?: boolean;
}) {
  return (
    <div className="bg-dark-surface border border-gray-700/50 rounded-lg overflow-hidden">
      <div 
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-[#0F172A]"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-gray-300">{title}</h4>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
        <div className="flex items-center gap-2">
          {optimized !== original && (
            <span className="px-2 py-0.5 bg-green-100 text-green-400 text-xs rounded">已优化</span>
          )}
        </div>
      </div>
      
      {isExpanded && (
        <div className="border-t border-gray-700/50">
          <div className="grid grid-cols-2 divide-x divide-gray-700/50">
            {/* 原始 */}
            <div className="p-4 bg-[#0F172A]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">原始</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onCopy(original); }}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  复制
                </button>
              </div>
              <div className={`text-sm text-gray-300 ${isCode ? 'font-mono text-xs whitespace-pre-wrap' : ''}`}>
                {original || <span className="text-gray-400 italic">无</span>}
              </div>
            </div>
            
            {/* 优化后 */}
            <div className="p-4 bg-green-900/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-green-400">优化后</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onCopy(optimized); }}
                  className="text-xs text-green-400 hover:text-green-800"
                >
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <div className={`text-sm text-gray-100 ${isCode ? 'font-mono text-xs whitespace-pre-wrap' : ''}`}>
                {optimized || <span className="text-gray-400 italic">无</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
