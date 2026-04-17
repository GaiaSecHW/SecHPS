'use client';

import { useState, useEffect } from 'react';
import { HelpCircle, Lightbulb, Eye, X, Loader2, ChevronDown } from 'lucide-react';
import { useTechStackOptions } from '@/hooks/useTechStackOptions';

// 漏洞模式数据结构
interface VulnerabilityPattern {
  id: string;
  name: string;
  displayName: string;
  category: string;
  cwe?: string;
  languages?: string;
}

interface IntentData {
  name: string;
  description: string;
  category: string; // 保留用于兼容，但实际使用 vulnerabilityPatternId
  techStack: string[]; // 保留用于兼容，但实际使用 techStackId
  techStackId?: string; // 新增：单选语言 ID
  vulnerabilityPatternId?: string; // 新增：漏洞类型 ID
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
  const [skillOutputTemplate, setSkillOutputTemplate] = useState<string>('');
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  
  // 技术栈选择相关（单选）
  const [showTechStackDropdown, setShowTechStackDropdown] = useState(false);
  
  // 漏洞模式选择相关
  const [vulnerabilityPatterns, setVulnerabilityPatterns] = useState<VulnerabilityPattern[]>([]);
  const [patternCategories, setPatternCategories] = useState<Array<{ value: string; label: string }>>([]);
  const [loadingPatterns, setLoadingPatterns] = useState(true);
  const [showPatternDropdown, setShowPatternDropdown] = useState(false);
  
  // 使用 Hook 获取技术栈选项
  const { options: techStackOptions, categories: techStackCategories, loading: loadingTechStack } = useTechStackOptions();
  
  // 获取语言列表（从 categories.languages）
  const languageOptions = techStackCategories?.languages || techStackOptions || [];
  
  // 加载漏洞模式和分类（分别从两个 API）
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoadingPatterns(true);
        const token = localStorage.getItem('token');
        
