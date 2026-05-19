'use client';

import { useState, useEffect } from 'react';
import { Sparkles, FileText, Copy, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { buildFullSkill, getSkillDefaultTemplate, type SkillIntent } from '@/lib/skill-builder';

interface SkillDraft {
  name: string;
  displayName: string;
  description: string;
  vulnerabilityTreeId?: string;
  categoryId?: string;
  cwe?: string;
  content: string;  // 完整的 Markdown 内容
}

interface Props {
  intentData: {
    name: string;
    description: string;
    categoryId: string;
    vulnerabilityTreeId?: string;
    selectedLanguageId?: string;
    whatDoesItDo: string;
    whenShouldItTrigger: string;
    expectedOutput: string;
    needsTestCases: boolean;
    cwe?: string;
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
      
      // 使用公共模块模板作为 fallback
      const defaultTemplate = getSkillDefaultTemplate();
      
      // 替换模板中的占位符
      const fallbackContent = defaultTemplate
        .replace(/\[漏洞类型\]/g, intentData.name || '安全漏洞')
        .replace(/\[漏洞名称\]/g, intentData.name || '安全漏洞')
        .replace(/\[语言列表\]/g, 'Java, Python, PHP, Node.js')
        .replace(/skill-name/g, intentData.name?.toLowerCase().replace(/\s+/g, '-') || 'untitled-skill')
        .replace(/CWE-XXX/g, intentData.cwe || 'CWE-XXX');
      
      const fallbackDraft: SkillDraft = {
        name: intentData.name || 'untitled-skill',
        displayName: intentData.name || 'Untitled Skill',
        description: intentData.description || '',
        cwe: intentData.cwe,
        content: fallbackContent,
      };
      
      onChange(fallbackDraft);
    } finally {
      setIsGenerating(false);
    }
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
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <div className="flex items-start">
          <Sparkles className="w-5 h-5 text-blue-400 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-blue-300 mb-2">AI 自动生成</p>
            <p className="text-gray-400">
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
          className="inline-flex items-center px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A]"
        >
          {copied ? (
            <>
              <Check size={16} className="mr-2 text-green-400" />
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
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-blue-400 mt-0.5 mr-3 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-blue-300 mb-1">使用了本地模板生成</p>
              <p className="text-gray-400">{generateError}</p>
            </div>
          </div>
        </div>
      )}

      {/* 基本信息 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Skill 名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={skillData.name}
            onChange={(e) => onChange({ ...skillData, name: e.target.value })}
            className="w-full px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            显示名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={skillData.displayName}
            onChange={(e) => onChange({ ...skillData, displayName: e.target.value })}
            className="w-full px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          描述 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={skillData.description}
          onChange={(e) => onChange({ ...skillData, description: e.target.value })}
          className="w-full px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            CWE 编号（可选）
          </label>
          <input
            type="text"
            value={skillData.cwe || ''}
            onChange={(e) => onChange({ ...skillData, cwe: e.target.value })}
            placeholder="例如：CWE-89"
            className="w-full px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            漏洞模式
          </label>
          <input
            type="text"
            value={skillData.vulnerabilityTreeId || ''}
            disabled
            className="w-full px-4 py-2 border border-gray-600 rounded-md bg-[#0F172A]"
          />
        </div>
      </div>

      {/* Markdown 内容 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          <FileText size={16} className="inline mr-1" />
          Skill 内容（Markdown 格式）<span className="text-red-500">*</span>
        </label>
        <textarea
          value={skillData.content}
          onChange={(e) => onChange({ ...skillData, content: e.target.value })}
          rows={20}
          className="w-full px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
          placeholder={`> 你是一个资深安全工程师，专注于 [漏洞类型] 分析...

## 输入格式
你将接收：
- 源代码文件（[语言列表]）
- 文件路径和函数上下文

## 检测目标
识别代码中 [具体漏洞类型] 的风险点...

## 示例（重要！）
### 示例 1：基础漏洞
...

## 陷阱与边缘情况
...`}
        />
        <p className="mt-1 text-xs text-gray-500">
          完整的 Skill 定义，使用 Markdown 格式编写
        </p>
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
          disabled={!isValid()}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          下一步：创建测试用例
        </button>
      </div>
    </div>
  );
}
