'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, Save, FolderOpen, Trash2 } from 'lucide-react';
import IntentStep from './IntentStep';
import ResearchStep from './ResearchStep';
import DraftStep from './DraftStep';
import TestCasesStep from './TestCasesStep';
import EvaluationStep from './EvaluationStep';
import IterationStep from './IterationStep';
import OptimizationStep from './OptimizationStep';
import { cleanSkillContentForOptimization } from '@/lib/skill-builder';

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

// 草稿存储键
const DRAFT_STORAGE_KEY = 'skill-wizard-drafts';
const CURRENT_DRAFT_KEY = 'skill-wizard-current';

// 草稿元数据
interface DraftMeta {
  id: string;
  name: string;
  step: StepId;
  savedAt: string;
  preview: string;
}

// 临时数据存储接口
interface SkillWizardData {
  // 步骤 1: 意图捕获
  intent: {
    name: string;
    description: string;
    categoryId: string;
    vulnerabilityTreeId?: string;
    selectedLanguageId?: string;
    productTagIds?: string[];
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
    categoryId?: string;
    vulnerabilityTreeId?: string;
    cwe?: string;
    content: string;
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
      testCaseName: string;
      type: 'with_skill' | 'without_skill';
      status: 'pending' | 'running' | 'completed' | 'failed';
      output?: string;
      duration?: number;
      tokens?: number;
    }>;
    benchmark?: {
      baselineScore: number;
      skillScore: number;
      improvement: number;
    };
  };
  
  // 步骤 6: 迭代历史
  iterations: Array<{
    version: number;
    changes: string;
    feedback: string;
    timestamp: string;
  }>;
  
  // 步骤 7: 优化结果
  optimization: {
    optimizedSkill?: any;
    triggerAccuracy?: number;
    suggestions?: string[];
  };

  // 标准输出模板
  skillOutputTemplate?: string;
}

const initialWizardData: SkillWizardData = {
  intent: {
    name: '',
    description: '',
    categoryId: '',
    vulnerabilityTreeId: '',
    selectedLanguageId: '',
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
    categoryId: undefined,
    vulnerabilityTreeId: undefined,
    content: '',
  },
  testCases: [],
  evaluation: {
    runs: [],
  },
  iterations: [],
  optimization: {
    optimizedSkill: undefined,
    triggerAccuracy: undefined,
    suggestions: [],
  },
};