        // 并行获取漏洞模式和分类
        const [patternsRes, categoriesRes] = await Promise.all([
          fetch('/api/vulnerability-patterns', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch('/api/admin/categories', {
            headers: { Authorization: `Bearer ${token}` },
          })
        ]);
        
        if (patternsRes.ok) {
          const patternsData = await patternsRes.json();
          setVulnerabilityPatterns(patternsData.patterns || []);
        }
        
        if (categoriesRes.ok) {
          const categoriesData = await categoriesRes.json();
          setPatternCategories(categoriesData.categories || []);
        }
      } catch (error) {
        console.error('加载漏洞模式失败:', error);
      } finally {
        setLoadingPatterns(false);
      }
    };
    fetchData();
  }, []);

  // 加载 Skill 标准输出模板（从系统配置）
  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/config', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const resData = await response.json();
          const activeConfig = resData.configs?.find((c: any) => c.isActive);
          if (activeConfig?.skillOutputTemplate) {
            setSkillOutputTemplate(activeConfig.skillOutputTemplate);
          }
        }
      } catch (error) {
        console.error('加载 Skill 标准输出模板失败:', error);
      }
    };
    fetchTemplate();
  }, []);

  const handleChange = (field: keyof IntentData, value: string | boolean | string[]) => {
    onChange({ ...data, [field]: value });
  };
  
  // 处理语言选择（单选）
  const handleLanguageSelect = (language: string) => {
    onChange({ 
      ...data, 
      techStack: [language], // 保持兼容性
      techStackId: language, // 新字段：语言名称作为 ID（或可改为实际 ID）
    });
    setShowTechStackDropdown(false);
  };
  
  // 处理漏洞模式选择
  const handlePatternSelect = (pattern: VulnerabilityPattern) => {
    onChange({
      ...data,
      category: pattern.category, // 保持兼容性
      vulnerabilityPatternId: pattern.id, // 新字段
    });
    setShowPatternDropdown(false);
  };
  
  // 获取选中的漏洞模式信息
  const getSelectedPattern = (): VulnerabilityPattern | null => {
    if (!data.vulnerabilityPatternId) return null;
    return vulnerabilityPatterns.find(p => p.id === data.vulnerabilityPatternId) || null;
  };

  const isValid = () => {
    return (
      data.name.trim() !== '' &&
      data.description.trim() !== '' &&
      data.whatDoesItDo.trim() !== '' &&
      data.whenShouldItTrigger.trim() !== '' &&
      (data.techStackId || data.techStack?.length > 0) && // 必须选择语言
      data.vulnerabilityPatternId // 必须选择漏洞类型
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

        {/* 漏洞类型选择 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            漏洞类型 <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPatternDropdown(!showPatternDropdown)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent flex items-center justify-between bg-white"
              disabled={loadingPatterns}
            >
              {loadingPatterns ? (
                <span className="text-gray-500">加载中...</span>
              ) : getSelectedPattern() ? (
                <span className="text-gray-900">
                  {getSelectedPattern()?.displayName}
                  {getSelectedPattern()?.cwe && (
                    <span className="text-gray-500 ml-2">({getSelectedPattern()?.cwe})</span>
                  )}
                </span>
              ) : (
                <span className="text-gray-500">请选择漏洞类型...</span>
              )}
              <ChevronDown size={16} className="text-gray-400" />
            </button>
            
            {/* 下拉选项 - 按分类分组 */}
            {showPatternDropdown && !loadingPatterns && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-80 overflow-y-auto">
                {patternCategories.map((category) => (
                  <div key={category.value}>
                    <div className="px-4 py-2 bg-gray-100 text-sm font-medium text-gray-700 border-b border-gray-200">
                      {category.label}
                    </div>
                    {vulnerabilityPatterns
                      .filter(p => p.category === category.value)
                      .map((pattern) => (
                        <button
                          key={pattern.id}
                          type="button"
                          onClick={() => handlePatternSelect(pattern)}
                          className={`w-full px-4 py-2 text-left hover:bg-gray-50 text-sm ${
                            data.vulnerabilityPatternId === pattern.id
                              ? 'bg-blue-50 text-blue-700'
                              : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span>{pattern.displayName}</span>
                            {pattern.cwe && (
                              <span className="text-xs text-gray-500">{pattern.cwe}</span>
                            )}
                          </div>
                        </button>
                      ))}
                  </div>
                ))}
                {vulnerabilityPatterns.length === 0 && (
                  <div className="px-4 py-2 text-sm text-gray-500">
                    暂无漏洞类型数据
                  </div>
                )}
              </div>
            )}
            {loadingPatterns && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg p-3">
                <div className="flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm text-gray-500">加载中...</span>
                </div>
              </div>
            )}
            <p className="mt-1 text-xs text-gray-500">
              选择此 Skill 要检测的漏洞类型
            </p>
          </div>
        </div>

        {/* 语言选择（单选） */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            适用语言 <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTechStackDropdown(!showTechStackDropdown)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent flex items-center justify-between bg-white"
              disabled={loadingTechStack}
            >
              {loadingTechStack ? (
                <span className="text-gray-500">加载中...</span>
              ) : data.techStackId ? (
                <span className="text-gray-900">{data.techStackId}</span>
              ) : (
                <span className="text-gray-500">请选择编程语言...</span>
              )}
              <ChevronDown size={16} className="text-gray-400" />
            </button>
            
            {/* 下拉选项 */}
            {showTechStackDropdown && !loadingTechStack && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                {languageOptions.map((language) => (
                  <button
                    key={language}
                    type="button"
                    onClick={() => handleLanguageSelect(language)}
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 text-sm ${
                      data.techStackId === language
                        ? 'bg-blue-50 text-blue-700'
                        : ''
                    }`}
                  >
                    {language}
                  </button>
                ))}
                {languageOptions.length === 0 && (
                  <div className="px-4 py-2 text-sm text-gray-500">
                    暂无语言数据
                  </div>
                )}
              </div>
            )}
            {loadingTechStack && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg p-3">
                <div className="flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm text-gray-500">加载中...</span>
                </div>
              </div>
            )}
            <p className="mt-1 text-xs text-gray-500">
              选择此 Skill 适用的编程语言
            </p>
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
          {skillOutputTemplate ? (
            <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs text-gray-500 mb-1">
                    系统已配置标准输出模板，Skill 将按照此格式输出结果
                  </p>
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
                    {skillOutputTemplate.length > 200 
                      ? skillOutputTemplate.substring(0, 200) + '...' 
                      : skillOutputTemplate}
                  </pre>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(true)}
                  className="ml-2 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                  title="查看完整模板"
                >
                  <Eye size={16} />
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
              <p className="text-sm text-yellow-800">
                系统尚未配置标准输出模板，请在"配置管理"中设置
              </p>
            </div>
          )}
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

      {/* 查看完整模板对话框 */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Skill 标准输出模板</h3>
                <p className="text-sm text-gray-500 mt-1">由系统配置定义，所有 Skill 统一使用此输出格式</p>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div>
              <pre className="text-sm bg-gray-50 p-4 rounded border border-gray-200 whitespace-pre-wrap overflow-x-auto font-mono">
                {skillOutputTemplate || '（未配置）'}
              </pre>
            </div>
            <div className="flex justify-end pt-4">
              <button
                onClick={() => setShowTemplateModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
