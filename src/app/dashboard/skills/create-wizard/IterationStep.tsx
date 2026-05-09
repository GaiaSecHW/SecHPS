'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, RefreshCw, ArrowRight, FileText, BarChart2 } from 'lucide-react';

interface TestRun {
  id: string;
  testCaseId: string;
  testCaseName: string;
  type: 'with_skill' | 'without_skill';
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  duration?: number;
  tokens?: number;
  error?: string;
}

interface Props {
  evaluationData: {
    runs: TestRun[];
  };
  skillData: any;
  iterations: any[];
  onChange: (data: any) => void;
  onNext: () => void;
  onPrevious: () => void;
  onRerunTests: () => void;
}

export default function IterationStep({ evaluationData, skillData, iterations, onChange, onNext, onPrevious, onRerunTests }: Props) {
  const [feedback, setFeedback] = useState('');
  const [isApplyingChanges, setIsApplyingChanges] = useState(false);

  const { runs } = evaluationData;
  
  // 确保 runs 是数组
  const runsArray = Array.isArray(runs) ? runs : [];
  
  // 分组测试结果
  const groupedResults: Record<string, { withSkill?: TestRun; withoutSkill?: TestRun }> = {};
  runsArray.forEach((run) => {
    if (!groupedResults[run.testCaseId]) {
      groupedResults[run.testCaseId] = {};
    }
    if (run.type === 'with_skill') {
      groupedResults[run.testCaseId].withSkill = run;
    } else {
      groupedResults[run.testCaseId].withoutSkill = run;
    }
  });

  // 对比分析
  const compareResults = (withSkill?: TestRun, withoutSkill?: TestRun) => {
    if (!withSkill || !withoutSkill) return null;

    const improvements: string[] = [];
    const regressions: string[] = [];

    // 简单的对比逻辑（实际应该更复杂）
    if (withSkill.output && withoutSkill.output) {
      const withSkillLength = withSkill.output.length;
      const withoutSkillLength = withoutSkill.output.length;

      if (withSkillLength > withoutSkillLength * 1.5) {
        improvements.push('输出更详细、更全面');
      }

      if (withSkill.output.includes('修复建议') && !withoutSkill.output.includes('修复建议')) {
        improvements.push('提供了具体的修复建议');
      }

      if (withSkill.output.includes('风险等级') && !withoutSkill.output.includes('风险等级')) {
        improvements.push('包含了风险分级');
      }

      if (withSkill.tokens && withoutSkill.tokens && withSkill.tokens < withoutSkill.tokens) {
        improvements.push('Token 使用更高效');
      }
    }

    return { improvements, regressions };
  };

  const handleApplyFeedback = async () => {
    if (!feedback.trim()) return;

    setIsApplyingChanges(true);
    try {
      // TODO: 调用 API 分析反馈并生成改进建议
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 记录迭代
      const newIteration = {
        version: iterations.length + 1,
        changes: '根据用户反馈优化',
        feedback: feedback.trim(),
        timestamp: new Date().toISOString(),
      };

      onChange({ iterations: [...iterations, newIteration] });
      setFeedback('');

      toast.success('改进已应用，请运行新测试用例验证效果！');
    } catch (error) {
      console.error('应用反馈失败:', error);
      toast.error('应用失败，请重试');
    } finally {
      setIsApplyingChanges(false);
    }
  };

  // 统计数据
  const completedRuns = runsArray.filter((r) => r.status === 'completed');
  const avgDurationWithSkill = 
    completedRuns
      .filter((r) => r.type === 'with_skill' && r.duration)
      .reduce((sum, r) => sum + (r.duration || 0), 0) / 
    completedRuns.filter((r) => r.type === 'with_skill').length || 0;

  const avgTokensWithSkill = 
    completedRuns
      .filter((r) => r.type === 'with_skill' && r.tokens)
      .reduce((sum, r) => sum + (r.tokens || 0), 0) / 
    completedRuns.filter((r) => r.type === 'with_skill').length || 0;

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="bg-purple-900/20 border border-purple-200 rounded-lg p-4">
        <div className="flex items-start">
          <RefreshCw className="w-5 h-5 text-purple-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-purple-800">
            <p className="font-medium mb-2">迭代改进</p>
            <p className="text-purple-700">
              对比有 Skill 和无 Skill 的测试结果，发现改进点。你可以提供反馈，我们会帮助你优化 Skill。
            </p>
          </div>
        </div>
      </div>

      {/* 统计对比 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-300">平均耗时</span>
            <BarChart2 className="w-5 h-5 text-gray-400" />
          </div>
          <div className="text-2xl font-bold text-gray-100">
            {avgDurationWithSkill.toFixed(0)}ms
          </div>
        </div>
        <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-300">平均 Token 使用</span>
            <BarChart2 className="w-5 h-5 text-gray-400" />
          </div>
          <div className="text-2xl font-bold text-gray-100">
            {avgTokensWithSkill.toFixed(0)}
          </div>
        </div>
      </div>

      {/* 结果对比 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-100">测试结果对比</h3>
        {Object.entries(groupedResults).map(([testCaseId, results]) => {
          const comparison = compareResults(results.withSkill, results.withoutSkill);

          return (
            <div key={testCaseId} className="bg-dark-surface border border-gray-700/50 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-[#0F172A] border-b border-gray-700/50">
                <h4 className="font-medium text-gray-100">{results.withSkill?.testCaseName || '测试用例'}</h4>
              </div>

              {/* 对比分析 */}
              {comparison && (comparison.improvements.length > 0 || comparison.regressions.length > 0) && (
                <div className="px-4 py-3 border-b border-gray-700/50 bg-blue-900/20">
                  <h5 className="text-sm font-medium text-gray-100 mb-2">分析结果</h5>
                  {comparison.improvements.length > 0 && (
                    <div className="space-y-1">
                      {comparison.improvements.map((improvement, i) => (
                        <div key={i} className="flex items-center text-sm text-green-400">
                          <CheckCircle className="w-4 h-4 mr-2" />
                          {improvement}
                        </div>
                      ))}
                    </div>
                  )}
                  {comparison.regressions.length > 0 && (
                    <div className="space-y-1 mt-2">
                      {comparison.regressions.map((regression, i) => (
                        <div key={i} className="flex items-center text-sm text-red-400">
                          <XCircle className="w-4 h-4 mr-2" />
                          {regression}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 详细输出 */}
              <div className="grid grid-cols-2 divide-x divide-gray-700/50">
                {/* With Skill */}
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-green-400">使用 Skill</span>
                    {results.withSkill?.duration && (
                      <span className="text-xs text-gray-500">{results.withSkill.duration}ms</span>
                    )}
                  </div>
                  <pre className="text-xs bg-[#0F172A] p-2 rounded overflow-auto max-h-40">
                    {results.withSkill?.output || '无输出'}
                  </pre>
                </div>

                {/* Without Skill */}
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-300">不使用 Skill</span>
                    {results.withoutSkill?.duration && (
                      <span className="text-xs text-gray-500">{results.withoutSkill.duration}ms</span>
                    )}
                  </div>
                  <pre className="text-xs bg-[#0F172A] p-2 rounded overflow-auto max-h-40">
                    {results.withoutSkill?.output || '无输出'}
                  </pre>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 迭代历史 */}
      {iterations.length > 0 && (
        <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
          <h3 className="text-lg font-medium text-gray-100 mb-3">迭代历史</h3>
          <div className="space-y-3">
            {iterations.map((iteration, index) => (
              <div key={index} className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-400 flex items-center justify-center font-medium">
                  {iteration.version}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-100">{iteration.changes}</div>
                  <div className="text-xs text-gray-500 mt-1">{iteration.feedback}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {new Date(iteration.timestamp).toLocaleString('zh-CN')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 反馈输入 */}
      <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
        <h3 className="text-lg font-medium text-gray-100 mb-3">提供反馈</h3>
        <p className="text-sm text-gray-400 mb-3">
          告诉我们你对测试结果的看法，以及你希望如何改进 Skill。我们会分析你的反馈并生成优化建议。
        </p>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={4}
          placeholder="例如：&#10;- 输出太长，希望更简洁&#10;- 漏报了某些类型的漏洞&#10;- 修复建议不够具体..."
          className="w-full px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        <div className="flex justify-end space-x-3 mt-3">
          <button
            onClick={onRerunTests}
            className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A] flex items-center"
          >
            <RefreshCw size={16} className="mr-2" />
            重新测试
          </button>
          <button
            onClick={handleApplyFeedback}
            disabled={!feedback.trim() || isApplyingChanges}
            className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 flex items-center"
          >
            {isApplyingChanges ? (
              <>
                <RefreshCw size={16} className="mr-2 animate-spin" />
                应用中...
              </>
            ) : (
              <>
                <ArrowRight size={16} className="mr-2" />
                应用反馈
              </>
            )}
          </button>
        </div>
      </div>

      {/* 导航按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <button
          onClick={onPrevious}
          className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A]"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          下一步：优化描述
        </button>
      </div>
    </div>
  );
}
