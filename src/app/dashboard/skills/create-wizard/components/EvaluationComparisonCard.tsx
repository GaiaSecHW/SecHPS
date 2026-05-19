'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle, XCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { SkillEvaluationComparison, ExpectationComparison } from '@/types/evaluation';

interface EvaluationComparisonCardProps {
  comparison: SkillEvaluationComparison;
}

export default function EvaluationComparisonCard({ comparison }: EvaluationComparisonCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs.toFixed(0)}s`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens < 1000) return tokens.toString();
    return `${(tokens / 1000).toFixed(1)}K`;
  };

  const getDeltaIcon = (delta: number) => {
    if (delta > 0) return <TrendingUp className="w-4 h-4 text-green-400" />;
    if (delta < 0) return <TrendingDown className="w-4 h-4 text-red-400" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getDeltaColor = (delta: number, isBetter: boolean) => {
    if (delta === 0) return 'text-gray-400';
    return delta > 0 ? (isBetter ? 'text-green-400' : 'text-red-400') : (isBetter ? 'text-red-400' : 'text-green-400');
  };

  const withSkill = comparison.with_skill_run;
  const withoutSkill = comparison.without_skill_run;

  const passRateDelta = comparison.pass_rate_delta;
  const timeDelta = comparison.time_delta;
  const tokenDelta = comparison.token_delta;

  return (
    <div className="bg-dark-surface border border-gray-700/50 rounded-lg overflow-hidden">
      {/* 头部：测试用例名称 */}
      <div className="px-4 py-3 bg-[#0F172A] border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-gray-100">{comparison.eval_name}</h4>
            <p className="text-xs text-gray-500 mt-1">评估 ID: #{comparison.eval_id}</p>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center space-x-1 px-3 py-1 text-sm text-gray-400 hover:text-gray-200 hover:bg-dark-surface-hover rounded"
          >
            <span>{isExpanded ? '收起' : '展开'}</span>
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* 对比面板 */}
      <div className="grid grid-cols-2 divide-x divide-gray-700/50">
        {/* With Skill */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h5 className="text-sm font-medium text-gray-100">使用 Skill</h5>
            {withSkill.result.pass_rate === 100 ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : withSkill.result.pass_rate >= 80 ? (
              <CheckCircle className="w-5 h-5 text-yellow-500" />
            ) : (
              <XCircle className="w-5 h-5 text-red-500" />
            )}
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">通过率:</span>
              <span className={`font-medium ${withSkill.result.pass_rate === 100 ? 'text-green-400' : withSkill.result.pass_rate >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
                {withSkill.result.pass_rate.toFixed(0)}% ({withSkill.result.passed}/{withSkill.result.total})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">耗时:</span>
              <span className="text-gray-100">{formatTime(withSkill.result.time_seconds)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Token:</span>
              <span className="text-gray-100">{formatTokens(withSkill.result.tokens)}</span>
            </div>
          </div>
        </div>

        {/* Without Skill */}
        <div className="p-4 bg-[#0F172A]">
          <div className="flex items-center justify-between mb-3">
            <h5 className="text-sm font-medium text-gray-300">不使用 Skill (基线)</h5>
            {withoutSkill.result.pass_rate === 100 ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : withoutSkill.result.pass_rate >= 80 ? (
              <CheckCircle className="w-5 h-5 text-yellow-500" />
            ) : (
              <XCircle className="w-5 h-5 text-red-500" />
            )}
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">通过率:</span>
              <span className={`font-medium ${withoutSkill.result.pass_rate === 100 ? 'text-green-400' : withoutSkill.result.pass_rate >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
                {withoutSkill.result.pass_rate.toFixed(0)}% ({withoutSkill.result.passed}/{withoutSkill.result.total})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">耗时:</span>
              <span className="text-gray-100">{formatTime(withoutSkill.result.time_seconds)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Token:</span>
              <span className="text-gray-100">{formatTokens(withoutSkill.result.tokens)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 差异统计 */}
      <div className="px-4 py-3 bg-blue-500/10 border-t border-blue-500/30">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1">
              {getDeltaIcon(passRateDelta)}
              <span className={getDeltaColor(passRateDelta, true)}>通过率 {passRateDelta > 0 ? '+' : ''}{passRateDelta.toFixed(0)}%</span>
            </div>
            <div className="flex items-center space-x-1">
              {getDeltaIcon(-timeDelta)}
              <span className={getDeltaColor(-timeDelta, true)}>耗时 {timeDelta > 0 ? '+' : ''}{timeDelta.toFixed(1)}s</span>
            </div>
            <div className="flex items-center space-x-1">
              {getDeltaIcon(-tokenDelta)}
              <span className={getDeltaColor(-tokenDelta, true)}>Token {tokenDelta > 0 ? '+' : ''}{formatTokens(tokenDelta)}</span>
            </div>
          </div>
          <div className="text-xs text-gray-400">
            <span className="text-green-400">↑{comparison.improved_count} 改进</span>
            <span className="mx-2">|</span>
            <span className="text-red-400">↓{comparison.regressed_count} 回退</span>
          </div>
        </div>
      </div>

      {/* 展开的断言详情 */}
      {isExpanded && comparison.expectation_comparisons.length > 0 && (
        <div className="border-t border-gray-700/50">
          <div className="px-4 py-3 bg-[#0F172A] border-b border-gray-700/50">
            <h5 className="text-sm font-medium text-gray-100">断言对比详情</h5>
          </div>
          <div className="divide-y divide-gray-100">
            {comparison.expectation_comparisons.map((expectation, index) => (
              <ExpectationItem key={index} expectation={expectation} index={index} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 断言项组件
function ExpectationItem({ expectation, index }: { expectation: ExpectationComparison; index: number }) {
  const [showEvidence, setShowEvidence] = useState(false);

  const getStatusBadge = (passed: boolean) => {
    return passed ? (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
        ✓ 通过
      </span>
    ) : (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
        ✗ 失败
      </span>
    );
  };

  const getChangeIndicator = () => {
    switch (expectation.status_change) {
      case 'improved':
        return <span className="text-xs text-green-400 font-medium">↑ 改进</span>;
      case 'regressed':
        return <span className="text-xs text-red-400 font-medium">↓ 回退</span>;
      case 'both_pass':
        return <span className="text-xs text-green-400">✓ 都通过</span>;
      case 'both_fail':
        return <span className="text-xs text-gray-500">✗ 都失败</span>;
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1">
            <span className="text-xs text-gray-400">#{index + 1}</span>
            <span className="text-sm text-gray-100">{expectation.text}</span>
            {expectation.type && (
              <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-400 rounded">
                {expectation.type}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-4 text-xs">
            <div className="flex items-center space-x-1">
              <span className="text-gray-500">With Skill:</span>
              {getStatusBadge(expectation.with_skill_passed)}
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-gray-500">Without:</span>
              {getStatusBadge(expectation.without_skill_passed)}
            </div>
            <div>{getChangeIndicator()}</div>
            <button
              onClick={() => setShowEvidence(!showEvidence)}
              className="text-blue-400 hover:text-blue-300"
            >
              {showEvidence ? '隐藏证据' : '查看证据'}
            </button>
          </div>
        </div>
      </div>
      
      {showEvidence && (
        <div className="mt-3 space-y-2">
          {expectation.with_skill_evidence && (
            <div className="bg-green-900/20 border border-green-200 rounded p-2">
              <div className="text-xs font-medium text-green-800 mb-1">With Skill 证据:</div>
              <p className="text-xs text-green-400 whitespace-pre-wrap">{expectation.with_skill_evidence}</p>
            </div>
          )}
          {expectation.without_skill_evidence && (
            <div className="bg-[#0F172A] border border-gray-700/50 rounded p-2">
              <div className="text-xs font-medium text-gray-200 mb-1">Without Skill 证据:</div>
              <p className="text-xs text-gray-300 whitespace-pre-wrap">{expectation.without_skill_evidence}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
