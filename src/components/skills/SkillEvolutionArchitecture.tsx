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
    <div className={`bg-dark-surface rounded-lg shadow border border-gray-700/50 ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-700/50 bg-gradient-to-r from-blue-900/30 to-indigo-900/30">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <RefreshCw className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-blue-300">Skill 自我进化架构</h2>
            <p className="text-sm text-gray-300">基于误报学习的精准率优化系统</p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* 进化流程图 */}
        <div className="border border-gray-700/50 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('flow')}
            className="w-full px-4 py-3 flex items-center justify-between bg-[#0F172A] hover:bg-dark-surface-hover transition-colors"
          >
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-blue-500" />
              <span className="font-medium text-gray-100">进化流程</span>
            </div>
            {expandedSection === 'flow' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {expandedSection === 'flow' && (
            <div className="px-4 py-6">
              {/* 流程图 */}
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                {/* Step 1: 数据收集 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mb-2">
                    <Database className="h-7 w-7 text-blue-400" />
                  </div>
                  <span className="text-sm font-medium text-gray-100">数据收集</span>
                  <span className="text-xs text-gray-500 mt-1">SkillExecution + Vulnerability</span>
                </div>

                <ArrowRight className="h-5 w-5 text-gray-400 hidden md:block" />

                {/* Step 2: 指标计算 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-2">
                    <BarChart3 className="h-7 w-7 text-green-400" />
                  </div>
                  <span className="text-sm font-medium text-gray-100">指标计算</span>
                  <span className="text-xs text-gray-500 mt-1">精准率 / 误报率</span>
                </div>

                <ArrowRight className="h-5 w-5 text-gray-400 hidden md:block" />

                {/* Step 3: 案例提取 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center mb-2">
                    <FileText className="h-7 w-7 text-yellow-400" />
                  </div>
                  <span className="text-sm font-medium text-gray-100">案例提取</span>
                  <span className="text-xs text-gray-500 mt-1">误报 + 正确发现</span>
                </div>

                <ArrowRight className="h-5 w-5 text-gray-400 hidden md:block" />

                {/* Step 4: LLM 分析 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center mb-2">
                    <Brain className="h-7 w-7 text-purple-400" />
                  </div>
                  <span className="text-sm font-medium text-gray-100">LLM 分析</span>
                  <span className="text-xs text-gray-500 mt-1">平衡改进建议</span>
                </div>

                <ArrowRight className="h-5 w-5 text-gray-400 hidden md:block" />

                {/* Step 5: 人工审批 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mb-2">
                    <CheckCircle className="h-7 w-7 text-orange-400" />
                  </div>
                  <span className="text-sm font-medium text-gray-100">人工审批</span>
                  <span className="text-xs text-gray-500 mt-1">应用 / 拒绝</span>
                </div>

                <ArrowRight className="h-5 w-5 text-gray-400 hidden md:block" />

                {/* Step 6: 效果对比 */}
                <div className="flex flex-col items-center text-center w-full md:w-auto">
                  <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-2">
                    <GitCompare className="h-7 w-7 text-red-400" />
                  </div>
                  <span className="text-sm font-medium text-gray-100">效果对比</span>
                  <span className="text-xs text-gray-500 mt-1">新版本验证</span>
                </div>
              </div>

              {/* 关键公式 */}
              <div className="mt-6 p-4 bg-[#0F172A] rounded-lg border border-gray-700/50">
                <h4 className="text-sm font-medium text-gray-300 mb-3">关键公式</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="p-3 bg-dark-surface rounded border border-gray-700/50">
                    <span className="text-gray-400">精准率 = </span>
                    <span className="font-mono text-blue-400">confirmed / (confirmed + falsePositive)</span>
                  </div>
                  <div className="p-3 bg-dark-surface rounded border border-gray-700/50">
                    <span className="text-gray-400">误报率 = </span>
                    <span className="font-mono text-red-400">falsePositive / totalFindings</span>
                  </div>
                  <div className="p-3 bg-dark-surface rounded border border-gray-700/50">
                    <span className="text-gray-400">F1 Score = </span>
                    <span className="font-mono text-green-400">2 * (P * R) / (P + R)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 触发条件 */}
        <div className="border border-gray-700/50 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('trigger')}
            className="w-full px-4 py-3 flex items-center justify-between bg-[#0F172A] hover:bg-dark-surface-hover transition-colors"
          >
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-red-500" />
              <span className="font-medium text-gray-100">触发条件</span>
            </div>
            {expandedSection === 'trigger' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {expandedSection === 'trigger' && (
            <div className="px-4 py-4">
              <div className="space-y-3">
                <div className="flex items-center gap-4 p-3 bg-red-900/20 rounded-lg border border-red-500/30">
                  <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-red-300">精准率低于阈值</span>
                    <p className="text-sm text-gray-300">precision &lt; 0.7（默认）时触发进化</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-3 bg-orange-900/20 rounded-lg border border-orange-500/30">
                  <AlertTriangle className="h-5 w-5 text-orange-400 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-orange-300">误报数超标</span>
                    <p className="text-sm text-gray-300">falsePositiveCount ≥ 5（默认）时触发进化</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-3 bg-blue-900/20 rounded-lg border border-blue-500/30">
                  <CheckCircle className="h-5 w-5 text-blue-400 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-blue-300">最小数据要求</span>
                    <p className="text-sm text-gray-300">需同时有 ≥3 个正确发现和 ≥5 个误报案例</p>
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
