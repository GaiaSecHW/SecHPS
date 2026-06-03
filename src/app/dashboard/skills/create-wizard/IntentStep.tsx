'use client';

import { useState, useEffect } from 'react';
import { HelpCircle, Lightbulb, Eye, X } from 'lucide-react';
import { ProductTagSelect } from '@/components/skills/ProductTagSelect';

interface CategoryItem {
  id: string;
  name: string;
  displayName: string;
  icon: string | null;
  hasSubDimension: boolean;
}

interface AttackPatternNode {
  id: number;
  name: string;
  parent_id: number | null;
  level: number;
  library_id: number;
}

interface IntentData {
  name: string;
  description: string;
  categoryId: string;
  vulnerabilityTreeId?: number | null;
  selectedLanguageId?: number | '';
  selectedVulnCategoryId?: number | '';
  selectedVulnSubcategoryId?: number | '';
  productTagIds?: string[];
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

const VULNERABILITY_CATEGORY_ID = 'cat-vulnerability-mining';

export default function IntentStep({ data, onChange, onNext }: Props) {
  const [showExamples, setShowExamples] = useState(false);
  const [skillOutputTemplate, setSkillOutputTemplate] = useState<string>('');
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [attackNodes, setAttackNodes] = useState<AttackPatternNode[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);

  useEffect(() => {
    const fetchCategories = async () => {
      setLoadingCategories(true);
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/skills/categories', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const d = await res.json();
          setCategories(d.categories || []);
          if (!data.categoryId) {
            const vulnCat = (d.categories || []).find((c: CategoryItem) => c.id === VULNERABILITY_CATEGORY_ID);
            if (vulnCat) {
              onChange({ ...data, categoryId: VULNERABILITY_CATEGORY_ID });
            }
          }
        }
      } catch (e) {
        console.error('加载分类失败:', e);
      } finally {
        setLoadingCategories(false);
      }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    if (attackNodes.length === 0) {
      const fetchTree = async () => {
        setLoadingTree(true);
        try {
          const token = localStorage.getItem('token');
          const res = await fetch('/api/skills/vulnerability-tree', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const d = await res.json();
            setAttackNodes(d.nodes || []);
          }
        } catch (e) {
          console.error('加载漏洞树失败:', e);
        } finally {
          setLoadingTree(false);
        }
      };
      fetchTree();
    }
  }, [attackNodes.length]);

  const selectedCategory = categories.find(c => c.id === data.categoryId);

  // 从 attackNodes 派生各级数据
  const languages = attackNodes.filter(n => n.level === 0);
  const getChildren = (parentId: number) => attackNodes.filter(n => n.parent_id === parentId);
  const isLeaf = (id: number) => !attackNodes.some(n => n.parent_id === id);

  const selectedLanguage = attackNodes.find(n => n.id === data.selectedLanguageId);
  const vulnCategories = selectedLanguage ? getChildren(selectedLanguage.id) : [];
  const selectedVulnCat = attackNodes.find(n => n.id === data.selectedVulnCategoryId);
  const vulnSubcategories = selectedVulnCat ? getChildren(selectedVulnCat.id) : [];
  const selectedVulnSub = attackNodes.find(n => n.id === data.selectedVulnSubcategoryId);
  const availablePatterns = selectedVulnSub ? getChildren(selectedVulnSub.id).filter(n => isLeaf(n.id)) : [];

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

  const handleChange = (field: keyof IntentData, value: string | boolean | string[] | number | null) => {
    onChange({ ...data, [field]: value });
  };

