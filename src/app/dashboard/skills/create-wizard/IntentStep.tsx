'use client';

import { useState } from 'react';
import { HelpCircle, Lightbulb } from 'lucide-react';

const CATEGORIES = [
  { value: 'code-audit', label: '代码安全审计', description: '检测代码中的安全漏洞' },
  { value: 'auth', label: '认证与授权', description: '身份验证和权限控制问题' },
  { value: 'sensitive', label: '敏感信息泄露', description: '敏感数据暴露风险' },
  { value: 'api', label: 'API 安全', description: 'API 接口安全问题' },
  { value: 'config', label: '依赖与配置', description: '配置错误和依赖漏洞' },
  { value: 'crypto', label: '加密与数据', description: '加密算法和数据保护' },
  { value: 'web', label: 'Web 安全', description: '常见 Web 攻击防护' },
  { value: 'business', label: '业务逻辑', description: '业务流程安全风险' },
  { value: 'client', label: '客户端安全', description: '前端和客户端漏洞' },
  { value: 'cloud', label: '云与容器安全', description: '云服务和容器安全' },
];

interface IntentData {
  name: string;
  description: string;
  category: string;
  whatDoesItDo: string;
  whenShouldItTrigger: string;
  expectedOutput: string;
  needsTestCases: boolean;
}

interface Props {
  data: IntentData;
  onChange: (data: IntentData) => void;
  onNext: () => void;
}

export default function IntentStep({ data, onChange, onNext }: Props) {
  const [showExamples, setShowExamples] = useState(false);

  const handleChange = (field: keyof IntentData, value: string | boolean) => {
    onChange({ ...data, [field]: value });
  };

  const isValid = () => {
    return (
      data.name.trim() !== '' &&
      data.description.trim() !== '' &&
      data.whatDoesItDo.trim() !== '' &&
      data.whenShouldItTrigger.trim() !== ''
    );
  };

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <HelpCircle className="w-5 h-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-2">这一步做什么？</p>
            <p className="text-blue-700">
              告诉我们你想创建什么样的 Skill。我们会根据你的描述，帮助你生成一个高质量的 Skill 定义。
              请尽量详细地描述你的需求。
            </p>
          </div>
        </div>
      </div>

      {/* Skill 基本信息 */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Skill 名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={data.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="例如：sql-injection-detector"
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-gray-500">
            使用英文小写字母和连字符，简洁明了地描述 Skill 的功能
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            简短描述 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={data.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder="一句话描述这个 Skill 的作用"
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-gray-500">
            这会显示在 Skill 列表中，帮助用户快速了解
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            分类 <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => handleChange('category', cat.value)}
                className={`px-4 py-3 rounded-md border-2 transition-all text-left ${
                  data.category === cat.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="font-medium text-sm">{cat.label}</div>
                <div className="text-xs text-gray-500 mt-1">{cat.description}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 详细需求 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">详细需求</h3>
          <button
            type="button"
            onClick={() => setShowExamples(!showExamples)}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
          >
            <Lightbulb size={16} className="mr-1" />
            {showExamples ? '隐藏示例' : '显示示例'}
          </button>
        </div>

        {showExamples && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <p className="text-sm font-medium text-gray-700 mb-2">示例回答：</p>
            <div className="space-y-3 text-sm text-gray-600">
              <div>
                <span className="font-medium">功能：</span>
                检测代码中的 SQL 注入漏洞，包括字符串拼接、参数化查询缺失等情况
              </div>
              <div>
                <span className="font-medium">触发时机：</span>
                当用户上传 Java、Python、PHP 等后端代码文件时，或在代码审计项目中
              </div>
              <div>
                <span className="font-medium">期望输出：</span>
                包含漏洞位置、代码片段、风险等级、修复建议的结构化报告
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            这个 Skill 要做什么？ <span className="text-red-500">*</span>
          </label>
          <textarea
            value={data.whatDoesItDo}
            onChange={(e) => handleChange('whatDoesItDo', e.target.value)}
            rows={3}
            placeholder="详细描述 Skill 的功能，例如：检测什么类型的问题，使用什么方法..."
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            什么时候应该触发这个 Skill？ <span className="text-red-500">*</span>
          </label>
          <textarea
            value={data.whenShouldItTrigger}
            onChange={(e) => handleChange('whenShouldItTrigger', e.target.value)}
            rows={3}
            placeholder="描述触发条件，例如：用户上传代码文件、用户提到安全审计、在特定类型的项目中..."
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            期望的输出是什么？
          </label>
          <textarea
            value={data.expectedOutput}
            onChange={(e) => handleChange('expectedOutput', e.target.value)}
            rows={3}
            placeholder="描述输出格式和内容，例如：包含漏洞列表的 JSON、带修复建议的 Markdown 报告..."
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-gray-500">
            如果不确定，可以留空，我们会在后续步骤中帮你完善
          </p>
        </div>

        <div>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={data.needsTestCases}
              onChange={(e) => handleChange('needsTestCases', e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="ml-2 text-sm text-gray-700">
              我需要创建测试用例来验证 Skill 的效果
            </span>
          </label>
          <p className="mt-1 text-xs text-gray-500 ml-6">
            建议勾选，测试用例可以帮助验证和改进 Skill
          </p>
        </div>
      </div>

      {/* 下一步按钮 */}
      <div className="flex justify-end pt-4 border-t">
        <button
          onClick={onNext}
          disabled={!isValid()}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          下一步：调研访谈
        </button>
      </div>
    </div>
  );
}
