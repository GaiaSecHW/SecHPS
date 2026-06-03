'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, Save, FolderOpen, Trash2, Wand2, ChevronRight, ChevronLeft, Loader2 } from 'lucide-react';
import IntentStep from './IntentStep';
import ResearchStep from './ResearchStep';
import DraftStep from './DraftStep';
import TestCasesStep from './TestCasesStep';
import EvaluationStep from './EvaluationStep';
import IterationStep from './IterationStep';
import OptimizationStep from './OptimizationStep';
import { cleanSkillContentForOptimization } from '@/lib/skill-builder';

const WIZARD_STEPS = [
  { id: 'intent', label: '捕获意图', description: '了解你想创建什么样的 Skill', icon: Wand2 },
  { id: 'research', label: '调研访谈', description: '收集详细信息和使用场景', icon: Wand2 },
  { id: 'draft', label: '编写 Skill', description: '生成 Skill 定义文件', icon: Wand2 },
  { id: 'testcases', label: '创建测试', description: '编写测试用例验证效果', icon: Wand2 },
  { id: 'evaluation', label: '运行评估', description: '执行测试并收集结果', icon: Wand2 },
  { id: 'iteration', label: '迭代改进', description: '基于反馈优化 Skill', icon: Wand2 },
  { id: 'optimization', label: '描述优化', description: '优化 Skill 触发准确性', icon: Wand2 },
] as const;

type StepId = typeof WIZARD_STEPS[number]['id'];

const DRAFT_STORAGE_KEY = 'skill-wizard-drafts';
const CURRENT_DRAFT_KEY = 'skill-wizard-current';

interface DraftMeta {
  id: string;
  name: string;
  step: StepId;
  savedAt: string;
  preview: string;
}

interface SkillWizardData {
  intent: {
    name: string;
    description: string;
    categoryId: string;
    vulnerabilityTreeId?: number | null;
    selectedLanguageId?: string;
    productTagIds?: string[];
    whatDoesItDo: string;
    whenShouldItTrigger: string;
    expectedOutput: string;
    needsTestCases: boolean;
  };
  research: {
    edgeCases: string[];
    inputOutputFormats: string;
    exampleFiles: string[];
    successCriteria: string[];
    dependencies: string[];
  };
  skill: {
    name: string;
    displayName: string;
    description: string;
    categoryId?: string;
    vulnerabilityTreeId?: number | null;
    cwe?: string;
    content: string;
  };
  testCases: Array<{
    id: string;
    name: string;
    prompt: string;
    expectedOutput?: string;
    testFiles?: string[];
  }>;
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
  iterations: Array<{
    version: number;
    changes: string;
    feedback: string;
    timestamp: string;
  }>;
  optimization: {
    optimizedSkill?: any;
    triggerAccuracy?: number;
    suggestions?: string[];
  };
  skillOutputTemplate?: string;
}