export default function SkillCreateWizardPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<StepId>('intent');
  const [wizardData, setWizardData] = useState<SkillWizardData>(initialWizardData);
  const [isSaving, setIsSaving] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);

  // 加载草稿列表
  const loadDrafts = () => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        setDrafts(JSON.parse(saved));
      }
    } catch (error) {
      console.error('加载草稿列表失败:', error);
    }
  };

  // 从 localStorage 加载当前草稿
  useEffect(() => {
    loadDrafts();
    
    const saved = localStorage.getItem(CURRENT_DRAFT_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setWizardData(data.wizardData);
        setCurrentStep(data.currentStep);
        setCurrentDraftId(data.draftId);
      } catch (error) {
        console.error('加载向导数据失败:', error);
      }
    }
  }, []);

  // 保存数据到 localStorage
  const saveData = (data: Partial<SkillWizardData>) => {
    const newData = { ...wizardData, ...data };
    setWizardData(newData);
    
    // 自动保存当前进度
    const draftId = currentDraftId || `draft-${Date.now()}`;
    if (!currentDraftId) {
      setCurrentDraftId(draftId);
    }
    
    localStorage.setItem(CURRENT_DRAFT_KEY, JSON.stringify({
      wizardData: newData,
      currentStep,
      draftId,
      savedAt: new Date().toISOString(),
    }));
  };

  // 保存为草稿
  const saveAsDraft = () => {
    const draftId = currentDraftId || `draft-${Date.now()}`;
    const draftName = wizardData.intent.name || wizardData.skill.name || '未命名 Skill';
    
    const draft: DraftMeta = {
      id: draftId,
      name: draftName,
      step: currentStep,
      savedAt: new Date().toISOString(),
      preview: wizardData.intent.description || wizardData.skill.description || '暂无描述',
    };
    
    // 更新草稿列表
    const existingIndex = drafts.findIndex(d => d.id === draftId);
    let newDrafts: DraftMeta[];
    if (existingIndex >= 0) {
      newDrafts = [...drafts];
      newDrafts[existingIndex] = draft;
    } else {
      newDrafts = [draft, ...drafts];
    }
    
    setDrafts(newDrafts);
    setCurrentDraftId(draftId);
    
    // 保存到 localStorage
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(newDrafts));
    localStorage.setItem(`skill-wizard-draft-${draftId}`, JSON.stringify({
      wizardData,
      currentStep,
      savedAt: new Date().toISOString(),
    }));
    
    toast.success('草稿已保存！');
  };

  // 加载草稿
  const loadDraft = (draftId: string) => {
    try {
      const saved = localStorage.getItem(`skill-wizard-draft-${draftId}`);
      if (saved) {
        const data = JSON.parse(saved);
        setWizardData(data.wizardData);
        setCurrentStep(data.currentStep);
        setCurrentDraftId(draftId);
        setShowDrafts(false);
      }
    } catch (error) {
      console.error('加载草稿失败:', error);
      toast.error('加载草稿失败');
    }
  };

  // 删除草稿
  const deleteDraft = (draftId: string) => {
    if (!confirm('确定要删除这个草稿吗？')) return;
    
    const newDrafts = drafts.filter(d => d.id !== draftId);
    setDrafts(newDrafts);
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(newDrafts));
    localStorage.removeItem(`skill-wizard-draft-${draftId}`);
    
    if (currentDraftId === draftId) {
      setCurrentDraftId(null);
    }
  };

  // 获取当前步骤索引
  const currentStepIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);

  // 下一步
  const handleNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < WIZARD_STEPS.length) {
      const nextStep = WIZARD_STEPS[nextIndex].id;
      setCurrentStep(nextStep);
      saveData({});
    }
  };

  // 上一步
  const handlePrevious = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      const prevStep = WIZARD_STEPS[prevIndex].id;
      setCurrentStep(prevStep);
      saveData({});
    }
  };

  // 跳转到指定步骤
  const handleGoToStep = (stepId: StepId) => {
    setCurrentStep(stepId);
    saveData({});
  };

  // 完成创建
  const handleComplete = async () => {
    setIsSaving(true);
    try {
      const token = localStorage.getItem('token');
      
      const skillData = {
        ...wizardData.skill,
        isPublic: false,
        categoryId: wizardData.intent.categoryId,
        vulnerabilityTreeId: wizardData.intent.vulnerabilityTreeId || null,
        productTagIds: wizardData.intent.productTagIds || [],
      };

      // 检查必填字段
      const missingFields = [];
      if (!skillData.name) missingFields.push('name');
      if (!skillData.displayName) missingFields.push('displayName');
      if (!skillData.description) missingFields.push('description');
      if (!skillData.content) missingFields.push('content');
      if (!wizardData.intent.categoryId) missingFields.push('分类');
      if (!wizardData.intent.vulnerabilityTreeId) missingFields.push('漏洞模式');
      
      if (missingFields.length > 0) {
        throw new Error(`缺少必填字段: ${missingFields.join(', ')}`);
      }
      
      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(skillData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('服务器返回错误:', errorData);
        throw new Error(errorData.error || '保存失败');
      }

      const data = await response.json();
      
      // 清除临时数据和草稿
      localStorage.removeItem(CURRENT_DRAFT_KEY);
      if (currentDraftId) {
        deleteDraft(currentDraftId);
      }
      
      // 跳转到详情页
      router.push(`/dashboard/skills/${data.skill.id}`);
    } catch (error) {
      console.error('保存 Skill 失败:', error);
      toast.error(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-[#0F172A]">
      {/* Header */}
      <div className="bg-dark-surface border-b border-gray-700/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <button
                  onClick={() => {
                    if (confirm('确定要退出向导吗？未保存的更改可以稍后从草稿恢复。')) {
                      router.push('/dashboard/skills');
                    }
                  }}
                  className="flex items-center text-gray-400 hover:text-gray-100 mb-2"
                >
                  <ArrowLeft size={20} className="mr-2" />
                  返回 Skills 列表
                </button>
                <h1 className="text-2xl font-bold text-gray-100">创建新 Skill</h1>
                <p className="text-sm text-gray-400 mt-1">引导式创建流程</p>
              </div>
              
              {/* 草稿操作按钮 */}
              <div className="flex items-center gap-3">
                <button
                  onClick={saveAsDraft}
                  className="inline-flex items-center px-4 py-2 border border-gray-600 rounded-lg text-gray-300 hover:bg-dark-bg transition-colors"
                >
                  <Save size={16} className="mr-2" />
                  保存草稿
                </button>
                <button
                  onClick={() => setShowDrafts(!showDrafts)}
                  className="inline-flex items-center px-4 py-2 border border-gray-600 rounded-lg text-gray-300 hover:bg-dark-bg transition-colors relative"
                >
                  <FolderOpen size={16} className="mr-2" />
                  加载草稿
                  {drafts.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center">
                      {drafts.length}
                    </span>
                  )}
                </button>
              </div>
            </div>
            
            {/* 草稿列表 */}
            {showDrafts && (
              <div className="mt-4 border border-gray-700/50 rounded-lg bg-dark-bg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-100">已保存的草稿</h3>
                  <button
                    onClick={() => setShowDrafts(false)}
                    className="text-gray-400 hover:text-gray-400"
                  >
                    ✕
                  </button>
                </div>
                
                {drafts.length === 0 ? (
                  <p className="text-sm text-gray-500">暂无保存的草稿</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {drafts.map((draft) => (
                      <div
                        key={draft.id}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          currentDraftId === draft.id
                            ? 'border-blue-500 bg-blue-900/20'
                            : 'border-gray-700/50 bg-dark-surface hover:bg-dark-surface-hover'
                        }`}
                      >
                        <div className="flex-1 cursor-pointer" onClick={() => loadDraft(draft.id)}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-100">{draft.name}</span>
                            {currentDraftId === draft.id && (
                              <span className="text-xs bg-blue-100 text-blue-400 px-2 py-0.5 rounded">
                                当前
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            <span>步骤: {WIZARD_STEPS.find(s => s.id === draft.step)?.label}</span>
                            <span className="mx-2">•</span>
                            <span>{formatDate(draft.savedAt)}</span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1 line-clamp-1">{draft.preview}</p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteDraft(draft.id);
                          }}
                          className="ml-3 p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-900/20 rounded"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="bg-dark-surface border-b border-gray-700/50">
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
                        isActive ? 'text-blue-400' : isCompleted ? 'text-green-400' : 'text-gray-400'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : isCompleted
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-700 text-gray-400'
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
                      <div className="flex-1 h-0.5 bg-gray-700 mx-4" />
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
        <div className="bg-dark-surface rounded-lg shadow">
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
                testCases={wizardData.testCases}
                evaluationData={wizardData.evaluation}
                iterations={wizardData.iterations}
                optimizationData={wizardData.optimization}
                onChange={(data) => saveData(data)}
                onNext={handleComplete}
                onPrevious={handlePrevious}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
