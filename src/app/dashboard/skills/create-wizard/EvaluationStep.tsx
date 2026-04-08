'use client';

import { useState, useEffect } from 'react';
import { Play, CheckCircle, XCircle, Clock, AlertCircle, FileText, RefreshCw } from 'lucide-react';

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
      alert('请先添加测试用例');
      return;
    }

    setIsRunning(true);
    setProgress({ current: 0, total: testCases.length * 2 }); // 每个用例运行两次

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

    try {
      const token = localStorage.getItem('token');

      // 并行运行所有测试
      const runPromises = initialRuns.map(async (run, index) => {
        const testCase = testCases.find((tc) => tc.id === run.testCaseId);
        if (!testCase) return run;

        // 更新状态为运行中
        setRuns((prev) =>
          prev.map((r) => (r.id === run.id ? { ...r, status: 'running' } : r))
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
            throw new Error('测试运行失败');
          }

          const data = await response.json();

          // 更新进度
          setProgress((prev) => ({ ...prev, current: prev.current + 1 }));

          return {
            ...run,
            status: 'completed',
            output: data.output,
            duration: data.duration,
            tokens: data.tokens,
          };
        } catch (error) {
          setProgress((prev) => ({ ...prev, current: prev.current + 1 }));
          return {
            ...run,
            status: 'failed',
            error: error instanceof Error ? error.message : '未知错误',
          };
        }
      });

      const results = await Promise.all(runPromises);
      setRuns(results);
    } catch (error) {
      console.error('评估失败:', error);
      alert('评估失败，请重试');
    } finally {
      setIsRunning(false);
    }
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
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-start">
          <Play className="w-5 h-5 text-green-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-green-800">
            <p className="font-medium mb-2">评估说明</p>
            <p className="text-green-700">
              我们会对每个测试用例运行两次：一次使用你的 Skill，一次不使用。
              对比两者的效果，帮助你改进 Skill 质量。
            </p>
          </div>
        </div>
      </div>

      {/* 统计信息 */}
      {runs.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">总测试数</div>
            <div className="text-2xl font-bold text-gray-900">{runs.length}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">已完成</div>
            <div className="text-2xl font-bold text-green-600">{completedCount}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">失败</div>
            <div className="text-2xl font-bold text-red-600">{failedCount}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">进度</div>
            <div className="text-2xl font-bold text-blue-600">
              {progress.current}/{progress.total}
            </div>
          </div>
        </div>
      )}

      {/* 进度条 */}
      {isRunning && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">运行进度</span>
            <span className="text-sm text-gray-600">
              {progress.current}/{progress.total}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 运行按钮 */}
      <div className="flex justify-center">
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
              开始评估
            </>
          )}
        </button>
      </div>

      {/* 测试用例列表 */}
      {runs.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">测试运行详情</h3>
          {testCases.map((tc) => {
            const withSkillRun = runs.find((r) => r.testCaseId === tc.id && r.type === 'with_skill');
            const withoutSkillRun = runs.find((r) => r.testCaseId === tc.id && r.type === 'without_skill');

            return (
              <div key={tc.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <h4 className="font-medium text-gray-900">{tc.name}</h4>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-1">{tc.prompt}</p>
                </div>
                <div className="divide-y divide-gray-200">
                  {/* With Skill */}
                  {withSkillRun && (
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(withSkillRun.status)}
                        <div>
                          <div className="text-sm font-medium text-gray-900">使用 Skill</div>
                          {withSkillRun.status === 'completed' && (
                            <div className="text-xs text-gray-500 mt-1">
                              耗时: {withSkillRun.duration}ms | Tokens: {withSkillRun.tokens}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-sm">
                        {getStatusText(withSkillRun.status)}
                        {withSkillRun.error && (
                          <div className="text-red-600 text-xs mt-1">{withSkillRun.error}</div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Without Skill */}
                  {withoutSkillRun && (
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(withoutSkillRun.status)}
                        <div>
                          <div className="text-sm font-medium text-gray-900">不使用 Skill（基线）</div>
                          {withoutSkillRun.status === 'completed' && (
                            <div className="text-xs text-gray-500 mt-1">
                              耗时: {withoutSkillRun.duration}ms | Tokens: {withoutSkillRun.tokens}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-sm">
                        {getStatusText(withoutSkillRun.status)}
                        {withoutSkillRun.error && (
                          <div className="text-red-600 text-xs mt-1">{withoutSkillRun.error}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 提示 */}
      {testCases.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 flex-shrink-0" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">没有测试用例</p>
              <p className="text-yellow-700">
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
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
