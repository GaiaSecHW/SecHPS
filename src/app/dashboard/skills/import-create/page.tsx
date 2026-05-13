'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle,
  FileUp,
  Eye,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import { ProductTagSelect } from '@/components/skills/ProductTagSelect';
import { hasPermission } from '@/lib/permissions';
import { getFormatGuideData } from '@/lib/skill-builder';

const FORMAT_GUIDE = getFormatGuideData();
const VULNERABILITY_CATEGORY_ID = 'cat-vulnerability-mining';

interface ParsedSkill {
  name: string;
  displayName: string;
  description: string;
  content: string;
  cwe?: string;
}

function parseSkillMarkdown(content: string): ParsedSkill | null {
  try {
    let name = '';
    let description = '';
    let bodyContent = content;

    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const nameMatch = frontmatter.match(/name:\s*(.+)/);
      const descMatch = frontmatter.match(/description:\s*(?:\n([\s\S]*?)\n\s*\S|$)|description:\s*(.+)/);
      
      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) {
        description = descMatch[1] ? descMatch[1].trim() : (descMatch[2] ? descMatch[2].trim() : '');
      }
      
      bodyContent = content.substring(frontmatterMatch[0].length);
    }

    const titleMatch = bodyContent.match(/^#\s+(.+)\s*\n/);
    let displayName = '';
    if (titleMatch) {
      displayName = titleMatch[1].trim();
    }

    if (!name) {
      const firstLine = bodyContent.split('\n')[0];
      name = firstLine.replace(/^#\s+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || 'imported-skill';
    }

    if (!displayName) {
      displayName = name;
    }

    if (!description) {
      const lines = bodyContent.split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('>')) {
          description = line.substring(0, 200);
          break;
        }
      }
      if (!description) description = displayName;
    }

    const cweMatch = content.match(/CWE-(\d+)/i);
    const cwe = cweMatch ? `CWE-${cweMatch[1]}` : undefined;

    return {
      name,
      displayName,
      description,
      content,
      cwe,
    };
  } catch (e) {
    console.error('解析 Skill 文件失败:', e);
    return null;
  }
}