const initialWizardData: SkillWizardData = {
  intent: {
    name: '',
    description: '',
    categoryId: '',
    vulnerabilityTreeId: null,
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
    vulnerabilityTreeId: null,
    content: '',
  },
  testCases: [],
  evaluation: { runs: [] },
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

  const loadDrafts = () => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) setDrafts(JSON.parse(saved));
    } catch (error) {
      console.error('加载草稿列表失败:', error);
    }
  };

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

  const saveData = (data: Partial<SkillWizardData>) => {
    const newData = { ...wizardData, ...data };
    setWizardData(newData);
    const draftId = currentDraftId || `draft-${Date.now()}`;
    if (!currentDraftId) setCurrentDraftId(draftId);
    localStorage.setItem(CURRENT_DRAFT_KEY, JSON.stringify({
      wizardData: newData,
      currentStep,
      draftId,
      savedAt: new Date().toISOString(),
    }));
  };

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
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(newDrafts));
    localStorage.setItem(`skill-wizard-draft-${draftId}`, JSON.stringify({
      wizardData,
      currentStep,
      savedAt: new Date().toISOString(),
    }));
    toast.success('草稿已保存！');
  };

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

  const deleteDraft = (draftId: string) => {
    if (!confirm('确定要删除这个草稿吗？')) return;
    const newDrafts = drafts.filter(d => d.id !== draftId);
    setDrafts(newDrafts);
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(newDrafts));
    localStorage.removeItem(`skill-wizard-draft-${draftId}`);
    if (currentDraftId === draftId) setCurrentDraftId(null);
  };

  const currentStepIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < WIZARD_STEPS.length) {
      setCurrentStep(WIZARD_STEPS[nextIndex].id);
      saveData({});
    }
  };

  const handlePrevious = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(WIZARD_STEPS[prevIndex].id);
      saveData({});
    }
  };

  const handleGoToStep = (stepId: StepId) => {
    setCurrentStep(stepId);
    saveData({});
  };

  const handleComplete = async () => {
    setIsSaving(true);
    try {
      const token = localStorage.getItem('token');
      const skillData = {
        ...wizardData.skill,
        isPublic: false,
        categoryId: wizardData.intent.categoryId,
        vulnerabilityTreeId: wizardData.intent.vulnerabilityTreeId ?? null,
        productTagIds: wizardData.intent.productTagIds || [],
      };
      const missingFields = [];
      if (!skillData.name) missingFields.push('name');
      if (!skillData.displayName) missingFields.push('displayName');
      if (!skillData.description) missingFields.push('description');
      if (!skillData.content) missingFields.push('content');
      if (!wizardData.intent.categoryId) missingFields.push('分类');
      if (!wizardData.intent.vulnerabilityTreeId) missingFields.push('漏洞模式');
      if (missingFields.length > 0) throw new Error(`缺少必填字段: ${missingFields.join(', ')}`);

      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(skillData),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '保存失败');
      }
      const data = await response.json();
      localStorage.removeItem(CURRENT_DRAFT_KEY);
      if (currentDraftId) deleteDraft(currentDraftId);
      router.push(`/dashboard/skills/${data.skill.id}`);
    } catch (error) {
      toast.error(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#0F172A]">
      {/* Header */}
      <div className="bg-dark-surface border-b border-gray-700/50">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (confirm('确定要退出向导吗？')) router.push('/dashboard/skills');
              }}
              className="p-1.5 text-gray-400 hover:text-gray-100 hover:bg-gray-700/30 rounded transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-white">Skill 引导创建</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={saveAsDraft}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-700/30 transition-colors"
            >
              <Save size={14} />
              保存
            </button>
            <button
              onClick={() => setShowDrafts(!showDrafts)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-700/30 transition-colors relative"
            >
              <FolderOpen size={14} />
              草稿
              {drafts.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-purple-600 text-white text-xs rounded">
                  {drafts.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 草稿列表下拉 */}
      {showDrafts && (
        <div className="absolute top-[52px] right-5 z-50 w-[300px] bg-dark-surface border border-gray-700/50 rounded-lg shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
            <h3 className="text-sm font-medium text-gray-100">草稿列表</h3>
            <button onClick={() => setShowDrafts(false)} className="text-gray-400 hover:text-gray-200">
              ✕
            </button>
          </div>
          <div className="p-3 max-h-[200px] overflow-auto">
            {drafts.length === 0 ? (
              <p className="text-xs text-gray-500">暂无草稿</p>
            ) : (
              <div className="space-y-2">
                {drafts.map((draft) => (
                  <div
                    key={draft.id}
                    onClick={() => loadDraft(draft.id)}
                    className={`flex items-center justify-between p-2.5 rounded border cursor-pointer transition-colors ${
                      currentDraftId === draft.id
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-gray-700/50 bg-gray-800/50 hover:bg-gray-700/30'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-100 truncate">{draft.name}</span>
                      <p className="text-xs text-gray-500">{formatDate(draft.savedAt)}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteDraft(draft.id); }}
                      className="p-1 text-gray-400 hover:text-red-400 rounded"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Steps Progress */}
      <div className="bg-dark-surface border-b border-gray-700/50">
        <div className="px-5 py-3">
          <div className="flex items-center gap-2">
            {WIZARD_STEPS.map((step, index) => {
              const isActive = step.id === currentStep;
              const isCompleted = index < currentStepIndex;
              return (
                <button
                  key={step.id}
                  onClick={() => handleGoToStep(step.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
                      : isCompleted
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-dark-bg text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {isCompleted ? <CheckCircle2 size={14} /> : <span>{index + 1}</span>}
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-dark-surface border border-gray-700/50 rounded-xl">
            <div className="p-4">
              {currentStep === 'intent' && (
                <IntentStep data={wizardData.intent} onChange={(intent) => saveData({ intent })} onNext={handleNext} />
              )}
              {currentStep === 'research' && (
                <ResearchStep data={wizardData.research} onChange={(research) => saveData({ research })} onNext={handleNext} onPrevious={handlePrevious} />
              )}
              {currentStep === 'draft' && (
                <DraftStep intentData={wizardData.intent} researchData={wizardData.research} skillData={wizardData.skill} onChange={(skill) => saveData({ skill })} onNext={handleNext} onPrevious={handlePrevious} />
              )}
              {currentStep === 'testcases' && (
                <TestCasesStep testCases={wizardData.testCases} onChange={(testCases) => saveData({ testCases })} onNext={handleNext} onPrevious={handlePrevious} needsTestCases={wizardData.intent.needsTestCases} />
              )}
              {currentStep === 'evaluation' && (
                <EvaluationStep skillData={wizardData.skill} testCases={wizardData.testCases} evaluationData={wizardData.evaluation} onChange={(evaluation) => saveData({ evaluation })} onNext={handleNext} onPrevious={handlePrevious} />
              )}
              {currentStep === 'iteration' && (
                <IterationStep evaluationData={wizardData.evaluation} skillData={wizardData.skill} iterations={wizardData.iterations} onChange={(data) => saveData(data)} onNext={handleNext} onPrevious={handlePrevious} onRerunTests={() => setCurrentStep('evaluation')} />
              )}
              {currentStep === 'optimization' && (
                <OptimizationStep skillData={wizardData.skill} testCases={wizardData.testCases} evaluationData={wizardData.evaluation} iterations={wizardData.iterations} optimizationData={wizardData.optimization} onChange={(data) => saveData(data)} onNext={handleComplete} onPrevious={handlePrevious} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}