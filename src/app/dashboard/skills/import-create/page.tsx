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
  Trash2,
  Plus,
} from 'lucide-react';
import JSZip from 'jszip';
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

interface SkillItem {
  id: string;
  file: File;
  parsed: ParsedSkill | null;
  error?: string;
  skillName: string;
  skillDisplayName: string;
  skillDescription: string;
  status: 'pending' | 'uploading' | 'success' | 'failed';
  governanceWarning?: {
    isPotentialDuplicate: boolean;
    duplicates: Array<{
      skillId: string;
      skillName: string;
      displayName: string;
      confidence: number;
      overlapType?: string;
      reason?: string;
      recommendation?: string;
    }>;
  };
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
  const [batchMode, setBatchMode] = useState(false);

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

  const [skillItems, setSkillItems] = useState<SkillItem[]>([]);
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
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setError('');

    const newItems: SkillItem[] = [];

    for (const file of Array.from(files)) {
      const isZip = file.name.toLowerCase().endsWith('.zip');
      const isMd = file.name.toLowerCase().endsWith('.md');

      if (!isZip && !isMd) {
        newItems.push({
          id: `item-${Date.now()}-${Math.random()}`,
          file,
          parsed: null,
          error: '文件格式不支持，请上传 ZIP 或 .md 文件',
          skillName: '',
          skillDisplayName: '',
          skillDescription: '',
          status: 'pending',
        });
        continue;
      }

      try {
        let content: string;

        if (isZip) {
          const zip = await JSZip.loadAsync(file);
          const skillFile = zip.file('SKILL.md');

          if (!skillFile) {
            newItems.push({
              id: `item-${Date.now()}-${Math.random()}`,
              file,
              parsed: null,
              error: 'ZIP 中未找到 SKILL.md 文件',
              skillName: '',
              skillDisplayName: '',
              skillDescription: '',
              status: 'pending',
            });
            continue;
          }

          content = await skillFile.async('string');
        } else {
          content = await file.text();
        }

        const parsed = parseSkillMarkdown(content);

        if (!parsed) {
          newItems.push({
            id: `item-${Date.now()}-${Math.random()}`,
            file,
            parsed: null,
            error: '无法解析 Skill 文件',
            skillName: '',
            skillDisplayName: '',
            skillDescription: '',
            status: 'pending',
          });
          continue;
        }

        newItems.push({
          id: `item-${Date.now()}-${Math.random()}`,
          file,
          parsed,
          skillName: parsed.name,
          skillDisplayName: parsed.displayName,
          skillDescription: parsed.description,
          status: 'pending',
        });
      } catch (e) {
        newItems.push({
          id: `item-${Date.now()}-${Math.random()}`,
          file,
          parsed: null,
          error: '读取文件失败',
          skillName: '',
          skillDisplayName: '',
          skillDescription: '',
          status: 'pending',
        });
      }
    }

    setSkillItems(prev => [...prev, ...newItems]);
    
    if (files.length > 1) {
      setBatchMode(true);
    }

