'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import IntentStep from './IntentStep';
import ResearchStep from './ResearchStep';
import DraftStep from './DraftStep';
import TestCasesStep from './TestCasesStep';
import EvaluationStep from './EvaluationStep';
import IterationStep from './IterationStep';
import OptimizationStep from './OptimizationStep';

// 步骤定义
const WIZARD_STEPS = [
  { id: 'intent', label: '捕获意图', description: '了解你想创建什么样的 Skill' },
  { id: 'research', label: '调研访谈', description: '收集详细信息和使用场景' },
  { id: 'draft', label: '编写 Skill', description: '生成 Skill 定义文件' },
  { id: 'testcases', label: '创建测试', description: '编写测试用例验证效果' },
  { id: 'evaluation', label: '运行评估', description: '执行测试并收集结果' },
  { id: 'iteration', label: '迭代改进', description: '基于反馈优化 Skill' },
  { id: 'optimization', label: '描述优化', description: '优化 Skill 触发准确性' },
] as const;

type StepId = typeof WIZARD_STEPS[number]['id'];

// 临时数据存储接口
interface SkillWizardData {
  // 步骤 1: 意图捕获
  intent: {
    name: string;
    description: string;
    category: string;
    whatDoesItDo: string;
    whenShouldItTrigger: string;
    expectedOutput: string;
    needsTestCases: boolean;
  };
  
  // 步骤 2: 调研访谈
  research: {
    edgeCases: string[];
    inputOutputFormats: string;
    exampleFiles: string[];
    successCriteria: string[];
    dependencies: string[];
  };
  
  // 步骤 3: Skill 定义
  skill: {
    name: string;
    displayName: string;
    description: string;
    category: string;
    cwe?: string;
    severity: string;
    systemPrompt: string;
    userPrompt: string;
    tools: string[];
    parameters: Record<string, unknown>;
  };
  
  // 步骤 4: 测试用例
  testCases: Array<{
    id: string;
    name: string;
    prompt: string;
    expectedOutput?: string;
    testFiles?: string[];
  }>;
  
  // 步骤 5: 评估结果
  evaluation: {
    runs: Array<{
      id: string;
      testCaseId: string;
      type: 'with_skill' | 'without_skill';
      status: 'pending' | 'running' | 'completed' | 'failed';
      output?: string;
      duration?: number;
      tokens?: number;
    }>;
    benchmark?: {
      passRate: number;
      avgDuration: number;
      avgTokens: number;
    };
  };
  
  // 步骤 6: 迭代历史
  iterations: Array<{
    version: number;
    changes: string;
    feedback: string;
    timestamp: string;
  }>;
  
  // 步骤 7: 描述优化
  optimization: {
    originalDescription: string;
    optimizedDescription: string;
    triggerAccuracy: number;
  };
}

// 初始数据
const initialWizardData: SkillWizardData = {
  intent: {
    name: '',
    description: '',
    category: 'code-audit',
    whatDoesItDo: '',
    whenShouldItTrigger: '',
    expectedOutput: '',
    needsTestCases: true,
  },
  research: {
    edgeCases: [],
    inputOutputFormats: '',
    exampleFiles: [],
    successCriteria: [],
    dependencies: [],
  },
  skill: {
    name: '',
    displayName: '',
    description: '',
    category: 'code-audit',
    severity: 'medium',
    systemPrompt: '',
    userPrompt: '',
    tools: [],
    parameters: {},
  },
  testCases: [],
  evaluation: {
    runs: [],
  },
  iterations: [],
  optimization: {
    originalDescription: '',
    optimizedDescription: '',
    triggerAccuracy: 0,
  },
};

