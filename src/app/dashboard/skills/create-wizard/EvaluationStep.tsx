'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import { 
  Play, CheckCircle, XCircle, Clock, AlertCircle, RefreshCw, 
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Eye, EyeOff
} from 'lucide-react';
import type { 
  SkillEvaluationComparison,
  ExpectationComparison,
} from '@/types/evaluation';

interface TestCase {
  id: string;
  name: string;
  prompt: string;
  expectedOutput?: string;
  testFiles?: string[];
}

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
  skillData: any;
  testCases: TestCase[];
  evaluationData: {
    runs: TestRun[];
  };
  onChange: (data: any) => void;
  onNext: () => void;
  onPrevious: () => void;
}

export default function EvaluationStep({ skillData, testCases, evaluationData, onChange, onNext, onPrevious }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [runs, setRuns] = useState<TestRun[]>(evaluationData.runs || []);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    onChange({ evaluation: { runs } });
  }, [runs]);

  const startEvaluation = async () => {
    if (testCases.length === 0) {
      toast.error('请先添加测试用例');
      return;
    }

    setIsRunning(true);
    setProgress({ current: 0, total: testCases.length * 2 });

    // 初始化测试运行
    const initialRuns: TestRun[] = [];
    testCases.forEach((tc) => {
      initialRuns.push({
        id: `${tc.id}-with-skill`,
        testCaseId: tc.id,
        testCaseName: tc.name,
        type: 'with_skill',
        status: 'pending',
      });
      initialRuns.push({
        id: `${tc.id}-without-skill`,
        testCaseId: tc.id,
        testCaseName: tc.name,
        type: 'without_skill',
        status: 'pending',
      });
    });
    setRuns(initialRuns);

    await runTests(initialRuns);
  };

  // 运行测试（可重试单个或全部）
  const runTests = async (runsToExecute: TestRun[], isRetry: boolean = false) => {
    const token = localStorage.getItem('token');

    if (isRetry) {
      setIsRunning(true);
    }

    // 并行运行所有测试
    const runPromises = runsToExecute.map(async (run) => {
      const testCase = testCases.find((tc) => tc.id === run.testCaseId);
      if (!testCase) return run;

      // 更新状态为运行中，清除旧的错误和输出
      setRuns((prev) =>
        prev.map((r) => 
          r.id === run.id 
            ? { ...r, status: 'running', error: undefined, output: undefined } 
            : r
        )
      );

      try {
        const response = await fetch('/api/skills/test-runs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            testCase,
            skillData,
            runType: run.type,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || '测试运行失败');
        }

        const data = await response.json();

        // 更新进度
        setProgress((prev) => ({ ...prev, current: prev.current + 1 }));

        const result = {
          ...run,
          status: 'completed' as const,
          output: data.output,
          duration: data.duration,
          tokens: data.tokens,
          error: undefined, // 清除错误
        };

        setRuns((prev) => prev.map((r) => (r.id === run.id ? result : r)));
        return result;
      } catch (error) {
        setProgress((prev) => ({ ...prev, current: prev.current + 1 }));
        const result = {
          ...run,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : '未知错误',
        };
        setRuns((prev) => prev.map((r) => (r.id === run.id ? result : r)));
        return result;
      }
    });

    await Promise.all(runPromises);
    setIsRunning(false);
  };

  // 重试单个测试
  const retryTest = async (runId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;

    setProgress({ current: 0, total: 1 });

    // 运行该测试（isRetry=true）
    await runTests([{ ...run, status: 'pending', error: undefined, output: undefined }], true);
  };

  // 重试所有失败的测试
  const retryFailed = async () => {
    const failedRuns = runs.filter((r) => r.status === 'failed');
    if (failedRuns.length === 0) return;

    setProgress({ current: 0, total: failedRuns.length });

    // 运行所有失败的测试（isRetry=true）
    await runTests(
      failedRuns.map((r) => ({ ...r, status: 'pending', error: undefined, output: undefined })),
      true
    );
  };

  const getStatusIcon = (status: TestRun['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-5 h-5 text-gray-400" />;
      case 'running':
        return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const getStatusText = (status: TestRun['status']) => {
    switch (status) {
      case 'pending':
        return '等待中';
      case 'running':
        return '运行中';
      case 'completed':
        return '已完成';
      case 'failed':
        return '失败';
    }
  };

  const completedCount = runs.filter((r) => r.status === 'completed').length;
  const failedCount = runs.filter((r) => r.status === 'failed').length;

  const canProceed = runs.length > 0 && !isRunning && completedCount + failedCount === runs.length;

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="bg-green-900/20 border border-green-200 rounded-lg p-4">
        <div className="flex items-start">
          <Play className="w-5 h-5 text-green-400 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-green-800">
            <p className="font-medium mb-2">评估说明</p>
            <p className="text-green-400">
              我们会对每个测试用例运行两次：一次使用你的 Skill，一次不使用。
              对比两者的效果，帮助你改进 Skill 质量。
            </p>
          </div>
        </div>
      </div>

      {/* 统计信息 */}
      {runs.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400">总测试数</div>
            <div className="text-2xl font-bold text-gray-100">{runs.length}</div>
          </div>
          <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400">已完成</div>
            <div className="text-2xl font-bold text-green-400">{completedCount}</div>
          </div>
          <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400">失败</div>
            <div className="text-2xl font-bold text-red-400">{failedCount}</div>
          </div>
          <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400">进度</div>
            <div className="text-2xl font-bold text-blue-400">
              {progress.current}/{progress.total}
            </div>
          </div>
        </div>
      )}

      {/* 进度条 */}
      {isRunning && (
        <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-300">运行进度</span>
            <span className="text-sm text-gray-400">
              {progress.current}/{progress.total}
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 运行按钮 */}
      <div className="flex justify-center gap-4">
        <button
          onClick={startEvaluation}
          disabled={isRunning || testCases.length === 0}
          className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          {isRunning ? (
            <>
              <RefreshCw size={20} className="mr-2 animate-spin" />
              运行中...
            </>
          ) : (
            <>
              <Play size={20} className="mr-2" />
              {runs.length > 0 ? '重新评估' : '开始评估'}
            </>
          )}
        </button>

        {failedCount > 0 && !isRunning && (
          <button
            onClick={retryFailed}
            className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center"
          >
            <RefreshCw size={20} className="mr-2" />
            重试失败项 ({failedCount})
          </button>
        )}
      </div>

      {/* 测试用例列表 */}
      {runs.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-100">测试运行详情</h3>
          {testCases.map((tc) => {
            const withSkillRun = runs.find((r) => r.testCaseId === tc.id && r.type === 'with_skill');
            const withoutSkillRun = runs.find((r) => r.testCaseId === tc.id && r.type === 'without_skill');

            return (
              <div key={tc.id} className="bg-dark-surface border border-gray-700/50 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-[#0F172A] border-b border-gray-700/50">
                  <h4 className="font-medium text-gray-100">{tc.name}</h4>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-1">{tc.prompt}</p>
                </div>
                <div className="divide-y divide-gray-700/50">
                  {/* With Skill */}
                  {withSkillRun && (
                    <TestRunItem 
                      run={withSkillRun} 
                      label="使用 Skill" 
                      getStatusIcon={getStatusIcon}
                      getStatusText={getStatusText}
                      onRetry={retryTest}
                      isRunning={isRunning}
                    />
                  )}
                  {/* Without Skill */}
                  {withoutSkillRun && (
                    <TestRunItem 
                      run={withoutSkillRun} 
                      label="不使用 Skill（基线）" 
                      getStatusIcon={getStatusIcon}
                      getStatusText={getStatusText}
                      onRetry={retryTest}
                      isRunning={isRunning}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 提示 */}
      {testCases.length === 0 && (
        <div className="bg-yellow-900/20 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 mr-3 flex-shrink-0" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">没有测试用例</p>
              <p className="text-yellow-400">
                请先在上一步添加测试用例，或者选择跳过评估步骤。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 导航按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <button
          onClick={onPrevious}
          disabled={isRunning}
          className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A] disabled:opacity-50"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {canProceed ? '下一步：查看结果和改进' : isRunning ? '评估进行中...' : '请先运行评估'}
        </button>
      </div>
    </div>
  );
}

// 测试运行项组件
function TestRunItem({ 
  run, 
  label, 
  getStatusIcon, 
  getStatusText,
  onRetry,
  isRunning,
}: { 
  run: TestRun; 
  label: string;
  getStatusIcon: (status: TestRun['status']) => React.ReactNode;
  getStatusText: (status: TestRun['status']) => string;
  onRetry: (runId: string) => void;
  isRunning: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-dark-surface">
      <div 
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-[#0F172A]"
        onClick={() => run.output && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-3">
          {getStatusIcon(run.status)}
          <div>
            <div className="text-sm font-medium text-gray-100">{label}</div>
            {run.status === 'completed' && (
              <div className="text-xs text-gray-500 mt-1">
                耗时: {run.duration}ms | Tokens: {run.tokens}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm">{getStatusText(run.status)}</span>
          {run.status === 'failed' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetry(run.id);
              }}
              disabled={isRunning}
              className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200 disabled:opacity-50"
            >
              重试
            </button>
          )}
          {run.output && (
            isExpanded ? 
              <ChevronUp size={16} className="text-gray-400" /> : 
              <ChevronDown size={16} className="text-gray-400" />
          )}
        </div>
      </div>
      
      {run.error && (
        <div className="px-4 py-2 bg-red-900/20 text-red-400 text-sm flex items-center justify-between">
          <span>{run.error}</span>
          <button
            onClick={() => onRetry(run.id)}
            disabled={isRunning}
            className="px-2 py-1 text-xs bg-red-100 text-red-400 rounded hover:bg-red-200 disabled:opacity-50 ml-2"
          >
            重试
          </button>
        </div>
      )}
      
      {isExpanded && run.output && (
        <div className="px-4 py-3 border-t border-gray-100 bg-[#0F172A]">
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              components={{
                h1: ({ children }) => <h1 className="text-base font-bold text-gray-100 mb-2">{children}</h1>,
                h2: ({ children }) => <h2 className="text-sm font-semibold text-gray-100 mb-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-xs font-semibold text-gray-200 mb-1">{children}</h3>,
                p: ({ children }) => <p className="text-xs text-gray-300 mb-2">{children}</p>,
                ul: ({ children }) => <ul className="list-disc list-inside text-xs text-gray-300 space-y-1 mb-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside text-xs text-gray-300 space-y-1 mb-2">{children}</ol>,
                code: ({ children, className }) => {
                  const isInline = !className;
                  return isInline ? (
                    <code className="px-1 py-0.5 bg-gray-100 text-gray-200 rounded text-xs font-mono">{children}</code>
                  ) : (
                    <code className="block bg-gray-900 text-gray-100 p-2 rounded text-xs font-mono overflow-x-auto">{children}</code>
                  );
                },
              }}
            >
              {run.output}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
