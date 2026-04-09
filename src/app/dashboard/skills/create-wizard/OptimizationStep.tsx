'use client';

import { useState } from 'react';
import { Sparkles, CheckCircle, TrendingUp, AlertCircle, Copy } from 'lucide-react';

interface Props {
  skillData: any;
  optimizationData: {
    originalDescription: string;
    optimizedDescription: string;
    triggerAccuracy: number;
  };
  onChange: (data: any) => void;
  onNext: () => void;
  onPrevious: () => void;
}

export default function OptimizationStep({ skillData, optimizationData, onChange, onNext, onPrevious }: Props) {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleOptimize = async () => {
    setIsOptimizing(true);
    try {
      const token = localStorage.getItem('token');
      
      // TODO: 调用真实的优化 API
      // const response = await fetch('/api/skills/optimize-description', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     Authorization: `Bearer ${token}`,
      //   },
      //   body: JSON.stringify({ skillData }),
      // });

      // 模拟优化过程
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 模拟优化结果
      const optimizedDescription = generateOptimizedDescription(skillData);
      const triggerAccuracy = 0.75 + Math.random() * 0.2; // 75-95%

      onChange({
        optimization: {
          originalDescription: skillData.description,
          optimizedDescription,
          triggerAccuracy,
        },
      });
    } catch (error) {
      console.error('优化失败:', error);
      alert('优化失败，请重试');
    } finally {
      setIsOptimizing(false);
    }
  };

  const generateOptimizedDescription = (skill: any): string => {
    const parts = [
      skill.description,
      '',
      '使用场景：',
      `- ${skill.category === 'code-audit' ? '代码安全审计' : '安全检测'}`,
      `- 安全问题检测`,
    ];

    if (skill.tools && skill.tools.length > 0) {
      parts.push('', `使用工具：${skill.tools.join(', ')}`);
    }

    parts.push('', '触发关键词：代码审查、安全扫描、漏洞检测');

    return parts.join('\n');
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(optimizationData.optimizedDescription);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyOptimized = () => {
    // 将优化后的描述应用到 Skill
    onChange({
      skill: {
        ...skillData,
        description: optimizationData.optimizedDescription,
      },
    });
    alert('已应用优化后的描述！');
  };

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
        <div className="flex items-start">
          <Sparkles className="w-5 h-5 text-indigo-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-indigo-800">
            <p className="font-medium mb-2">描述优化</p>
            <p className="text-indigo-700">
              优化 Skill 的描述可以提高触发准确性。我们会生成更详细、更具描述性的内容，
              帮助 Claude 更好地识别何时应该使用这个 Skill。
            </p>
          </div>
        </div>
      </div>

      {/* 当前描述 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">当前描述</h3>
        <p className="text-gray-900">{skillData.description}</p>
      </div>

      {/* 优化按钮 */}
      {!optimizationData.optimizedDescription && (
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
                开始优化描述
              </>
            )}
          </button>
        </div>
      )}

      {/* 优化结果 */}
      {optimizationData.optimizedDescription && (
        <div className="space-y-4">
          {/* 准确率 */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">预估触发准确率</span>
              <TrendingUp className="w-5 h-5 text-green-500" />
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-green-500 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${optimizationData.triggerAccuracy * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-2xl font-bold text-green-600">
                {(optimizationData.triggerAccuracy * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          {/* 对比 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 原始描述 */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700">原始描述</h3>
                <span className="text-xs text-gray-500">之前</span>
              </div>
              <p className="text-sm text-gray-900">{optimizationData.originalDescription}</p>
            </div>

            {/* 优化后描述 */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-green-700">优化后描述</h3>
                <span className="text-xs text-green-600">推荐</span>
              </div>
              <p className="text-sm text-gray-900">{optimizationData.optimizedDescription}</p>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-center space-x-3">
            <button
              onClick={handleCopy}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 flex items-center"
            >
              {copied ? (
                <>
                  <CheckCircle size={16} className="mr-2 text-green-600" />
                  已复制
                </>
              ) : (
                <>
                  <Copy size={16} className="mr-2" />
                  复制
                </>
              )}
            </button>
            <button
              onClick={handleOptimize}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 flex items-center"
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

      {/* 优化建议 */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-yellow-800">
            <p className="font-medium mb-2">优化建议</p>
            <ul className="text-yellow-700 space-y-1">
              <li>• 描述应该明确说明 Skill 的功能和用途</li>
              <li>• 包含触发关键词可以帮助 Claude 更准确地识别</li>
              <li>• 描述使用场景和适用范围</li>
              <li>• 保持简洁但信息丰富</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 导航按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <button
          onClick={onPrevious}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
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