export default function ImportCreateSkillPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPublic, setIsPublic] = useState(false);

  const [categoryId, setCategoryId] = useState<string>(VULNERABILITY_CATEGORY_ID);
  const [selectedLanguageId, setSelectedLanguageId] = useState<string>('');
  const [selectedVulnCategoryId, setSelectedVulnCategoryId] = useState<string>('');
  const [selectedVulnSubcategoryId, setSelectedVulnSubcategoryId] = useState<string>('');
  const [vulnerabilityTreeId, setVulnerabilityTreeId] = useState<string | null>(null);
  const [productTagIds, setProductTagIds] = useState<string[]>([]);

  const [categories, setCategories] = useState<Array<{ id: string; name: string; displayName: string; description?: string; icon?: string; hasSubDimension: boolean }>>([]);
  const [languages, setLanguages] = useState<Array<{ id: string; name: string; displayName: string }>>([]);
  const [vulnCategories, setVulnCategories] = useState<Array<{ id: string; name: string; displayName: string }>>([]);
  const [vulnSubcategories, setVulnSubcategories] = useState<Array<{ id: string; name: string; displayName: string; parentId: string | null }>>([]);
  const [vulnPatterns, setVulnPatterns] = useState<Array<{ id: string; name: string; displayName: string; parentId: string | null }>>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedSkill, setParsedSkill] = useState<ParsedSkill | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillDisplayName, setSkillDisplayName] = useState('');
  const [skillDescription, setSkillDescription] = useState('');
  const [skillContent, setSkillContent] = useState('');
  const [showPreview, setShowPreview] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE));
      } catch (e) {
        console.error('解析 token 失败:', e);
      }
    }

    const fetchData = async () => {
      setLoadingData(true);
      try {
        const t = localStorage.getItem('token');
        const [catRes, treeRes] = await Promise.all([
          fetch('/api/skills/categories', { headers: { Authorization: `Bearer ${t}` } }),
          fetch('/api/skills/vulnerability-tree', { headers: { Authorization: `Bearer ${t}` } }),
        ]);

        if (catRes.ok) {
          const data = await catRes.json();
          setCategories(data.categories || []);
        }
        if (treeRes.ok) {
          const data = await treeRes.json();
          setLanguages(data.tree || []);
          setVulnCategories(data.categories || []);
          setVulnSubcategories(data.subcategories || []);
          setVulnPatterns(data.patterns || []);
        }
      } catch (e) {
        console.error('获取数据失败:', e);
      } finally {
        setLoadingData(false);
      }
    };
    fetchData();
  }, []);

  const selectedCategory = categories.find(c => c.id === categoryId);

  const availableSubcategories = vulnSubcategories.filter(
    s => s.parentId === selectedVulnCategoryId
  );
  const availablePatterns = vulnPatterns.filter(
    p => p.parentId === selectedVulnSubcategoryId
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.md')) {
      setError('请上传 Markdown (.md) 格式的 Skill 文件');
      return;
    }

    setUploadedFile(file);
    setError('');

    try {
      const content = await file.text();
      const parsed = parseSkillMarkdown(content);

      if (!parsed) {
        setError('无法解析 Skill 文件，请检查文件格式');
        return;
      }

      setParsedSkill(parsed);
      setSkillName(parsed.name);
      setSkillDisplayName(parsed.displayName);
      setSkillDescription(parsed.description);
      setSkillContent(parsed.content);
    } catch (e) {
      setError('读取文件失败');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!skillName.trim()) {
      setError('请输入 Skill 名称');
      return;
    }

    if (!categoryId) {
      setError('请选择分类');
      return;
    }

    const cat = categories.find(c => c.id === categoryId);
    if (cat?.hasSubDimension && !vulnerabilityTreeId) {
      setError('请选择漏洞模式');
      return;
    }

    if (!skillContent.trim()) {
      setError('请上传 Skill 文件');
      return;
    }

    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: skillName.trim(),
          displayName: skillDisplayName.trim() || skillName.trim(),
          description: skillDescription.trim() || skillName.trim(),
          categoryId: categoryId,
          vulnerabilityTreeId: vulnerabilityTreeId || null,
          productTagIds: productTagIds,
          content: skillContent,
          isPublic,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || data.details?.error || '创建失败');
      }

      router.push('/dashboard/skills');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-dark-surface-hover rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-100">导入创建 Skill</h1>
            <p className="text-sm text-gray-400">上传 Markdown 文件快速创建 Skill</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-900/20 border border-red-200 text-red-400 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              上传 Skill 文件 <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".md"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-green-600 to-teal-500 text-white rounded-lg hover:from-green-500 hover:to-teal-400 text-sm transition-all"
              >
                <FileUp size={16} className="mr-1.5" />
                选择 .md 文件
              </button>
              {uploadedFile && (
                <span className="text-sm text-gray-400">
                  已选择: {uploadedFile.name}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              支持 YAML frontmatter 格式的 Markdown 文件，系统会自动解析 name、description 等字段
            </p>
          </div>

          {parsedSkill && (
            <>
              <div className="border-t border-gray-700/50 pt-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">解析结果（可修改）</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Skill 名称</label>
                    <input
                      type="text"
                      value={skillName}
                      onChange={(e) => setSkillName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">显示名称</label>
                    <input
                      type="text"
                      value={skillDisplayName}
                      onChange={(e) => setSkillDisplayName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-sm text-gray-400 mb-1">描述</label>
                  <input
                    type="text"
                    value={skillDescription}
                    onChange={(e) => setSkillDescription(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    分类 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={categoryId}
                    onChange={(e) => {
                      setCategoryId(e.target.value);
                      setSelectedLanguageId('');
                      setSelectedVulnCategoryId('');
                      setSelectedVulnSubcategoryId('');
                      setVulnerabilityTreeId(null);
                    }}
                    className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    disabled={loadingData}
                  >
                    <option value="">{loadingData ? '加载中...' : '请选择分类'}</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.displayName}</option>
                    ))}
                  </select>
                </div>

                {selectedCategory?.hasSubDimension && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        语言
                      </label>
                      <select
                        value={selectedLanguageId}
                        onChange={(e) => setSelectedLanguageId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        disabled={loadingData}
                      >
                        <option value="">请选择语言</option>
                        {languages.map(lang => (
                          <option key={lang.id} value={lang.id}>{lang.displayName}</option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        漏洞模式 <span className="text-red-500">*</span>
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <select
                          value={selectedVulnCategoryId}
                          onChange={(e) => {
                            setSelectedVulnCategoryId(e.target.value);
                            setSelectedVulnSubcategoryId('');
                            setVulnerabilityTreeId(null);
                          }}
                          className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          disabled={loadingData || vulnCategories.length === 0}
                        >
                          <option value="">请选择类型</option>
                          {vulnCategories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.displayName}</option>
                          ))}
                        </select>

                        <select
                          value={selectedVulnSubcategoryId}
                          onChange={(e) => {
                            setSelectedVulnSubcategoryId(e.target.value);
                            setVulnerabilityTreeId(null);
                          }}
                          className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          disabled={loadingData || !selectedVulnCategoryId || availableSubcategories.length === 0}
                        >
                          <option value="">请选择分类</option>
                          {availableSubcategories.map(sub => (
                            <option key={sub.id} value={sub.id}>{sub.displayName}</option>
                          ))}
                        </select>

                        <select
                          value={vulnerabilityTreeId || ''}
                          onChange={(e) => setVulnerabilityTreeId(e.target.value || null)}
                          className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          disabled={loadingData || !selectedVulnSubcategoryId || availablePatterns.length === 0}
                        >
                          <option value="">请选择模式</option>
                          {availablePatterns.map(pat => (
                            <option key={pat.id} value={pat.id}>{pat.displayName}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  适用产品 <span className="text-xs text-gray-400">（不选则适用于所有产品）</span>
                </label>
                <ProductTagSelect selectedIds={productTagIds} onChange={setProductTagIds} />
              </div>

              {isAdmin && (
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isPublic}
                      onChange={(e) => setIsPublic(e.target.checked)}
                      className="rounded border-gray-600 text-blue-400 focus:ring-primary-500"
                    />
                    <span className="ml-2 text-sm text-gray-300">
                      公开 Skill（所有用户可见）
                    </span>
                  </label>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-300">
                    Skill 内容预览
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPreview(!showPreview)}
                    className="text-sm text-gray-400 hover:text-gray-200 flex items-center"
                  >
                    {showPreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showPreview ? '收起' : '展开'}
                  </button>
                </div>
                {showPreview && (
                  <div className="bg-[#0F172A] border border-gray-700/50 rounded-lg p-4 max-h-96 overflow-auto">
                    <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                      {skillContent.substring(0, 2000)}
                      {skillContent.length > 2000 && '\n\n... (内容已截断，完整内容已保存)'}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}

          {parsedSkill && FORMAT_GUIDE && (
            <div className="border border-gray-700/50 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => {}}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-dark-bg text-sm text-gray-400"
              >
                <span>格式参考</span>
                <ChevronDown size={14} />
              </button>
              <div className="px-4 py-3 bg-dark-bg border-t border-gray-700/50 text-xs text-gray-500">
                <p>推荐的 Skill 文件格式包含 YAML frontmatter：</p>
                <pre className="mt-2 bg-dark-surface p-2 rounded text-gray-400">
{`---
name: sql-injection
description: SQL 注入漏洞检测专家
---

# SQL 注入安全检测 Skill

## 0. 角色定位
...`}
                </pre>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-600 rounded-lg hover:bg-dark-bg transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading || !parsedSkill}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                创建中...
              </>
            ) : (
              <>
                <Save size={16} className="mr-2" />
                创建 Skill
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}