  const isValid = () => {
    if (!data.name.trim() || !data.description.trim()) return false;
    if (!data.whatDoesItDo.trim() || !data.whenShouldItTrigger.trim()) return false;
    if (!data.categoryId) return false;
    const cat = categories.find(c => c.id === data.categoryId);
    if (cat?.hasSubDimension && !data.vulnerabilityTreeId) return false;
    return true;
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
        <div className="flex items-start">
          <HelpCircle className="w-4 h-4 text-blue-400 mt-0.5 mr-2 flex-shrink-0" />
          <div className="text-xs">
            <p className="font-medium text-blue-300 mb-1">这一步做什么？</p>
            <p className="text-gray-400">
              告诉我们你想创建什么样的 Skill。我们会根据你的描述，帮助你生成一个高质量的 Skill 定义。
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Skill 名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={data.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="例如：sql-injection-detector"
            className="w-full px-3 py-1.5 text-sm bg-dark-bg border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-200"
          />
          <p className="mt-1 text-xs text-gray-500">
            使用英文小写字母和连字符，简洁明了地描述 Skill 的功能
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            简短描述 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={data.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder="一句话描述这个 Skill 的作用"
            className="w-full px-3 py-1.5 text-sm bg-dark-bg border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-200"
          />
        </div>

        {/* SKILL类型和语言放在同一行 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              SKILL类型 <span className="text-red-500">*</span>
            </label>
            <select
              value={data.categoryId}
              onChange={(e) => {
                onChange({
                  ...data,
                  categoryId: e.target.value,
                  selectedLanguageId: '',
                  selectedVulnCategoryId: '',
                  selectedVulnSubcategoryId: '',
                  vulnerabilityTreeId: null,
                });
              }}
              disabled={loadingCategories}
              className="w-full px-3 py-1.5 text-sm bg-dark-bg border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-200"
            >
              <option value="">请选择分类</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.icon ? cat.icon + ' ' : ''}{cat.displayName}
                </option>
              ))}
            </select>
          </div>

          {selectedCategory?.hasSubDimension && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                模式库 <span className="text-red-500">*</span>
              </label>
              <select
                value={data.selectedLanguageId || ''}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : '';
                  onChange({
                    ...data,
                    selectedLanguageId: val,
                    selectedVulnCategoryId: '',
                    selectedVulnSubcategoryId: '',
                    vulnerabilityTreeId: null,
                  });
                }}
                disabled={loadingTree}
                className="w-full px-3 py-1.5 text-sm bg-dark-bg border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-200"
              >
                <option value="">请选择模式库</option>
                {languages.map(lang => (
                  <option key={lang.id} value={lang.id}>{lang.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {selectedCategory?.hasSubDimension && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  漏洞类型 <span className="text-red-500">*</span>
                </label>
                <select
                  value={data.selectedVulnCategoryId || ''}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : '';
                    onChange({
                      ...data,
                      selectedVulnCategoryId: val,
                      selectedVulnSubcategoryId: '',
                      vulnerabilityTreeId: null,
                    });
                  }}
                  disabled={loadingTree || vulnCategories.length === 0}
                  className="w-full px-3 py-1.5 text-sm bg-dark-bg border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-200"
                >
                  <option value="">请选择类型</option>
                  {vulnCategories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  漏洞分类
                </label>
                <select
                  value={data.selectedVulnSubcategoryId || ''}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : '';
                    onChange({
                      ...data,
                      selectedVulnSubcategoryId: val,
                      vulnerabilityTreeId: null,
                    });
                  }}
                  disabled={loadingTree || !data.selectedVulnCategoryId || vulnSubcategories.length === 0}
                  className="w-full px-3 py-1.5 text-sm bg-dark-bg border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-200"
                >
                  <option value="">请选择分类</option>
                  {vulnSubcategories.map(sub => (
                    <option key={sub.id} value={sub.id}>{sub.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  具体模式
                </label>
                <select
value={data.vulnerabilityTreeId ?? ''}
                  onChange={(e) => handleChange('vulnerabilityTreeId', e.target.value ? Number(e.target.value) : null)}
                  disabled={loadingTree || !data.selectedVulnSubcategoryId || availablePatterns.length === 0}
                  className="w-full px-3 py-1.5 text-sm bg-dark-bg border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-200"
                >
                  <option value="">请选择模式</option>
                  {availablePatterns.map(pat => (
                    <option key={pat.id} value={pat.id}>{pat.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              依次选择模式库、漏洞类型、分类和具体模式
            </p>
          </>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          适用产品 <span className="text-xs text-gray-400">（不选则适用于所有产品）</span>
        </label>
        <ProductTagSelect
          selectedIds={data.productTagIds || []}
          onChange={(ids) => handleChange('productTagIds', ids)}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium text-gray-100">详细需求</h3>
          <button
            type="button"
            onClick={() => setShowExamples(!showExamples)}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center"
          >
            <Lightbulb size={14} className="mr-1" />
            {showExamples ? '隐藏示例' : '显示示例'}
          </button>
        </div>

        {showExamples && (
          <div className="bg-dark-bg border border-gray-700/50 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-300 mb-2">示例回答：</p>
            <div className="space-y-2 text-xs text-gray-400">
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
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            这个 Skill 要做什么？ <span className="text-red-500">*</span>
          </label>
          <textarea
            value={data.whatDoesItDo}
            onChange={(e) => handleChange('whatDoesItDo', e.target.value)}
            rows={2}
            placeholder="详细描述 Skill 的功能，例如：检测什么类型的问题，使用什么方法..."
            className="w-full px-3 py-1.5 text-sm bg-dark-bg border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-200"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            什么时候应该触发这个 Skill？ <span className="text-red-500">*</span>
          </label>
          <textarea
            value={data.whenShouldItTrigger}
            onChange={(e) => handleChange('whenShouldItTrigger', e.target.value)}
            rows={2}
            placeholder="描述触发条件，例如：用户上传代码文件、用户提到安全审计、在特定类型的项目中..."
            className="w-full px-3 py-1.5 text-sm bg-dark-bg border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-200"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            期望的输出是什么？
          </label>
          {skillOutputTemplate ? (
            <div className="bg-dark-bg border border-gray-700/50 rounded-md p-2">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs text-gray-500 mb-1">
                    系统已配置标准输出模板，Skill 将按照此格式输出结果
                  </p>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono max-h-20 overflow-y-auto">
                    {skillOutputTemplate.length > 150
                      ? skillOutputTemplate.substring(0, 150) + '...'
                      : skillOutputTemplate}
                  </pre>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(true)}
                  className="ml-2 p-1 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded"
                  title="查看完整模板"
                >
                  <Eye size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-md p-2">
              <p className="text-xs text-blue-300">
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
              className="w-4 h-4 text-blue-400 border-gray-600 rounded focus:ring-primary-500 bg-dark-bg"
            />
            <span className="ml-2 text-sm text-gray-300">
              我需要创建测试用例来验证 Skill 的效果
            </span>
          </label>
          <p className="mt-1 text-xs text-gray-500 ml-6">
            建议勾选，测试用例可以帮助验证和改进 Skill
          </p>
        </div>
      </div>

      <div className="flex justify-end pt-3 border-t border-gray-700/50">
        <button
          onClick={onNext}
          disabled={!isValid()}
          className="px-5 py-1.5 text-sm bg-purple-500 text-white rounded-md hover:bg-purple-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          下一步：调研访谈
        </button>
      </div>

      {showTemplateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-dark-surface rounded-lg p-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-base font-medium text-gray-100">Skill 标准输出模板</h3>
                <p className="text-xs text-gray-500 mt-1">由系统配置定义，所有 Skill 统一使用此输出格式</p>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="text-gray-400 hover:text-gray-200"
              >
                <X size={18} />
              </button>
            </div>
            <div>
              <pre className="text-xs bg-dark-bg p-3 rounded border border-gray-700/50 whitespace-pre-wrap overflow-x-auto font-mono">
                {skillOutputTemplate || '（未配置）'}
              </pre>
            </div>
            <div className="flex justify-end pt-3">
              <button
                onClick={() => setShowTemplateModal(false)}
                className="px-3 py-1.5 text-sm border border-gray-600 rounded-md text-gray-300 hover:bg-dark-bg"
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