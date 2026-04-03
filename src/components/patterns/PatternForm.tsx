'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';

export interface PatternFormData {
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string;
  cve: string;
  patterns: string[];
  languages: string[];
  exampleVulnerable: string;
  exampleFixed: string;
  fixGuidance: string;
  isActive: boolean;
}

interface PatternFormProps {
  initialData?: Partial<PatternFormData>;
  onSubmit: (data: PatternFormData) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
  isBuiltin?: boolean;
}

const categoryOptions = [
  { value: 'code-audit', label: '代码安全审计' },
  { value: 'auth', label: '认证与授权' },
  { value: 'sensitive', label: '敏感信息泄露' },
  { value: 'api', label: 'API 安全' },
  { value: 'config', label: '依赖与配置' },
  { value: 'crypto', label: '加密与数据' },
  { value: 'web', label: 'Web 安全' },
  { value: 'business', label: '业务逻辑' },
  { value: 'client', label: '客户端安全' },
  { value: 'cloud', label: '云与容器安全' },
];

const languageOptions = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C', 'C++',
  'PHP', 'Ruby', 'Swift', 'Kotlin', 'C#', 'SQL', 'Bash', 'YAML', 'JSON',
];

export default function PatternForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  isBuiltin = false,
}: PatternFormProps) {
  const [formData, setFormData] = useState<PatternFormData>({
    name: initialData?.name || '',
    displayName: initialData?.displayName || '',
    description: initialData?.description || '',
    category: initialData?.category || 'code-audit',
    cwe: initialData?.cwe || '',
    cve: initialData?.cve || '',
    patterns: initialData?.patterns || [],
    languages: initialData?.languages || [],
    exampleVulnerable: initialData?.exampleVulnerable || '',
    exampleFixed: initialData?.exampleFixed || '',
    fixGuidance: initialData?.fixGuidance || '',
    isActive: initialData?.isActive ?? true,
  });

  const [newPattern, setNewPattern] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setFormData((prev) => ({
        ...prev,
        [name]: (e.target as HTMLInputElement).checked,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const handleAddPattern = () => {
    if (newPattern.trim() && !formData.patterns.includes(newPattern.trim())) {
      setFormData((prev) => ({
        ...prev,
        patterns: [...prev.patterns, newPattern.trim()],
      }));
      setNewPattern('');
    }
  };

  const handleRemovePattern = (pattern: string) => {
    setFormData((prev) => ({
      ...prev,
      patterns: prev.patterns.filter((p) => p !== pattern),
    }));
  };

  const handleLanguageToggle = (language: string) => {
    setFormData((prev) => ({
      ...prev,
      languages: prev.languages.includes(language)
        ? prev.languages.filter((l) => l !== language)
        : [...prev.languages, language],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setError('模式名称不能为空');
      return;
    }
    if (!formData.displayName.trim()) {
      setError('显示名称不能为空');
      return;
    }
    if (!formData.description.trim()) {
      setError('描述不能为空');
      return;
    }
    if (formData.languages.length === 0) {
      setError('请至少选择一种编程语言');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* 基本信息 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">基本信息</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              模式名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              disabled={isEditing && isBuiltin}
              placeholder="例如：sql-injection"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-gray-500">唯一标识符，使用小写字母和连字符</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              显示名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="displayName"
              value={formData.displayName}
              onChange={handleChange}
              placeholder="例如：SQL 注入漏洞"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              分类 <span className="text-red-500">*</span>
            </label>
            <select
              name="category"
              value={formData.category}
              onChange={handleChange}
              disabled={isEditing && isBuiltin}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {categoryOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">启用状态</label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleChange}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span className="text-sm text-gray-700">启用此模式</span>
            </label>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              描述 <span className="text-red-500">*</span>
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={3}
              placeholder="描述此漏洞模式的特点和危害"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* CWE/CVE 映射 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">CWE/CVE 映射</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CWE 编号</label>
            <input
              type="text"
              name="cwe"
              value={formData.cwe}
              onChange={handleChange}
              placeholder="例如：CWE-89"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CVE 编号</label>
            <input
              type="text"
              name="cve"
              value={formData.cve}
              onChange={handleChange}
              placeholder="例如：CVE-2023-12345"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* 检测规则 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">检测模式</h3>
        <p className="text-sm text-gray-600 mb-4">
          添加用于检测此漏洞的模式字符串（如正则表达式、关键词等）
        </p>

        <div className="flex space-x-2 mb-4">
          <input
            type="text"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="输入检测模式"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddPattern())}
          />
          <button
            type="button"
            onClick={handleAddPattern}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus size={20} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {formData.patterns.map((pattern) => (
            <span
              key={pattern}
              className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm"
            >
              {pattern}
              <button
                type="button"
                onClick={() => handleRemovePattern(pattern)}
                className="ml-2 text-blue-500 hover:text-blue-700"
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* 适用语言 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          适用语言 <span className="text-red-500">*</span>
        </h3>

        <div className="flex flex-wrap gap-2">
          {languageOptions.map((language) => (
            <button
              key={language}
              type="button"
              onClick={() => handleLanguageToggle(language)}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${
                formData.languages.includes(language)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {language}
            </button>
          ))}
        </div>
      </div>

      {/* 代码示例 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">代码示例</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              漏洞示例代码
            </label>
            <textarea
              name="exampleVulnerable"
              value={formData.exampleVulnerable}
              onChange={handleChange}
              rows={6}
              placeholder="// 存在漏洞的代码示例"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              修复示例代码
            </label>
            <textarea
              name="exampleFixed"
              value={formData.exampleFixed}
              onChange={handleChange}
              rows={6}
              placeholder="// 修复后的代码示例"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* 修复建议 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">修复建议</h3>

        <textarea
          name="fixGuidance"
          value={formData.fixGuidance}
          onChange={handleChange}
          rows={4}
          placeholder="提供修复此漏洞的详细建议和最佳实践"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* 提交按钮 */}
      <div className="flex justify-end space-x-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '保存中...' : isEditing ? '更新模式' : '创建模式'}
        </button>
      </div>
    </form>
  );
}