    e.target.value = '';
  };

  const removeItem = (id: string) => {
    setSkillItems(prev => prev.filter(item => item.id !== id));
  };

  const updateItem = (id: string, updates: Partial<SkillItem>) => {
    setSkillItems(prev => prev.map(item => 
      item.id === id ? { ...item, ...updates } : item
    ));
  };

  const handleSingleSubmit = async (item: SkillItem) => {
    if (!item.parsed) return;

    setError('');

    if (!item.skillName.trim()) {
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

    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const formData = new FormData();
      formData.append('file', item.file);
      formData.append('categoryId', categoryId);
      formData.append('productTagIds', JSON.stringify(productTagIds));
      formData.append('isPublic', String(isPublic));
      formData.append('skillName', item.skillName.trim());
      formData.append('skillDisplayName', item.skillDisplayName.trim());
      formData.append('skillDescription', item.skillDescription.trim());
      if (vulnerabilityTreeId) {
        formData.append('vulnerabilityTreeId', vulnerabilityTreeId);
      }

      const response = await fetch('/api/skills/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || data.details?.error || '创建失败');
      }

      const result = await response.json();
      
      // 处理治理警告
      if (result.governanceWarning && result.governanceWarning.isPotentialDuplicate) {
        updateItem(item.id, { 
          status: 'success', 
          governanceWarning: result.governanceWarning 
        });
        const dupNames = result.governanceWarning.duplicates.map((d: { displayName: string }) => d.displayName).join(', ');
        setError(`发现相似 Skill：${dupNames}`);
      } else {
        router.push('/dashboard/skills');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchSubmit = async () => {
    setError('');

    const validItems = skillItems.filter(item => item.parsed && item.status === 'pending');
    
    if (validItems.length === 0) {
      setError('没有有效的 Skill 文件');
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

    setLoading(true);
    const token = localStorage.getItem('token');

    for (const item of validItems) {
      updateItem(item.id, { status: 'uploading' });
    }

    const results: { success: number; failed: number; errors: string[] } = {
      success: 0,
      failed: 0,
      errors: [],
    };

    for (const item of validItems) {
      try {
        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('categoryId', categoryId);
        formData.append('productTagIds', JSON.stringify(productTagIds));
        formData.append('isPublic', String(isPublic));
        formData.append('skillName', item.skillName.trim());
        formData.append('skillDisplayName', item.skillDisplayName.trim());
        formData.append('skillDescription', item.skillDescription.trim());
        if (vulnerabilityTreeId) {
          formData.append('vulnerabilityTreeId', vulnerabilityTreeId);
        }

        const response = await fetch('/api/skills/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || data.details?.error || '创建失败');
        }

        const result = await response.json();
        
        // 处理治理警告
        if (result.governanceWarning && result.governanceWarning.isPotentialDuplicate) {
          updateItem(item.id, { 
            status: 'success', 
            governanceWarning: result.governanceWarning 
          });
          const dupNames = result.governanceWarning.duplicates.map((d: { displayName: string }) => d.displayName).join(', ');
          results.errors.push(`${item.skillDisplayName}: 发现相似 Skill - ${dupNames}`);
        } else {
          updateItem(item.id, { status: 'success' });
        }
        
        results.success++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : '创建失败';
        updateItem(item.id, { status: 'failed', error: errorMsg });
        results.failed++;
        results.errors.push(`${item.skillDisplayName}: ${errorMsg}`);
      }
    }

    setLoading(false);

    if (results.success === validItems.length) {
      setTimeout(() => router.push('/dashboard/skills'), 1500);
    } else {
      setError(`批量导入完成：成功 ${results.success}，失败 ${results.failed}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (batchMode) {
      await handleBatchSubmit();
    } else if (skillItems.length === 1) {
      await handleSingleSubmit(skillItems[0]);
    }
  };

  const validItemsCount = skillItems.filter(item => item.parsed).length;

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
            <p className="text-sm text-gray-400">
              {batchMode ? '批量导入多个 Skill 文件' : '上传 ZIP 或 Markdown 文件创建 Skill'}
            </p>
          </div>
        </div>
        {skillItems.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setSkillItems([]);
              setBatchMode(false);
              setError('');
            }}
            className="text-sm text-gray-400 hover:text-gray-200"
          >
            清空重新选择
          </button>
        )}
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
                accept=".zip,.md"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-green-600 to-teal-500 text-white rounded-lg hover:from-green-500 hover:to-teal-400 text-sm transition-all"
              >
                <Plus size={16} className="mr-1.5" />
                选择文件
              </button>
              <span className="text-xs text-gray-500">
                支持多选，可同时上传多个 ZIP 或 .md 文件
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              ZIP 压缩包需直接包含 SKILL.md 文件（不要有额外的文件夹包裹）
            </p>
          </div>

          {skillItems.length > 0 && (
            <div className="border-t border-gray-700/50 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-300">
                  文件列表 ({validItemsCount}/{skillItems.length} 个有效)
                </h3>
                {skillItems.length > 1 && (
                  <span className="text-xs text-blue-400">批量导入模式</span>
                )}
              </div>
              
              <div className="space-y-3 max-h-[400px] overflow-auto">
                {skillItems.map(item => (
                  <div
                    key={item.id}
                    className={`p-3 rounded-lg border ${
                      item.status === 'success' 
                        ? 'border-green-500/50 bg-green-900/20' 
                        : item.status === 'failed'
                        ? 'border-red-500/50 bg-red-900/20'
                        : item.error
                        ? 'border-yellow-500/50 bg-yellow-900/20'
                        : 'border-gray-600 bg-dark-bg'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {item.status === 'uploading' && (
                            <Loader2 size={14} className="animate-spin text-blue-400" />
                          )}
                          {item.status === 'success' && (
                            <CheckCircle size={14} className="text-green-400" />
                          )}
                          {item.status === 'failed' && (
                            <AlertTriangle size={14} className="text-red-400" />
                          )}
                          <span className="text-sm text-gray-300 truncate">{item.file.name}</span>
                        </div>
                        
                        {item.error && (
                          <p className="text-xs text-yellow-400">{item.error}</p>
                        )}
                        
                        {item.governanceWarning && item.governanceWarning.isPotentialDuplicate && (
                          <div className="mt-2 p-2 bg-yellow-900/30 rounded border border-yellow-600/30">
                            <p className="text-xs text-yellow-300 font-medium mb-1">
                              ⚠️ 发现相似 Skill：
                            </p>
                            {item.governanceWarning.duplicates.map((dup, idx) => (
                              <div key={idx} className="text-xs text-yellow-400 ml-2">
                                • {dup.displayName} ({dup.confidence >= 0.85 ? '高置信度' : '低置信度'})
                                {dup.recommendation && (
                                  <span className="text-yellow-300 ml-1">
                                    - 建议: {dup.recommendation === 'merge' ? '合并' : dup.recommendation === 'keep_separate' ? '保留独立' : '人工审核'}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {item.parsed && (
                          <div className="grid grid-cols-3 gap-2 mt-2">
                            <input
                              type="text"
                              value={item.skillName}
                              onChange={(e) => updateItem(item.id, { skillName: e.target.value })}
                              placeholder="名称"
                              className="px-2 py-1 text-xs border border-gray-600 rounded focus:ring-1 focus:ring-primary-500"
                              disabled={item.status !== 'pending'}
                            />
                            <input
                              type="text"
                              value={item.skillDisplayName}
                              onChange={(e) => updateItem(item.id, { skillDisplayName: e.target.value })}
                              placeholder="显示名称"
                              className="px-2 py-1 text-xs border border-gray-600 rounded focus:ring-1 focus:ring-primary-500"
                              disabled={item.status !== 'pending'}
                            />
                            <input
                              type="text"
                              value={item.skillDescription}
                              onChange={(e) => updateItem(item.id, { skillDescription: e.target.value })}
                              placeholder="描述"
                              className="px-2 py-1 text-xs border border-gray-600 rounded focus:ring-1 focus:ring-primary-500"
                              disabled={item.status !== 'pending'}
                            />
                          </div>
                        )}
                      </div>
                      
                      {item.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="p-1 hover:bg-red-900/30 rounded text-gray-400 hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {skillItems.length > 0 && validItemsCount > 0 && (
            <>
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
            </>
          )}

          {skillItems.length === 1 && skillItems[0].parsed && (
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
                    {skillItems[0].parsed.content.substring(0, 2000)}
                    {skillItems[0].parsed.content.length > 2000 && '\n\n... (内容已截断)'}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {validItemsCount > 0 && (
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
              disabled={loading || validItemsCount === 0}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  {batchMode ? '批量导入中...' : '创建中...'}
                </>
              ) : (
                <>
                  <Save size={16} className="mr-2" />
                  {batchMode ? `批量创建 (${validItemsCount} 个)` : '创建 Skill'}
                </>
              )}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}