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
  Upload,
} from 'lucide-react';
import JSZip from 'jszip';
import { PERMISSIONS } from '@/types/permissions';
import { ProductTagSelect } from '@/components/skills/ProductTagSelect';
import { VulnerabilityTreeSelector } from '@/components/skills/VulnerabilityTreeSelector';
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
  categoryId: string;
  vulnerabilityTreeId: string | null;
  productTagIds: string[];
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

  const [categories, setCategories] = useState<Array<{ id: string; name: string; displayName: string; description?: string; icon?: string; hasSubDimension: boolean }>>([]);
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
        const catRes = await fetch('/api/skills/categories', { headers: { Authorization: `Bearer ${t}` } });

        if (catRes.ok) {
          const data = await catRes.json();
          setCategories(data.categories || []);
        }
      } catch (e) {
        console.error('获取数据失败:', e);
      } finally {
        setLoadingData(false);
      }
    };
    fetchData();
  }, []);

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
          categoryId: VULNERABILITY_CATEGORY_ID,
          vulnerabilityTreeId: null,
          productTagIds: [],
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
              categoryId: VULNERABILITY_CATEGORY_ID,
              vulnerabilityTreeId: null,
              productTagIds: [],
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
            categoryId: VULNERABILITY_CATEGORY_ID,
            vulnerabilityTreeId: null,
            productTagIds: [],
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
          categoryId: VULNERABILITY_CATEGORY_ID,
          vulnerabilityTreeId: null,
          productTagIds: [],
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
          categoryId: VULNERABILITY_CATEGORY_ID,
          vulnerabilityTreeId: null,
          productTagIds: [],
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

    if (!item.categoryId) {
      setError('请选择分类');
      return;
    }

    const cat = categories.find(c => c.id === item.categoryId);
    if (cat?.hasSubDimension && !item.vulnerabilityTreeId) {
      setError('请选择漏洞模式');
      return;
    }

    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const formData = new FormData();
      formData.append('file', item.file);
      formData.append('categoryId', item.categoryId);
      formData.append('productTagIds', JSON.stringify(item.productTagIds));
      formData.append('isPublic', String(isPublic));
      formData.append('skillName', item.skillName.trim());
      formData.append('skillDisplayName', item.skillDisplayName.trim());
      formData.append('skillDescription', item.skillDescription.trim());
      if (item.vulnerabilityTreeId) {
        formData.append('vulnerabilityTreeId', item.vulnerabilityTreeId);
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

    // 验证每个 item 的必填项
    const invalidItems = validItems.filter(item => {
      if (!item.categoryId) return true;
      const cat = categories.find(c => c.id === item.categoryId);
      if (cat?.hasSubDimension && !item.vulnerabilityTreeId) return true;
      return false;
    });

    if (invalidItems.length > 0) {
      setError(`${invalidItems.length} 个 Skill 缺少必填信息（分类或漏洞模式）`);
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
        formData.append('categoryId', item.categoryId);
        formData.append('productTagIds', JSON.stringify(item.productTagIds));
        formData.append('isPublic', String(isPublic));
        formData.append('skillName', item.skillName.trim());
        formData.append('skillDisplayName', item.skillDisplayName.trim());
        formData.append('skillDescription', item.skillDescription.trim());
        if (item.vulnerabilityTreeId) {
          formData.append('vulnerabilityTreeId', item.vulnerabilityTreeId);
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
    <div className="max-w-2xl mx-auto py-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {skillItems.length > 0 && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                setSkillItems([]);
                setBatchMode(false);
                setError('');
              }}
              className="text-sm text-dark-text-muted hover:text-dark-text transition-colors"
            >
              清空重选
            </button>
          </div>
        )}
        {error && (
              <div className="bg-red-900/20 border border-red-500/30 text-red-400 px-3 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="bg-dark-surface border border-dark-border rounded-xl p-4">
              {/* 上传区域 */}
              <div>
                <label className="block text-sm font-medium text-dark-text-secondary mb-1.5">
                  上传 Skill 文件 <span className="text-red-400">*</span>
                </label>
                <div className="flex items-center gap-3">
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
                    className="inline-flex items-center px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-all"
                  >
                    <Plus size={14} className="mr-1" />
                    选择文件
                  </button>
                  <span className="text-xs text-dark-text-muted">
                    支持多选 ZIP 或 .md 文件
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-dark-text-muted">
                  ZIP 需直接包含 SKILL.md 文件
                </p>
              </div>

              {skillItems.length > 0 && (
                <div className="mt-4 pt-4 border-t border-dark-border">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-dark-text-secondary">
                      文件列表 ({validItemsCount}/{skillItems.length} 个有效)
                    </h3>
                    {skillItems.length > 1 && (
                      <span className="text-xs text-blue-400">批量模式</span>
                    )}
                  </div>
                  
                  <div className="space-y-2 overflow-y-auto overflow-x-hidden max-h-[280px]">
                    {skillItems.map(item => (
                      <div
                        key={item.id}
                        className={`p-2.5 rounded-lg border ${
                          item.status === 'success' 
                            ? 'border-green-500/50 bg-green-900/20' 
                            : item.status === 'failed'
                            ? 'border-red-500/50 bg-red-900/20'
                            : item.error
                            ? 'border-yellow-500/50 bg-yellow-900/20'
                            : 'border-dark-border bg-dark-bg'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="flex items-center gap-2 mb-1">
                              {item.status === 'uploading' && (
                                <Loader2 size={12} className="animate-spin text-blue-400" />
                              )}
                              {item.status === 'success' && (
                                <CheckCircle size={12} className="text-green-400" />
                              )}
                              {item.status === 'failed' && (
                                <AlertTriangle size={12} className="text-red-400" />
                              )}
                              <span className="text-xs text-dark-text-secondary truncate">{item.file.name}</span>
                            </div>
                            
                            {item.error && (
                              <p className="text-xs text-yellow-400">{item.error}</p>
                            )}
                            
                            {item.governanceWarning && item.governanceWarning.isPotentialDuplicate && (
                              <div className="mt-1.5 p-1.5 bg-yellow-900/30 rounded border border-yellow-600/30">
                                <p className="text-xs text-yellow-300 font-medium mb-0.5">
                                  ⚠️ 发现相似 Skill：
                                </p>
                                {item.governanceWarning.duplicates.map((dup, idx) => (
                                  <div key={idx} className="text-xs text-yellow-400 ml-1.5">
                                    • {dup.displayName} ({dup.confidence >= 0.85 ? '高置信度' : '低'})
                                  </div>
                                ))}
                              </div>
                            )}
                            
                            {item.parsed && (
                              <div className="space-y-1.5 mt-1.5">
                                <div className="flex flex-wrap gap-2">
                                  <input
                                    type="text"
                                    value={item.skillName}
                                    onChange={(e) => updateItem(item.id, { skillName: e.target.value })}
                                    placeholder="名称"
                                    className="w-[120px] px-2 py-1 text-xs bg-dark-surface border border-dark-border rounded focus:ring-1 focus:ring-indigo-500 text-dark-text"
                                    disabled={item.status !== 'pending'}
                                  />
                                  <input
                                    type="text"
                                    value={item.skillDisplayName}
                                    onChange={(e) => updateItem(item.id, { skillDisplayName: e.target.value })}
                                    placeholder="显示名称"
                                    className="w-[120px] px-2 py-1 text-xs bg-dark-surface border border-dark-border rounded focus:ring-1 focus:ring-indigo-500 text-dark-text"
                                    disabled={item.status !== 'pending'}
                                  />
                                  <input
                                    type="text"
                                    value={item.skillDescription}
                                    onChange={(e) => updateItem(item.id, { skillDescription: e.target.value })}
                                    placeholder="描述"
                                    className="flex-1 min-w-[150px] px-2 py-1 text-xs bg-dark-surface border border-dark-border rounded focus:ring-1 focus:ring-indigo-500 text-dark-text"
                                    disabled={item.status !== 'pending'}
                                  />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <div className="min-w-[120px]">
                                    <label className="block text-xs text-dark-text-muted mb-0.5">分类</label>
                                    <select
                                      value={item.categoryId}
                                      onChange={(e) => updateItem(item.id, { categoryId: e.target.value, vulnerabilityTreeId: null })}
                                      className="w-full px-2 py-1 text-xs bg-dark-surface border border-dark-border rounded focus:ring-1 focus:ring-indigo-500 text-dark-text"
                                      disabled={item.status !== 'pending' || loadingData}
                                    >
                                      <option value="">请选择</option>
                                      {categories.map(c => (
                                        <option key={c.id} value={c.id}>{c.displayName}</option>
                                      ))}
                                    </select>
                                  </div>
                                  {(() => {
                                    const selectedCat = categories.find(c => c.id === item.categoryId);
                                    return selectedCat?.hasSubDimension ? (
                                      <div className="min-w-[200px] max-w-[300px]">
                                        <label className="block text-xs text-dark-text-muted mb-0.5">漏洞模式</label>
                                        <VulnerabilityTreeSelector
                                          value={item.vulnerabilityTreeId}
                                          onChange={(patternId) => updateItem(item.id, { vulnerabilityTreeId: patternId })}
                                          placeholder="选择"
                                          loading={loadingData}
                                        />
                                      </div>
                                    ) : null;
                                  })()}
                                </div>
                                <div>
                                  <label className="block text-xs text-dark-text-muted mb-0.5">适用产品</label>
                                  <ProductTagSelect 
                                    selectedIds={item.productTagIds} 
                                    onChange={(ids) => updateItem(item.id, { productTagIds: ids })} 
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                          
                          {item.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              className="p-1 hover:bg-red-900/30 rounded text-dark-text-muted hover:text-red-400 shrink-0"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {skillItems.length > 0 && validItemsCount > 0 && isAdmin && (
                <div className="mt-3 pt-3 border-t border-dark-border">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isPublic}
                      onChange={(e) => setIsPublic(e.target.checked)}
                      className="w-4 h-4 rounded border-dark-border bg-dark-bg"
                    />
                    <span className="ml-2 text-sm text-dark-text-secondary">
                      公开 Skill（所有用户可见）
                    </span>
                  </label>
                </div>
              )}

              {skillItems.length === 1 && skillItems[0].parsed && (
                <div className="mt-3 pt-3 border-t border-dark-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-dark-text-secondary">
                      内容预览
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPreview(!showPreview)}
                      className="text-xs text-dark-text-muted hover:text-dark-text-secondary flex items-center"
                    >
                      {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {showPreview ? '收起' : '展开'}
                    </button>
                  </div>
                  {showPreview && (
                    <div className="bg-dark-bg border border-dark-border rounded-lg p-2 max-h-[150px] overflow-auto">
                      <pre className="text-xs text-dark-text-secondary whitespace-pre-wrap font-mono">
                        {skillItems[0].parsed.content.substring(0, 1500)}
                        {skillItems[0].parsed.content.length > 1500 && '\n... (截断)'}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            {validItemsCount > 0 && (
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="px-4 py-2 text-sm border border-dark-border text-dark-text-secondary rounded-lg hover:bg-dark-bg transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading || validItemsCount === 0}
                  className="inline-flex items-center px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin mr-1.5" />
                      {batchMode ? '导入中...' : '创建中...'}
                    </>
                  ) : (
                    <>
                      <Save size={14} className="mr-1.5" />
                      {batchMode ? `批量创建 (${validItemsCount})` : '创建 Skill'}
                    </>
                  )}
                </button>
              </div>
            )}
          </form>
    </div>
  );
}