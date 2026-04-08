'use client';

import { useState, useEffect } from 'react';
import { Sparkles, FileText, Copy, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface SkillDraft {
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
}

interface Props {
  intentData: {
    name: string;
    description: string;
    category: string;
    whatDoesItDo: string;
    whenShouldItTrigger: string;
    expectedOutput: string;
    needsTestCases: boolean;
  };
  researchData: {
    edgeCases: string[];
    inputOutputFormats: string;
    exampleFiles: string[];
    successCriteria: string[];
    dependencies: string[];
  };
  skillData: SkillDraft;
  onChange: (data: SkillDraft) => void;
  onNext: () => void;
  onPrevious: () => void;
}

const SEVERITY_OPTIONS = [
  { value: 'critical', label: '严重', color: 'bg-red-100 text-red-800' },
  { value: 'high', label: '高危', color: 'bg-orange-100 text-orange-800' },
  { value: 'medium', label: '中危', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'low', label: '低危', color: 'bg-blue-100 text-blue-800' },
  { value: 'info', label: '信息', color: 'bg-gray-100 text-gray-800' },
];

const COMMON_TOOLS = [
  'read_file',
  'write_file',
  'search_pattern',
  'grep',
  'bash',
  'python',
  'node',
];

export default function DraftStep({ intentData, researchData, skillData, onChange, onNext, onPrevious }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 自动生成 Skill 草稿
  const generateSkillDraft = async () => {
    setIsGenerating(true);
    setGenerateError(null);

    try {
      const token = localStorage.getItem('token');
      
      // 调用 API 生成 Skill
      const response = await fetch('/api/skills/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          intent: intentData,
          research: researchData,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '生成失败');
      }

      const data = await response.json();
      onChange(data.skill);
    } catch (error) {
      console.error('生成 Skill 失败:', error);
      setGenerateError(error instanceof Error ? error.message : '生成失败，请重试');
      
      // 使用模板生成基础草稿
      const fallbackDraft: SkillDraft = {
        name: intentData.name || 'untitled-skill',
        displayName: intentData.name || 'Untitled Skill',
        description: intentData.description || '',
        category: intentData.category || 'code-audit',
        severity: 'medium',
        systemPrompt: `你是一个专业的安全审计专家，专注于${intentData.whatDoesItDo || '代码安全分析'}。

你的任务是：
${intentData.whatDoesItDo || '检测代码中的安全漏洞'}

触发条件：
${intentData.whenShouldItTrigger || '当用户请求安全审计时'}

期望输出：
${intentData.expectedOutput || '结构化的安全审计报告'}

注意事项：
- 考虑边缘情况：${researchData.edgeCases.join('、') || '无特殊要求'}
- 成功标准：${researchData.successCriteria.join('、') || '准确识别安全问题'}
- 依赖工具：${researchData.dependencies.join('、') || '标准工具集'}`,
        userPrompt: `请分析以下内容，识别其中的安全问题：

{{input}}

请按照以下格式输出：
1. 发现的问题
2. 风险等级
3. 详细说明
4. 修复建议`,
        tools: researchData.dependencies.length > 0 ? researchData.dependencies : ['read_file', 'search_pattern'],
        parameters: {},
      };
      
      onChange(fallbackDraft);
    } finally {
      setIsGenerating(false);
    }
  };

  // 组件挂载时自动生成一次
  useEffect(() => {
    if (!skillData.systemPrompt) {
      generateSkillDraft();
    }
  }, []);

  const handleCopy = async () => {
    const skillMd = generateSkillMd(skillData);
    await navigator.clipboard.writeText(skillMd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const generateSkillMd = (skill: SkillDraft): string => {
    let md = `# ${skill.displayName}

## 描述
${skill.description}

## 分类
${skill.category}

## 严重程度
${skill.severity}

`;
    if (skill.cwe) {
      md += `## CWE 编号
${skill.cwe}

`;
    }
    
    md += `## 系统提示词
${skill.systemPrompt}

## 用户提示词
${skill.userPrompt}

## 工具
${skill.tools.map(t => `- ${t}`).join('\n')}
`;
    
    return md;
  };

  const isValid = () => {
    return (
      skillData.name.trim() !== '' &&
      skillData.displayName.trim() !== '' &&
      skillData.description.trim() !== '' &&
      skillData.systemPrompt.trim() !== '' &&
      skillData.userPrompt.trim() !== ''
    );
  };

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <div className="flex items-start">
          <Sparkles className="w-5 h-5 text-purple-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-purple-800">
            <p className="font-medium mb-2">AI 自动生成</p>
            <p className="text-purple-700">
              我们会根据你提供的信息自动生成 Skill 定义。你可以直接使用，也可以手动修改优化。
            </p>
          </div>
        </div>
      </div>

      {/* 生成按钮 */}
      <div className="flex items-center justify-between">
        <button
          onClick={generateSkillDraft}
          disabled={isGenerating}
          className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
        >
          {isGenerating ? (
            <>
              <RefreshCw size={16} className="mr-2 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Sparkles size={16} className="mr-2" />
              重新生成
            </>
          )}
        </button>

        <button
          onClick={handleCopy}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          {copied ? (
            <>
              <Check size={16} className="mr-2 text-green-600" />
              已复制
            </>
          ) : (
            <>
              <Copy size={16} className="mr-2" />
              复制为 Markdown
            </>
          )}
        </button>
      </div>

      {/* 错误提示 */}
      {generateError && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 flex-shrink-0" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">使用了本地模板生成</p>
              <p className="text-yellow-700">{generateError}</p>
            </div>
          </div>
        </div>
      )}

      {/* 基本信息 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Skill 名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={skillData.name}
            onChange={(e) => onChange({ ...skillData, name: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            显示名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={skillData.displayName}
            onChange={(e) => onChange({ ...skillData, displayName: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          描述 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={skillData.description}
          onChange={(e) => onChange({ ...skillData, description: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            严重程度
          </label>
          <select
            value={skillData.severity}
            onChange={(e) => onChange({ ...skillData, severity: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {SEVERITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            CWE 编号（可选）
          </label>
          <input
            type="text"
            value={skillData.cwe || ''}
            onChange={(e) => onChange({ ...skillData, cwe: e.target.value })}
            placeholder="例如：CWE-89"
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            分类
          </label>
          <input
            type="text"
            value={skillData.category}
            disabled
            className="w-full px-4 py-2 border border-gray-300 rounded-md bg-gray-50"
          />
        </div>
      </div>

      {/* 系统提示词 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          <FileText size={16} className="inline mr-1" />
          系统提示词 <span className="text-red-500">*</span>
        </label>
        <textarea
          value={skillData.systemPrompt}
          onChange={(e) => onChange({ ...skillData, systemPrompt: e.target.value })}
          rows={8}
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-500">
          定义 Skill 的角色、任务和行为准则
        </p>
      </div>

      {/* 用户提示词 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          <FileText size={16} className="inline mr-1" />
          用户提示词 <span className="text-red-500">*</span>
        </label>
        <textarea
          value={skillData.userPrompt}
          onChange={(e) => onChange({ ...skillData, userPrompt: e.target.value })}
          rows={6}
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-500">
          定义用户请求的模板，可使用 {'{{input}}'} 等变量
        </p>
      </div>

      {/* 工具选择 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          允许使用的工具
        </label>
        <div className="flex flex-wrap gap-2">
          {COMMON_TOOLS.map((tool) => (
            <button
              key={tool}
              type="button"
              onClick={() => {
                const tools = skillData.tools.includes(tool)
                  ? skillData.tools.filter((t) => t !== tool)
                  : [...skillData.tools, tool];
                onChange({ ...skillData, tools });
              }}
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                skillData.tools.includes(tool)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {tool}
            </button>
          ))}
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
          disabled={!isValid()}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          下一步：创建测试用例
        </button>
      </div>
    </div>
  );
}
