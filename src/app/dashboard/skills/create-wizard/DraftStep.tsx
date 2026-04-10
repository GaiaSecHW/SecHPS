'use client';

import { useState, useEffect } from 'react';
import { Sparkles, FileText, Copy, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface SkillDraft {
  name: string;
  displayName: string;
  description: string;
  category: string;
  techStack: string[];
  cwe?: string;
  content: string;  // 完整的 Markdown 内容
}

interface Props {
  intentData: {
    name: string;
    description: string;
    category: string;
    techStack: string[];
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



export default function DraftStep({ intentData, researchData, skillData, onChange, onNext, onPrevious }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      console.log('[DraftStep] API 返回的 skill:', data.skill);
      onChange(data.skill);
    } catch (error) {
      console.error('生成 Skill 失败:', error);
      setGenerateError(error instanceof Error ? error.message : '生成失败，请重试');
      
      // 使用模板生成基础草稿
      const fallbackContent = generateMarkdownContent(intentData, researchData);
      
      const fallbackDraft: SkillDraft = {
        name: intentData.name || 'untitled-skill',
        displayName: intentData.name || 'Untitled Skill',
        description: intentData.description || '',
        category: intentData.category || 'code-audit',
        cwe: undefined,
        content: fallbackContent,
      };
      
      onChange(fallbackDraft);
    } finally {
      setIsGenerating(false);
    }
  };

  // 生成 Markdown 内容
  const generateMarkdownContent = (intent: any, research: any): string => {
    const lines: string[] = [];
    
    lines.push(`# ${intent.name || 'Skill 名称'}`);
    lines.push('');
    lines.push('## 描述');
    lines.push(intent.description || '简要描述这个 Skill 的作用...');
    lines.push('');
    
    if (intent.whatDoesItDo) {
      lines.push('## 功能说明');
      lines.push(intent.whatDoesItDo);
      lines.push('');
    }
    
    if (intent.whenShouldItTrigger) {
      lines.push('## 触发条件');
      lines.push(intent.whenShouldItTrigger);
      lines.push('');
    }
    
    if (intent.expectedOutput) {
      lines.push('## 期望输出');
      lines.push(intent.expectedOutput);
      lines.push('');
    }
    
    if (research.edgeCases && research.edgeCases.length > 0) {
      lines.push('## 边缘情况');
      research.edgeCases.forEach((ec: string) => {
        lines.push(`- ${ec}`);
      });
      lines.push('');
    }
    
    if (research.inputOutputFormats) {
      lines.push('## 输入输出格式');
      lines.push(research.inputOutputFormats);
      lines.push('');
    }
    
    if (research.successCriteria && research.successCriteria.length > 0) {
      lines.push('## 成功标准');
      research.successCriteria.forEach((sc: string) => {
        lines.push(`- ${sc}`);
      });
      lines.push('');
    }
    
    if (research.dependencies && research.dependencies.length > 0) {
      lines.push('## 依赖项');
      research.dependencies.forEach((dep: string) => {
        lines.push(`- ${dep}`);
      });
      lines.push('');
    }
    
    return lines.join('\n');
  };

  // 组件挂载时自动生成一次
  useEffect(() => {
    if (!skillData.content) {
      generateSkillDraft();
    }
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(skillData.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isValid = () => {
    return (
      skillData.name.trim() !== '' &&
      skillData.displayName.trim() !== '' &&
      skillData.description.trim() !== '' &&
      (skillData.content?.trim() ?? '') !== ''
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
              我们会根据你提供的信息自动生成 Skill 定义。你可以直接使用，也可以手动编辑优化。
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
              复制 Markdown
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

      {/* Markdown 内容 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          <FileText size={16} className="inline mr-1" />
          Skill 内容（Markdown 格式）<span className="text-red-500">*</span>
        </label>
        <textarea
          value={skillData.content}
          onChange={(e) => onChange({ ...skillData, content: e.target.value })}
          rows={20}
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
          placeholder="# Skill 名称

## 描述
简要描述这个 Skill 的作用...

## 系统提示词
你是一个专业的..."
        />
        <p className="mt-1 text-xs text-gray-500">
          完整的 Skill 定义，使用 Markdown 格式编写
        </p>
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