export default function SkillCreateWizardPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<StepId>('intent');
  const [wizardData, setWizardData] = useState<SkillWizardData>(initialWizardData);
  const [isSaving, setIsSaving] = useState(false);

  // 从 sessionStorage 加载数据
  useEffect(() => {
    const saved = sessionStorage.getItem('skill-wizard-data');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setWizardData(data);
      } catch (error) {
        console.error('加载向导数据失败:', error);
      }
    }
  }, []);

  // 保存数据到 sessionStorage
  const saveData = (data: Partial<SkillWizardData>) => {
    const newData = { ...wizardData, ...data };
    setWizardData(newData);
    sessionStorage.setItem('skill-wizard-data', JSON.stringify(newData));
  };

  // 获取当前步骤索引
  const currentStepIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);

  // 下一步
  const handleNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < WIZARD_STEPS.length) {
      setCurrentStep(WIZARD_STEPS[nextIndex].id);
    }
  };

  // 上一步
  const handlePrevious = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(WIZARD_STEPS[prevIndex].id);
    }
  };

  // 跳转到指定步骤
  const handleGoToStep = (stepId: StepId) => {
    setCurrentStep(stepId);
  };

  // 完成创建
  const handleComplete = async () => {
    setIsSaving(true);
    try {
      // TODO: 调用 API 保存 Skill
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...wizardData.skill,
          isPublic: false, // 默认私有
        }),
      });

      if (!response.ok) {
        throw new Error('保存失败');
      }

      const data = await response.json();
      
      // 清除临时数据
      sessionStorage.removeItem('skill-wizard-data');
      
      // 跳转到详情页
      router.push(`/dashboard/skills/${data.skill.id}`);
    } catch (error) {
      console.error('保存 Skill 失败:', error);
      alert('保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4">
            <button
              onClick={() => {
                if (confirm('确定要退出向导吗？未保存的数据将会丢失。')) {
                  sessionStorage.removeItem('skill-wizard-data');
                  router.push('/dashboard/skills');
                }
              }}
              className="flex items-center text-gray-600 hover:text-gray-900 mb-2"
            >
              <ArrowLeft size={20} className="mr-2" />
              返回 Skills 列表
            </button>
            <h1 className="text-2xl font-bold text-gray-900">创建新 Skill</h1>
            <p className="text-sm text-gray-600 mt-1">引导式创建流程</p>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4">
            <div className="flex items-center justify-between">
              {WIZARD_STEPS.map((step, index) => {
                const isActive = step.id === currentStep;
                const isCompleted = index < currentStepIndex;
                
                return (
                  <div key={step.id} className="flex items-center flex-1">
                    <button
                      onClick={() => handleGoToStep(step.id)}
                      className={`flex items-center space-x-2 group ${
                        isActive ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-400'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : isCompleted
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {isCompleted ? <CheckCircle2 size={16} /> : index + 1}
                      </div>
                      <div className="hidden md:block">
                        <div className="text-sm font-medium">{step.label}</div>
                        <div className="text-xs text-gray-500">{step.description}</div>
                      </div>
                    </button>
                    {index < WIZARD_STEPS.length - 1 && (
                      <div className="flex-1 h-0.5 bg-gray-200 mx-4" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow">
          {/* 步骤内容 */}
          <div className="p-6">
            {currentStep === 'intent' && (
              <IntentStep
                data={wizardData.intent}
                onChange={(intent) => saveData({ intent })}
                onNext={handleNext}
              />
            )}
            {currentStep === 'research' && (
              <ResearchStep
                data={wizardData.research}
                onChange={(research) => saveData({ research })}
                onNext={handleNext}
                onPrevious={handlePrevious}
              />
            )}
            {currentStep === 'draft' && (
              <DraftStep
                intentData={wizardData.intent}
                researchData={wizardData.research}
                skillData={wizardData.skill}
                onChange={(skill) => saveData({ skill })}
                onNext={handleNext}
                onPrevious={handlePrevious}
              />
            )}
            {currentStep === 'testcases' && (
              <TestCasesStep
                testCases={wizardData.testCases}
                onChange={(testCases) => saveData({ testCases })}
                onNext={handleNext}
                onPrevious={handlePrevious}
                needsTestCases={wizardData.intent.needsTestCases}
              />
            )}
            {currentStep === 'evaluation' && (
              <EvaluationStep
                skillData={wizardData.skill}
                testCases={wizardData.testCases}
                evaluationData={wizardData.evaluation}
                onChange={(evaluation) => saveData({ evaluation })}
                onNext={handleNext}
                onPrevious={handlePrevious}
              />
            )}
            {currentStep === 'iteration' && (
              <IterationStep
                evaluationData={wizardData.evaluation}
                skillData={wizardData.skill}
                iterations={wizardData.iterations}
                onChange={(data) => saveData(data)}
                onNext={handleNext}
                onPrevious={handlePrevious}
                onRerunTests={() => setCurrentStep('evaluation')}
              />
            )}
            {currentStep === 'optimization' && (
              <OptimizationStep
                skillData={wizardData.skill}
                optimizationData={wizardData.optimization}
                onChange={(data) => saveData(data)}
                onNext={handleComplete}
                onPrevious={handlePrevious}
              />
            )}
          </div>

          {/* Navigation Buttons */}
          <div className="border-t border-gray-200 px-6 py-4">
            <div className="flex justify-between">
              <button
                onClick={handlePrevious}
                disabled={currentStepIndex === 0}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                上一步
              </button>
              
              <div className="flex space-x-2">
                {currentStepIndex === WIZARD_STEPS.length - 1 ? (
                  <button
                    onClick={handleComplete}
                    disabled={isSaving}
                    className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    {isSaving ? '保存中...' : '完成创建'}
                  </button>
                ) : (
                  <button
                    onClick={handleNext}
                    className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    下一步
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
