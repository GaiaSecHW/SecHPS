'use client';

import { useState } from 'react';
import {
  Brain,
  Target,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  RefreshCw,
  Database,
  FileText,
  GitCompare,
  ChevronDown,
  ChevronUp,
  BarChart3,
} from 'lucide-react';

interface Props {
  className?: string;
}

export function SkillEvolutionArchitecture({ className = '' }: Props) {
  const [expandedSection, setExpandedSection] = useState<string | null>('flow');

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className={`bg-white rounded-lg shadow border border-gray-200 ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <RefreshCw className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Skill 自我进化架构</h2>
            <p className="text-sm text-gray-600">基于误报学习的精准率优化系统</p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* 进化流程图 */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('flow')}
            className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-blue-500" />
              <span className="font-medium text-gray-900">进化流程</span>
            </div>
            {expandedSection === 'flow' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {expandedSection === 'flow' && (
            <div className="px-4 py-6">
              {/* 流程图 */}
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                {/* Step 1: 数据收集 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-2">
                    <Database className="h-7 w-7 text-blue-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-900">数据收集</span>
                  <span className="text-xs text-gray-500 mt-1">SkillExecution + Vulnerability</span>
                </div>

                <ArrowRight className="h-5 w-5 text-gray-400 hidden md:block" />

                {/* Step 2: 指标计算 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-2">
                    <BarChart3 className="h-7 w-7 text-green-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-900">指标计算</span>
                  <span className="text-xs text-gray-500 mt-1">精准率 / 误报率</span>
                </div>

                <ArrowRight className="h-5 w-5 text-gray-400 hidden md:block" />

                {/* Step 3: 案例提取 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mb-2">
                    <FileText className="h-7 w-7 text-yellow-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-900">案例提取</span>
                  <span className="text-xs text-gray-500 mt-1">误报 + 正确发现</span>
                </div>

                <ArrowRight className="h-5 w-5 text-gray-400 hidden md:block" />

                {/* Step 4: LLM 分析 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center mb-2">
                    <Brain className="h-7 w-7 text-purple-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-900">LLM 分析</span>
                  <span className="text-xs text-gray-500 mt-1">平衡改进建议</span>
                </div>

                <ArrowRight className="h-5 w-5 text-gray-400 hidden md:block" />

                {/* Step 5: 人工审批 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center mb-2">
                    <CheckCircle className="h-7 w-7 text-orange-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-900">人工审批</span>
                  <span className="text-xs text-gray-500 mt-1">应用 / 拒绝</span>
                </div>

                <ArrowRight className="h-5 w-5 text-gray-400 hidden md:block" />

                {/* Step 6: 效果对比 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-2">
                    <GitCompare className="h-7 w-7 text-red-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-900">效果对比</span>
                  <span className="text-xs text-gray-500 mt-1">新版本验证</span>
                </div>
              </div>

              {/* 关键公式 */}
              <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3">关键公式</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="p-3 bg-white rounded border border-gray-100">
                    <span className="text-gray-600">精准率 = </span>
                    <span className="font-mono text-blue-600">confirmed / (confirmed + falsePositive)</span>
                  </div>
                  <div className="p-3 bg-white rounded border border-gray-100">
                    <span className="text-gray-600">误报率 = </span>
                    <span className="font-mono text-red-600">falsePositive / totalFindings</span>
                  </div>
                  <div className="p-3 bg-white rounded border border-gray-100">
                    <span className="text-gray-600">F1 Score = </span>
                    <span className="font-mono text-green-600">2 * (P * R) / (P + R)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 触发条件 */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('trigger')}
            className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-red-500" />
              <span className="font-medium text-gray-900">触发条件</span>
            </div>
            {expandedSection === 'trigger' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {expandedSection === 'trigger' && (
            <div className="px-4 py-4">
              <div className="space-y-3">
                <div className="flex items-center gap-4 p-3 bg-red-50 rounded-lg border border-red-200">
                  <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-red-800">精准率低于阈值</span>
                    <p className="text-sm text-red-600">precision &lt; 0.7（默认）时触发进化</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-3 bg-orange-50 rounded-lg border border-orange-200">
                  <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-orange-800">误报数超标</span>
                    <p className="text-sm text-orange-600">falsePositiveCount ≥ 5（默认）时触发进化</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <CheckCircle className="h-5 w-5 text-blue-500 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-blue-800">最小数据要求</span>
                    <p className="text-sm text-blue-600">需同时有 ≥3 个正确发现和 ≥5 个误报案例</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
