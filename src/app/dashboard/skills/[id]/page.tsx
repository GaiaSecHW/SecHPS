'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MarkdownRenderer } from '@/components/markdown';
import JSZip from 'jszip';
import {
  ArrowLeft,
  Play,
  Edit,
  Trash2,
  Save,
  X,
  Award,
  Copy,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  FileText,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Eye,
  History,
  Plus,
  Bug,
  Search,
  Shield,
  Code,
  LayoutDashboard,
  TrendingUp,
  FileUp,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/permissions';
import { exportAsSkillFile, copySkillMdToClipboard, copyTextToClipboard } from '@/lib/skill-export';
import { buildFullSkill, getFormatGuideData, cleanSkillContentForOptimization, type SkillIntent } from '@/lib/skill-builder';
import { SkillVersionHistory } from '@/components/skills/SkillVersionHistory';
import { SkillVersionDiffModal } from '@/components/skills/SkillVersionDiffModal';
import { SkillRollbackModal } from '@/components/skills/SkillRollbackModal';
import { SkillNewVersionModal } from '@/components/skills/SkillNewVersionModal';
import { VulnerabilityTreeSelector } from '@/components/skills/VulnerabilityTreeSelector';
import { ProductTagSelect } from '@/components/skills/ProductTagSelect';
import toast from 'react-hot-toast';

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

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  categoryId: string;
  vulnerabilityTreeId: number | null;
  cwe: string | null;
  severity: string | null;
  content: string;
  isActive: boolean;
  isBuiltin: boolean;
  version: number;
  parentId: string | null;
  isLatest: boolean;
  successRate: number | null;
  avgDuration: number | null;
  execCount: number;
  vulnerabilityCount: number;
  successExecCount: number;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  isPublic: boolean;
  categoryName: string | null;
  categoryIcon: string | null;
  hasSubDimension: boolean;
  patternName: string | null;
  languageName: string | null;
  productTags: Array<{ id: string; name: string; displayName: string }>;
}

export default function SkillDetailPage() {
  const params = useParams();
  const router = useRouter();
  const skillId = params.id as string;

  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);  // 当前用户ID
  const [isEditing, setIsEditing] = useState(false);
  const [editMode, setEditMode] = useState<'content' | 'file'>('content');
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editCategoryId, setEditCategoryId] = useState<string>('');
  const [editVulnerabilityTreeId, setEditVulnerabilityTreeId] = useState<number | null>(null);
  const [editProductTagIds, setEditProductTagIds] = useState<string[]>([]);
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editParsed, setEditParsed] = useState<ParsedSkill | null>(null);
  const [editFileError, setEditFileError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [skillOutputTemplate, setSkillOutputTemplate] = useState<string>('');

  // AI 优化相关状态
  const [aiOptimizing, setAiOptimizing] = useState(false);
  const [aiOptimizeError, setAiOptimizeError] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [aiOptimizeSuccess, setAiOptimizeSuccess] = useState(false);
  const [aiDiffContent, setAiDiffContent] = useState('');   // AI 优化后的内容（待对比）
  const [showDiffModal, setShowDiffModal] = useState(false); // 对比弹窗
  const [aiCountdown, setAiCountdown] = useState(0); // 剩余秒数，0 表示未开始
  const aiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showFormatHint, setShowFormatHint] = useState(true); // 格式建议默认展开
  
  // 漏洞列表相关状态
  const [showVulnerabilities, setShowVulnerabilities] = useState(false);
  const [vulnerabilities, setVulnerabilities] = useState<any[]>([]);
  const [vulnLoading, setVulnLoading] = useState(false);
  const [vulnPage, setVulnPage] = useState(1);
  const [vulnTotal, setVulnTotal] = useState(0);
  const [vulnTotalPages, setVulnTotalPages] = useState(0);
  const [vulnFilter, setVulnFilter] = useState<'all' | 'false-positive' | 'confirmed' | 'new'>('all');
  const [vulnStats, setVulnStats] = useState<{ total: number; falsePositive: number; confirmed: number; new: number }>({ total: 0, falsePositive: 0, confirmed: 0, new: 0 });
  
  // ===== 版本管理相关状态 =====
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null); // 当前查看的版本 ID
  const [viewingVersionNumber, setViewingVersionNumber] = useState<number | null>(null); // 当前查看的版本号
  const [viewingVersionContent, setViewingVersionContent] = useState<string>(''); // 查看版本的内容
  const [showVersionDiffModal, setShowVersionDiffModal] = useState(false); // 版本对比弹窗
  const [diffTargetVersionId, setDiffTargetVersionId] = useState<string>(''); // 对比目标版本 ID
  const [diffTargetVersionNumber, setDiffTargetVersionNumber] = useState<number>(0); // 对比目标版本号
  const [showRollbackModal, setShowRollbackModal] = useState(false); // 回滚确认弹窗
  const [rollbackTargetVersionId, setRollbackTargetVersionId] = useState<string>(''); // 回滚目标版本 ID
  const [rollbackTargetVersionNumber, setRollbackTargetVersionNumber] = useState<number>(0); // 回滚目标版本号
  
  // 新版本弹窗状态
  const [showNewVersionModal, setShowNewVersionModal] = useState(false); // 新版本弹窗
  
  // 获取漏洞列表
  const fetchVulnerabilities = async (page: number = 1, status: 'all' | 'false-positive' | 'confirmed' | 'new' = 'all') => {
    if (!skillId) return;
    setVulnLoading(true);
    setVulnFilter(status);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}/vulnerabilities?page=${page}&limit=10&status=${status}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setVulnerabilities(data.vulnerabilities || []);
        setVulnTotal(data.pagination?.total || 0);
        setVulnTotalPages(data.pagination?.totalPages || 0);
        setVulnPage(page);
        if (data.stats) {
          setVulnStats(data.stats);
        }
      }
    } catch (error) {
      console.error('获取漏洞列表失败:', error);
    } finally {
      setVulnLoading(false);
    }
  };

  // ===== 版本管理处理函数 =====
  
  // 查看特定版本内容
  const handleSelectVersion = async (versionId: string, versionNumber: number) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${versionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('获取版本内容失败');
      const data = await response.json();
      setViewingVersionId(versionId);
      setViewingVersionNumber(versionNumber);
      setViewingVersionContent(data.skill?.content || '');
    } catch (error) {
      toast.error('获取版本内容失败');
    }
  };

  // 关闭版本查看，返回当前版本
  const handleCloseVersionView = () => {
    setViewingVersionId(null);
    setViewingVersionNumber(null);
    setViewingVersionContent('');
  };

  // 打开版本对比弹窗
  const handleCompareVersion = (versionId: string, versionNumber: number) => {
    setDiffTargetVersionId(versionId);
    setDiffTargetVersionNumber(versionNumber);
    setShowVersionDiffModal(true);
  };

  // 打开回滚确认弹窗
  const handleRollbackVersion = (versionId: string, versionNumber: number) => {
    setRollbackTargetVersionId(versionId);
    setRollbackTargetVersionNumber(versionNumber);
    setShowRollbackModal(true);
  };

  // 回滚成功后刷新
  const handleRollbackSuccess = () => {
    toast.success(`成功回滚到版本 v${rollbackTargetVersionNumber}`);
    fetchSkill(); // 重新获取当前 skill 数据
    handleCloseVersionView(); // 关闭版本查看
  };

  // 创建新版本成功后刷新
  const handleNewVersionSuccess = () => {
    toast.success('新版本创建成功');
    setIsEditing(false);
    fetchSkill();
  };

  // 清理定时器
  const clearAiTimers = () => {
    if (aiTimeoutRef.current) { clearTimeout(aiTimeoutRef.current); aiTimeoutRef.current = null; }
    if (aiCountdownRef.current) { clearInterval(aiCountdownRef.current); aiCountdownRef.current = null; }
  };

  // 解锁（手动或超时）
  const unlockAi = (reason?: 'timeout') => {
    clearAiTimers();
    setAiOptimizing(false);
    setAiCountdown(0);
    if (reason === 'timeout') {
      setAiOptimizeError('AI 优化超时（5 分钟），界面已自动解锁，请稍后重试。');
    }
  };

  // 分类选择相关
  const [categories, setCategories] = useState<Array<{ id: string; name: string; displayName: string; icon: string | null; hasSubDimension: boolean }>>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE));
        setCurrentUserId(payload.userId);  // 保存当前用户ID
      } catch (error) {
        console.error('解析 token 失败:', error);
      }
    }
  }, []);

  useEffect(() => {
    // 加载 skillOutputTemplate
    const fetchTemplate = async () => {
      try {
        const token = localStorage.getItem('token');
        const templateRes = await fetch('/api/config/template', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (templateRes.ok) {
          const templateData = await templateRes.json();
          setSkillOutputTemplate(templateData.skillOutputTemplate || '');
        }
      } catch (e) {
        console.warn('获取 skillOutputTemplate 失败:', e);
      }
    };
    fetchTemplate();
  }, []);

  useEffect(() => {
    fetchSkill();
  }, [skillId]);

  const fetchSkill = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取 Skill 详情失败');
      }

      const data = await response.json();
      setSkill(data.skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!skill) return;

    if (!confirm(`确定要删除 Skill "${skill.displayName}" 吗？此操作不可恢复。`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }

      router.push('/dashboard/skills');
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggleActive = async () => {
    if (!skill) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !skill.isActive }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }

      fetchSkill();
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新失败');
    }
  };

  const startEditing = async () => {
    if (!skill) return;
    setEditName(skill.displayName);
    setEditCategoryId(skill.categoryId || VULNERABILITY_CATEGORY_ID);
    setEditVulnerabilityTreeId(skill.vulnerabilityTreeId ?? null);
    setEditContent(skill.content || '');
    setEditIsActive(skill.isActive);
    setEditProductTagIds(skill.productTags?.map(t => t.id) || []);
    setEditMode('content');
    setEditFile(null);
    setEditParsed(null);
    setEditFileError('');
    setIsEditing(true);

    const token = localStorage.getItem('token');
    setLoadingCategories(true);
    try {
      const res = await fetch('/api/skills/categories', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch (e) {
      console.error('获取分类失败:', e);
    } finally {
      setLoadingCategories(false);
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditFile(null);
    setEditParsed(null);
    setEditFileError('');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const isZip = file.name.toLowerCase().endsWith('.zip');
    const isMd = file.name.toLowerCase().endsWith('.md');

    if (!isZip && !isMd) {
      setEditFileError('文件格式不支持，请上传 ZIP 或 .md 文件');
      setEditFile(null);
      setEditParsed(null);
      return;
    }

    try {
      let content: string;

      if (isZip) {
        const zip = await JSZip.loadAsync(file);
        const skillFile = zip.file('SKILL.md');
        if (!skillFile) {
          setEditFileError('ZIP 中未找到 SKILL.md 文件');
          setEditFile(null);
          setEditParsed(null);
          return;
        }
        content = await skillFile.async('string');
      } else {
        content = await file.text();
      }

      const parsed = parseSkillMarkdown(content);
      if (!parsed) {
        setEditFileError('无法解析 Skill 文件');
        setEditFile(null);
        setEditParsed(null);
        return;
      }

      setEditFile(file);
      setEditParsed(parsed);
      setEditContent(parsed.content);
      setEditName(parsed.displayName);
      setEditFileError('');
      setEditMode('file');
    } catch (e) {
      setEditFileError('读取文件失败');
      setEditFile(null);
      setEditParsed(null);
    }

    e.target.value = '';
  };

  const handleSaveEdit = async () => {
    if (!skill) return;

    if (!editName.trim()) {
      toast.error('请输入 Skill 名称');
      return;
    }

    if (!editCategoryId) {
      toast.error('请选择分类');
      return;
    }

    const selectedCat = categories.find(c => c.id === editCategoryId);
    if (selectedCat?.hasSubDimension && !editVulnerabilityTreeId) {
      toast.error('请选择漏洞类型');
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');

      if (editMode === 'file' && editFile) {
        const formData = new FormData();
        formData.append('file', editFile);
        formData.append('categoryId', editCategoryId);
        formData.append('vulnerabilityTreeId', editVulnerabilityTreeId?.toString() ?? '');
        formData.append('productTagIds', JSON.stringify(editProductTagIds));
        formData.append('skillName', skill.name);
        formData.append('skillDisplayName', editName.trim());
        formData.append('skillDescription', editParsed?.description || editName.trim());
        formData.append('isPublic', String(skill.isPublic));
        formData.append('replaceMode', 'full');

        const response = await fetch(`/api/skills/${skillId}/replace`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || data.details?.error || '替换失败');
        }

        toast.success('Skill 已完全替换');
      } else {
        const response = await fetch(`/api/skills/${skillId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            displayName: editName.trim(),
            description: editName.trim(),
            categoryId: editCategoryId,
            vulnerabilityTreeId: editVulnerabilityTreeId ?? null,
            content: editContent,
            isActive: editIsActive,
            productTagIds: editProductTagIds,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || '保存失败');
        }

        toast.success('Skill 已更新');
      }

      setIsEditing(false);
      fetchSkill();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await copyTextToClipboard(text);
      toast.success('已复制到剪贴板');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      toast.error(errorMsg);
      console.error('复制失败:', error);
    }
  };

  const handleExport = async () => {
    if (!skill) return;
    
    setExporting(true);
    try {
      const outputTemplate = await getSkillOutputTemplate();

      // 使用公共模块构建完整 Skill（自动添加输出格式）
      const intent: SkillIntent = {
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
      };

      const fullContent = buildFullSkill(intent, skill.content || '', outputTemplate, {
        addFrontmatter: true,
        addOutputFormat: !!outputTemplate,
        addTitle: true,
      });

      await exportAsSkillFile({
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        cwe: skill.cwe,
        severity: skill.severity || 'medium',
        content: fullContent,
      });
    } catch (error) {
      console.error('导出失败:', error);
      alert('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  // 获取 skillOutputTemplate 的辅助函数（客户端通过 API 获取）
  const getSkillOutputTemplate = async (): Promise<string> => {
    try {
      const token = localStorage.getItem('token');
      const templateRes = await fetch('/api/config/template', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (templateRes.ok) {
        const templateData = await templateRes.json();
        return templateData.skillOutputTemplate || '';
      }
    } catch (e) {
      console.warn('获取 skillOutputTemplate 失败:', e);
    }
    return '';
  };

  const handleCopyMd = async () => {
    if (!skill) return;

    try {
      const outputTemplate = await getSkillOutputTemplate();

      // 使用公共模块构建完整 Skill（自动添加输出格式）
      const intent: SkillIntent = {
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
      };

      const fullContent = buildFullSkill(intent, skill.content || '', outputTemplate, {
        addFrontmatter: true,
        addOutputFormat: !!outputTemplate,
        addTitle: true,
      });

      await copySkillMdToClipboard({
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        cwe: skill.cwe,
        severity: skill.severity || 'medium',
        content: fullContent,
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('已复制到剪贴板');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      toast.error(errorMsg);
      console.error('复制失败:', error);
    }
  };

  // AI 优化当前编辑内容
  const handleAiOptimize = async () => {
    if (!skill) return;
    setAiOptimizing(true);
    setAiOptimizeError('');
    setAiSuggestions([]);
    setAiOptimizeSuccess(false);

    // 启动 5 分钟超时自动解锁
    const TIMEOUT_MS = 5 * 60 * 1000;
    setAiCountdown(TIMEOUT_MS / 1000);
    clearAiTimers();

    // 每秒倒计时
    aiCountdownRef.current = setInterval(() => {
      setAiCountdown((prev) => {
        if (prev <= 1) {
          clearAiTimers();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // 5 分钟强制解锁
    aiTimeoutRef.current = setTimeout(() => {
      unlockAi('timeout');
    }, TIMEOUT_MS);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/optimize-skill', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          skillData: {
            name: skill.name,
            displayName: editName || skill.displayName,
            description: editName || skill.displayName,
            content: editContent,
            systemPrompt: '',
            userPrompt: '',
            tools: [],
            cwe: skill.cwe,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'AI 优化失败');
      }

      // 将优化后的 content 存入待对比状态，打开对比弹窗
      if (data.optimizedSkill?.content) {
        setAiDiffContent(data.optimizedSkill.content);
        setShowDiffModal(true);
      }
      // 若后端返回 displayName，同步更新
      if (data.optimizedSkill?.displayName && !editName) {
        setEditName(data.optimizedSkill.displayName);
      }
      // 展示优化建议
      if (data.suggestions && data.suggestions.length > 0) {
        setAiSuggestions(data.suggestions);
        setShowAiSuggestions(true);
      }
      setAiOptimizeSuccess(true);
      setTimeout(() => setAiOptimizeSuccess(false), 3000);
    } catch (err) {
      setAiOptimizeError(err instanceof Error ? err.message : 'AI 优化失败，请重试');
    } finally {
      unlockAi();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div className="bg-red-900/20 border border-red-200 text-red-400 px-4 py-3 rounded">
        {error || 'Skill 不存在'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* AI 优化全屏遮罩 */}
      {aiOptimizing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-dark-surface rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4 max-w-sm w-full mx-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center animate-pulse">
              <Sparkles size={32} className="text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-100">AI 正在优化 Skill</h3>
            <p className="text-sm text-gray-500 text-center">
              大模型分析中，请勿关闭页面或进行其他操作...
            </p>
            {/* 进度条动画 */}
            <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full animate-[progress_2s_ease-in-out_infinite]"
                style={{ width: `${Math.max(5, 100 - (aiCountdown / 300) * 100)}%`, transition: 'width 1s linear' }} />
            </div>
            {/* 倒计时 */}
            {aiCountdown > 0 && (
              <p className="text-xs text-gray-400">
                最长等待 {Math.floor(aiCountdown / 60)}:{String(aiCountdown % 60).padStart(2, '0')}，超时将自动解锁
              </p>
            )}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-dark-surface-hover rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-gray-100">{skill.displayName}</h1>
              {skill.isBuiltin && (
                <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded-full">
                  内置
                </span>
              )}
              {!skill.isActive && (
                <span className="px-2 py-0.5 text-xs bg-dark-surface-hover text-gray-400 rounded-full">
                  已禁用
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400">{skill.name}</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {/* 导出按钮 */}
          <button
            onClick={handleCopyMd}
            className="inline-flex items-center px-4 py-2 border border-gray-600 rounded-lg hover:bg-dark-bg transition-colors"
          >
            {copied ? (
              <>
                <CheckCircle size={16} className="mr-2 text-green-400" />
                已复制
              </>
            ) : (
              <>
                <Copy size={16} className="mr-2" />
                复制 MD
              </>
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {exporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                导出中...
              </>
            ) : (
              <>
                <Download size={16} className="mr-2" />
                导出 .skill
              </>
            )}
          </button>
          
          {/* 根据权限显示操作按钮 */}
          {(() => {
            // 权限检查：管理员可操作所有，用户只能操作自己的私有 Skill
            const canEdit = isAdmin || (skill.userId !== null && skill.userId === currentUserId);
            const canDelete = isAdmin || (skill.userId !== null && skill.userId === currentUserId && !skill.isBuiltin);
            const canToggleActive = canEdit;
            
            if (!canEdit && !canDelete) return null;
            
            return (
              <>
                {!isEditing ? (
                  <>
                    {canToggleActive && (
                      <button
                        onClick={handleToggleActive}
                        className={`inline-flex items-center px-4 py-2 rounded-lg transition-colors ${
                          skill.isActive
                            ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                            : 'bg-green-100 text-green-800 hover:bg-green-200'
                        }`}
                      >
                        {skill.isActive ? (
                          <>
                            <XCircle size={16} className="mr-2" />
                            禁用
                          </>
                        ) : (
                          <>
                            <CheckCircle size={16} className="mr-2" />
                            启用
                          </>
                        )}
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={startEditing}
                        className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <Edit size={16} className="mr-2" />
                        编辑
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={handleDelete}
                        className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                      >
                        <Trash2 size={16} className="mr-2" />
                        删除
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={cancelEditing}
                      disabled={saving}
                      className="px-4 py-2 border border-gray-600 rounded-lg hover:bg-dark-bg transition-colors disabled:opacity-50"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => setShowNewVersionModal(true)}
                      disabled={saving}
                      className="inline-flex items-center px-4 py-2 border border-blue-300 text-blue-400 rounded-lg hover:bg-blue-900/20 transition-colors disabled:opacity-50"
                    >
                      <Plus size={16} className="mr-2" />
                      保存为新版本
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving}
                      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          保存中...
                        </>
                      ) : (
                        <>
                          <Save size={16} className="mr-2" />
                          保存
                        </>
                      )}
                    </button>
                  </>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* Content */}
      <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6">
        {isEditing ? (
          <div className="space-y-6">
            {/* 编辑模式切换 */}
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-2 p-1 bg-dark-bg rounded-lg">
                <button
                  type="button"
                  onClick={() => setEditMode('content')}
                  className={`px-4 py-2 text-sm rounded-md transition-colors ${
                    editMode === 'content'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  编辑内容
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode('file')}
                  className={`px-4 py-2 text-sm rounded-md transition-colors ${
                    editMode === 'file'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  上传文件替换
                </button>
              </div>
              {editMode === 'file' && (
                <span className="text-xs text-yellow-400">
                  ⚠️ 上传新文件将完全替换原有内容
                </span>
              )}
            </div>

            {/* 文件上传模式 */}
            {editMode === 'file' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    上传 Skill 文件
                  </label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 px-4 py-2 bg-dark-bg border border-gray-600 rounded-lg cursor-pointer hover:border-gray-400 transition-colors">
                      <FileUp size={16} className="text-gray-400" />
                      <span className="text-sm text-gray-300">选择文件</span>
                      <input
                        type="file"
                        accept=".md,.zip"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                    {editFile && (
                      <div className="flex items-center gap-2">
                        <CheckCircle size={14} className="text-green-400" />
                        <span className="text-sm text-green-400">{editFile.name}</span>
                      </div>
                    )}
                  </div>
                  {editFileError && (
                    <p className="mt-2 text-sm text-red-400">{editFileError}</p>
                  )}
                  <p className="mt-2 text-xs text-gray-500">
                    支持 .md 文件或包含 SKILL.md 的 ZIP 文件
                  </p>
                </div>

                {editParsed && (
                  <div className="p-4 bg-dark-bg border border-gray-600 rounded-lg">
                    <h4 className="text-sm font-medium text-gray-300 mb-2">解析结果</h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">名称:</span>
                        <span className="text-gray-300">{editParsed.displayName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">描述:</span>
                        <span className="text-gray-300">{editParsed.description.substring(0, 100)}...</span>
                      </div>
                      {editParsed.cwe && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">CWE:</span>
                          <span className="text-gray-300">{editParsed.cwe}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 基本信息 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Skill 名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                  disabled={editMode === 'file' && !!editParsed}
                />
              </div>
              
              {/* 分类选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  分类 <span className="text-red-500">*</span>
                </label>
                <select
                  value={editCategoryId}
                  onChange={(e) => {
                    setEditCategoryId(e.target.value);
                    setEditVulnerabilityTreeId(null);
                  }}
                  disabled={loadingCategories}
                  className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">选择分类</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.icon ? cat.icon + ' ' : ''}{cat.displayName}</option>
                  ))}
                </select>
              </div>

              {/* 漏洞类型选择（仅当分类有子维度时显示） */}
              {(() => {
                const selectedCat = categories.find(c => c.id === editCategoryId);
                return selectedCat?.hasSubDimension ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      漏洞类型 <span className="text-red-500">*</span>
                    </label>
                    <VulnerabilityTreeSelector
                      value={editVulnerabilityTreeId}
                      onChange={(nodeId) => setEditVulnerabilityTreeId(nodeId)}
                      placeholder="选择漏洞类型"
                    />
                  </div>
                ) : null;
              })()}

              {/* 适用产品 */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  适用产品 <span className="text-xs text-gray-400">（不选则适用于所有产品）</span>
                </label>
                <ProductTagSelect 
                  selectedIds={editProductTagIds} 
                  onChange={setEditProductTagIds} 
                />
              </div>
            </div>

{/* 内容编辑模式 */}
            {editMode === 'content' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-300">
                    Skill 内容（Markdown 格式）
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAiOptimize}
                      disabled={aiOptimizing}
                      className="inline-flex items-center px-3 py-1.5 text-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                      title="使用大模型 AI 优化当前 Skill 内容，提升触发准确性和功能完整性"
                    >
                      {aiOptimizing ? (
                        <>
                          <Loader2 size={14} className="mr-1.5 animate-spin" />
                          AI 优化中...
                        </>
                      ) : aiOptimizeSuccess ? (
                        <>
                          <CheckCircle size={14} className="mr-1.5" />
                          优化完成！
                        </>
                      ) : (
                        <>
                          <Sparkles size={14} className="mr-1.5" />
                          AI 优化
                        </>
                      )}
                    </button>
                    {aiDiffContent && !aiOptimizing && (
                      <button
                        type="button"
                        onClick={() => setShowDiffModal(true)}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-indigo-900/20 text-indigo-400 border border-indigo-500/30 rounded-lg hover:bg-indigo-900/30 transition-all"
                        title="重新打开上次 AI 优化结果的对比弹窗"
                      >
                        <Eye size={14} className="mr-1.5" />
                        查看上次对比
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (skill) {
                          setEditContent(skill.content || '');
                        }
                      }}
                      className="text-sm text-blue-400 hover:text-blue-800"
                    >
                      重置为原始内容
                    </button>
                  </div>
                </div>

                {aiOptimizeError && (
                  <div className="mb-3 flex items-start gap-2 bg-red-900/20 border border-red-200 text-red-400 px-4 py-3 rounded-lg text-sm">
                    <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{aiOptimizeError}</span>
                  </div>
                )}

                {aiSuggestions.length > 0 && (
                  <div className="mb-3 bg-purple-900/20 border border-purple-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowAiSuggestions(!showAiSuggestions)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-purple-400 hover:bg-purple-900/20 transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles size={14} />
                        AI 优化建议（{aiSuggestions.length} 条）
                      </span>
                      {showAiSuggestions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {showAiSuggestions && (
                      <ul className="px-4 pb-3 space-y-1.5">
                        {aiSuggestions.map((suggestion, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-purple-400">
                            <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-purple-200 text-purple-800 flex items-center justify-center text-xs font-bold">
                              {idx + 1}
                            </span>
                            {suggestion}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="mb-3 border border-gray-700/50 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowFormatHint(!showFormatHint)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-dark-bg hover:bg-dark-surface-hover transition-colors text-sm text-gray-400"
                  >
                    <span className="flex items-center gap-1.5">
                      <FileText size={14} />
                      缺陷发现 Skill 格式建议
                    </span>
                    {showFormatHint ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {showFormatHint && (
                    <div className="px-4 py-3 bg-dark-bg border-t border-gray-700/50">
                      <div className="space-y-4">
                        <div className="bg-red-900/20 border border-red-200 rounded-lg p-3">
                          <p className="text-xs font-semibold text-red-400 mb-2">⛔ 禁止生成（系统会自动添加）</p>
                          <ul className="text-xs text-red-400 space-y-1">
                            <li>❌ YAML frontmatter（--- name: xxx ---）</li>
                            <li>❌ 一级标题（# 漏洞名称）</li>
                            <li>❌ ## 输出格式 章节</li>
                          </ul>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-300 mb-2">必须包含的章节：</p>
                          <div className="text-xs text-gray-400 font-mono space-y-1">
                            {getFormatGuideData().sections.map((section, idx) => (
                              <p key={idx} className={section.highlight ? 'text-blue-400 font-medium' : ''}>
                                {section.name}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-300 mb-2">关键原则：</p>
                          <ul className="text-xs text-gray-400 space-y-1">
                            {getFormatGuideData().principles.slice(0, 4).map((p, idx) => (
                              <li key={idx}>{p.title} — {p.description}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-[500px] px-4 py-3 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
                  placeholder="输入 Markdown 格式的 Skill 定义..."
                />
              </div>
            )}

            {/* 是否启用 */}
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="rounded border-gray-600 text-blue-400 focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-300">启用此 Skill</span>
              </label>
            </div>
          </div>
        ) : (
          /* 查看模式 */
          <div className="space-y-6">
            {/* 关键指标（靠前显示） */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 bg-dark-bg p-4 rounded-lg border border-gray-700/50">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">版本</h3>
                <p className="text-lg font-semibold text-gray-100">v{skill.version}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">执行次数</h3>
                <p className="text-lg font-semibold text-gray-100">{skill.execCount}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">发现问题</h3>
                <button
                  onClick={() => {
                    setShowVulnerabilities(!showVulnerabilities);
                    if (!showVulnerabilities) {
                      fetchVulnerabilities(1, 'all');
                    }
                  }}
                  className="text-lg font-semibold text-blue-400 hover:text-blue-800 hover:underline flex items-center gap-1"
                >
                  {vulnStats.total || skill.vulnerabilityCount || 0} 个
                  {showVulnerabilities ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">误报</h3>
                <button
                  onClick={() => {
                    setShowVulnerabilities(true);
                    fetchVulnerabilities(1, 'false-positive');
                  }}
                  className={`text-lg font-semibold flex items-center gap-1 ${(vulnStats.falsePositive || 0) > 0 ? 'text-orange-400 hover:text-orange-300 hover:underline' : 'text-gray-400'}`}
                >
                  {vulnStats.falsePositive || 0} 个
                </button>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">成功率</h3>
                <p className="text-lg font-semibold text-gray-100">
                  {skill.successRate ? `${(skill.successRate * 100).toFixed(1)}%` : 'N/A'}
                  {skill.execCount > 0 && skill.successExecCount > 0 && (
                    <span className="text-xs text-gray-500 ml-1">
                      ({skill.successExecCount}/{skill.execCount})
                    </span>
                  )}
                </p>
              </div>
            </div>
            
            {/* 漏洞明细列表 */}
            {showVulnerabilities && (
              <div className="p-4 bg-dark-surface rounded-lg border border-gray-700/50">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-gray-100">发现的漏洞明细</h4>
                  <div className="flex items-center gap-4">
                    {/* 筛选按钮 */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => fetchVulnerabilities(1, 'all')}
                        className={`px-2 py-1 text-xs rounded ${vulnFilter === 'all' ? 'bg-blue-100 text-blue-400' : 'bg-dark-surface-hover text-gray-400 hover:bg-gray-200'}`}
                      >
                        全部 ({vulnStats.total})
                      </button>
                      <button
                        onClick={() => fetchVulnerabilities(1, 'new')}
                        className={`px-2 py-1 text-xs rounded ${vulnFilter === 'new' ? 'bg-green-100 text-green-400' : 'bg-dark-surface-hover text-gray-400 hover:bg-gray-200'}`}
                      >
                        新发现 ({vulnStats.new})
                      </button>
                      <button
                        onClick={() => fetchVulnerabilities(1, 'confirmed')}
                        className={`px-2 py-1 text-xs rounded ${vulnFilter === 'confirmed' ? 'bg-blue-100 text-blue-400' : 'bg-dark-surface-hover text-gray-400 hover:bg-gray-200'}`}
                      >
                        已确认 ({vulnStats.confirmed})
                      </button>
                      <button
                        onClick={() => fetchVulnerabilities(1, 'false-positive')}
                        className={`px-2 py-1 text-xs rounded ${vulnFilter === 'false-positive' ? 'bg-orange-900/20 text-orange-400' : 'bg-dark-surface-hover text-gray-400 hover:bg-gray-700'}`}
                      >
                        误报 ({vulnStats.falsePositive})
                      </button>
                    </div>
                    <span className="text-sm text-gray-500">当前 {vulnTotal} 条</span>
                  </div>
                </div>
                
                {vulnLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                  </div>
                ) : vulnerabilities.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    暂无漏洞记录
                  </div>
                ) : (
                  <>
                    <div className="space-y-3">
                      {vulnerabilities.map((item, index) => (
                        <div key={item.mappingId || index} className="p-3 bg-dark-bg rounded border border-gray-100 hover:border-gray-700/50">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  item.vulnerability?.severity === 'critical' ? 'bg-red-100 text-red-400' :
                                  item.vulnerability?.severity === 'high' ? 'bg-orange-900/20 text-orange-400' :
                                  item.vulnerability?.severity === 'medium' ? 'bg-yellow-100 text-yellow-400' :
                                  item.vulnerability?.severity === 'low' ? 'bg-blue-100 text-blue-400' :
                                  'bg-dark-surface-hover text-gray-300'
                                }`}>
                                  {item.vulnerability?.severity || 'info'}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  item.vulnerability?.status === 'false-positive' ? 'bg-orange-900/20 text-orange-600' :
                                  item.vulnerability?.status === 'confirmed' ? 'bg-green-900/20 text-green-400' :
                                  item.vulnerability?.status === 'fixed' ? 'bg-blue-900/20 text-blue-400' :
                                  item.vulnerability?.status === 'verified' ? 'bg-purple-900/20 text-purple-600' :
                                  'bg-dark-bg text-gray-400'
                                }`}>
                                  {item.vulnerability?.status === 'false-positive' ? '误报' :
                                   item.vulnerability?.status === 'confirmed' ? '已确认' :
                                   item.vulnerability?.status === 'fixed' ? '已修复' :
                                   item.vulnerability?.status === 'verified' ? '已验证' :
                                   '新发现'}
                                </span>
                                <span className="font-medium text-gray-100">{item.vulnerability?.title || '未命名漏洞'}</span>
                              </div>
                              <div className="mt-1 text-sm text-gray-400">
                                {item.vulnerability?.type && <span className="mr-2">类型: {item.vulnerability.type}</span>}
                                {item.vulnerability?.location && <span className="mr-2">位置: {item.vulnerability.location}</span>}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                发现时间: {new Date(item.matchedAt).toLocaleString()}
                                {item.evaluation?.project && <span className="ml-2">项目: {item.evaluation.project.name}</span>}
                              </div>
                            </div>
                            <a
                              href={`/vulnerabilities/${item.vulnerability?.id}`}
                              className="px-2 py-1 rounded text-xs bg-blue-900/20 text-blue-400 hover:bg-blue-100"
                            >
                              查看
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* 分页 */}
                    {vulnTotalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 mt-4">
                        <button
                          onClick={() => fetchVulnerabilities(vulnPage - 1, vulnFilter)}
                          disabled={vulnPage === 1}
                          className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-dark-surface-hover"
                        >
                          上一页
                        </button>
                        <span className="text-sm text-gray-400">
                          {vulnPage} / {vulnTotalPages}
                        </span>
                        <button
                          onClick={() => fetchVulnerabilities(vulnPage + 1, vulnFilter)}
                          disabled={vulnPage === vulnTotalPages}
                          className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-dark-surface-hover"
                        >
                          下一页
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            
            {/* 基本信息 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">SKILL类型</h3>
                <p className="text-gray-100">
                  {skill.categoryName ? (() => {
                    const iconMap: Record<string, any> = { Bug, Search, Shield, Code, LayoutDashboard, TrendingUp };
                    const Icon = skill.categoryIcon ? iconMap[skill.categoryIcon] : null;
                    return (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm bg-purple-900/20 text-purple-400 rounded-md">
                        {Icon && <Icon size={14} />}
                        {skill.categoryName}
                      </span>
                    );
                  })() : '无'}
                </p>
              </div>
              {skill.hasSubDimension && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">攻击模式</h3>
                  <div className="text-gray-100 flex items-center gap-1">
                    {skill.languageName && (
                      <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-400 rounded">
                        {skill.languageName}
                      </span>
                    )}
                    {skill.patternName && (
                      <span className="px-2 py-0.5 text-xs bg-orange-900/20 text-orange-400 rounded">
                        {skill.patternName}
                      </span>
                    )}
                    {!skill.languageName && !skill.patternName && <span>无</span>}
                  </div>
                </div>
              )}
<div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">适用产品</h3>
                  <div className="text-gray-100">
                    {skill.productTags && skill.productTags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {skill.productTags.map(tag => (
                          <span key={tag.id} className="px-2 py-0.5 text-xs bg-green-100 text-green-400 rounded">
                            {tag.displayName}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="px-2 py-0.5 text-xs bg-green-100 text-green-400 rounded">所有产品</span>
                    )}
                  </div>
                </div>
            </div>

            {/* Markdown 内容 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-medium text-gray-100">Skill 内容</h3>
                <button
                  onClick={async () => {
                    if (skill.content) {
                      const skillOutputTemplate = await getSkillOutputTemplate();
                      let content = skill.content || '';
                      if (skillOutputTemplate && skillOutputTemplate.trim()) {
                        content = content + '\n\n' + skillOutputTemplate;
                      }
                      copyToClipboard(content);
                    }
                  }}
                  className="inline-flex items-center text-sm text-blue-400 hover:text-blue-800"
                >
                  <Copy size={14} className="mr-1" />
                  复制 Markdown
                </button>
              </div>
              <div className="bg-dark-bg p-4 rounded-lg overflow-x-auto text-sm prose prose-sm max-w-none">
                <MarkdownRenderer 
                  content={skillOutputTemplate && skillOutputTemplate.trim()
                    ? (skill.content || '') + '\n\n' + skillOutputTemplate
                    : (skill.content || '暂无内容')}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== 版本管理区域 ===== */}
      {!isEditing && skill && (
        <>
          {/* 版本查看提示条 */}
          {viewingVersionId && viewingVersionId !== skill.id && (
            <div className="bg-indigo-900/20 border border-indigo-200 rounded-lg px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
<History size={18} className="text-indigo-400" />
                  <div>
                    <span className="text-sm font-medium text-indigo-300">
                      正在查看历史版本 v{viewingVersionNumber}
                    </span>
                    <span className="text-xs text-indigo-400 ml-2">
                    (当前版本: v{skill.version})
                  </span>
                </div>
              </div>
              <button
                onClick={handleCloseVersionView}
                className="px-3 py-1 text-sm bg-indigo-900/20 text-indigo-400 rounded hover:bg-indigo-900/30 transition-colors"
              >
                返回当前版本
              </button>
            </div>
          )}

          {/* 版本历史面板 */}
          <SkillVersionHistory
            skillId={skill.id}
            currentVersionId={skill.id}
            onSelectVersion={handleSelectVersion}
            onRollback={handleRollbackVersion}
            onCompare={handleCompareVersion}
            canEdit={isAdmin || (skill.userId !== null && skill.userId === currentUserId)}
          />
        </>
      )}

      {/* 版本内容查看区域 */}
      {viewingVersionId && viewingVersionId !== skill?.id && !isEditing && (
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-6 mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-100">
              v{viewingVersionNumber} 版本内容
            </h3>
            <button
              onClick={() => {
                if (viewingVersionContent) {
                  navigator.clipboard.writeText(viewingVersionContent);
                  toast.success('已复制版本内容');
                }
              }}
              className="inline-flex items-center text-sm text-blue-400 hover:text-blue-800"
            >
              <Copy size={14} className="mr-1" />
              复制内容
            </button>
          </div>
          <div className="bg-dark-bg p-4 rounded-lg overflow-x-auto text-sm prose prose-sm max-w-none">
            <MarkdownRenderer content={viewingVersionContent || '暂无内容'} />
          </div>
        </div>
      )}

      {/* 版本对比弹窗 */}
      {showVersionDiffModal && skill && (
        <SkillVersionDiffModal
          isOpen={showVersionDiffModal}
          onClose={() => setShowVersionDiffModal(false)}
          skillId={skill.id}
          targetVersionId={diffTargetVersionId}
          targetVersionNumber={diffTargetVersionNumber}
          currentVersionNumber={skill.version}
          currentContent={skill.content || ''}
        />
      )}

      {/* 回滚确认弹窗 */}
      {showRollbackModal && skill && (
        <SkillRollbackModal
          isOpen={showRollbackModal}
          onClose={() => setShowRollbackModal(false)}
          onSuccess={handleRollbackSuccess}
          skillId={skill.id}
          currentVersionId={skill.id}
          targetVersionId={rollbackTargetVersionId}
          targetVersionNumber={rollbackTargetVersionNumber}
          currentVersionNumber={skill.version}
          skillDisplayName={skill.displayName}
        />
      )}

      {/* 创建新版本弹窗 */}
      {showNewVersionModal && skill && (
        <SkillNewVersionModal
          isOpen={showNewVersionModal}
          onClose={() => setShowNewVersionModal(false)}
          onSuccess={handleNewVersionSuccess}
          skillId={skill.id}
          currentVersionNumber={skill.version}
          skillDisplayName={skill.displayName}
          editData={{
            displayName: editName,
            description: editName,
            content: editContent,
            isActive: editIsActive,
            categoryId: editCategoryId,
            vulnerabilityTreeId: editVulnerabilityTreeId,
          }}
        />
      )}

      {/* AI 优化内容对比弹窗 */}
      {showDiffModal && (() => {
        // ── 轻量 LCS diff 引擎 ──
        const leftLines = editContent.split('\n');
        const rightLines = aiDiffContent.split('\n');

        // LCS 动态规划
        const lcs = (a: string[], b: string[]) => {
          const m = a.length, n = b.length;
          const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
          for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
              dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
          return dp;
        };

        type DiffRow = { type: 'same'|'removed'|'added'|'empty'; text: string; lineNo: number|null };

        const buildDiff = (a: string[], b: string[]): { left: DiffRow[]; right: DiffRow[] } => {
          const dp = lcs(a, b);
          const left: DiffRow[] = [], right: DiffRow[] = [];
          let i = a.length, j = b.length;
          const ops: Array<'same'|'removed'|'added'> = [];
          while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && a[i-1] === b[j-1]) { ops.unshift('same'); i--; j--; }
            else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { ops.unshift('added'); j--; }
            else { ops.unshift('removed'); i--; }
          }
          let li = 0, ri = 0;
          for (const op of ops) {
            if (op === 'same') {
              left.push({ type: 'same', text: a[li], lineNo: li + 1 }); li++;
              right.push({ type: 'same', text: b[ri], lineNo: ri + 1 }); ri++;
            } else if (op === 'removed') {
              left.push({ type: 'removed', text: a[li], lineNo: li + 1 }); li++;
              right.push({ type: 'empty', text: '', lineNo: null });
            } else {
              left.push({ type: 'empty', text: '', lineNo: null });
              right.push({ type: 'added', text: b[ri], lineNo: ri + 1 }); ri++;
            }
          }
          return { left, right };
        };

        const { left: leftDiff, right: rightDiff } = buildDiff(leftLines, rightLines);

        const rowBg = (type: DiffRow['type'], side: 'left'|'right') => {
          if (type === 'removed') return 'bg-[rgba(248,81,73,0.15)] border-l-2 border-l-[#f85149]';
          if (type === 'added') return 'bg-[rgba(63,185,80,0.15)] border-l-2 border-l-[#3fb950]';
          if (type === 'empty') return side === 'left' ? 'bg-[rgba(63,185,80,0.08)]' : 'bg-[rgba(248,81,73,0.08)]';
          return '';
        };
        const textColor = (type: DiffRow['type']) => {
          if (type === 'removed') return 'text-[#ffa198]';
          if (type === 'added') return 'text-[#7ee787]';
          if (type === 'empty') return 'text-transparent select-none';
          return 'text-[#c9d1d9]';
        };
        const lineNoBg = (type: DiffRow['type']) => {
          if (type === 'removed') return 'bg-[rgba(248,81,73,0.1)] text-[#ffa198]';
          if (type === 'added') return 'bg-[rgba(63,185,80,0.1)] text-[#7ee787]';
          if (type === 'empty') return 'bg-[#161b22] text-transparent';
          return 'bg-[#161b22] text-[#6e7681]';
        };
        const marker = (type: DiffRow['type']) => {
          if (type === 'removed') return <span className="text-[#f85149] select-none mr-1 font-bold">−</span>;
          if (type === 'added') return <span className="text-[#3fb950] select-none mr-1 font-bold">+</span>;
          return <span className="select-none mr-1 opacity-0">·</span>;
        };

        const changedCount = rightDiff.filter(r => r.type === 'added').length +
                             leftDiff.filter(r => r.type === 'removed').length;

        // 同步滚动
        const leftRef = (el: HTMLDivElement | null) => { (window as any).__diffLeft = el; };
        const rightRef = (el: HTMLDivElement | null) => { (window as any).__diffRight = el; };
        const onLeftScroll = (e: React.UIEvent<HTMLDivElement>) => {
          const r = (window as any).__diffRight;
          if (r) r.scrollTop = (e.target as HTMLDivElement).scrollTop;
        };
        const onRightScroll = (e: React.UIEvent<HTMLDivElement>) => {
          const l = (window as any).__diffLeft;
          if (l) l.scrollTop = (e.target as HTMLDivElement).scrollTop;
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#010409]/85 backdrop-blur-md p-4">
            <div className="bg-[#0d1117] rounded-xl shadow-2xl shadow-black/50 w-full max-w-7xl max-h-[92vh] flex flex-col border border-[#30363d]">

              <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#21262d] flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#8957e5] to-[#a371f7] flex items-center justify-center">
                    <Sparkles size={15} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#e6edf3]">AI 优化内容对比</h2>
                    <p className="text-xs text-[#7d8590] mt-0.5">
                      共 <span className="font-medium text-[#f0883e]">{changedCount}</span> 处变更 ·
                      <span className="ml-1.5 inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#f85149] inline-block"/>删除</span>
                      <span className="ml-2 inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#3fb950] inline-block"/>新增</span>
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowDiffModal(false)}
                  className="p-2 text-[#7d8590] hover:text-[#e6edf3] hover:bg-[#21262d] rounded-md transition-colors">
                  <X size={18} />
                </button>
              </div>

              {aiSuggestions.length > 0 && (
                <div className="px-5 py-2.5 bg-[#1c1b29] border-b border-[#21262d] flex-shrink-0">
                  <span className="text-xs font-medium text-[#a371f7]">AI 优化说明：</span>
                  <span className="text-xs text-[#bc8cff] ml-2">{aiSuggestions.join('；')}</span>
                </div>
              )}

              <div className="flex divide-x divide-[#21262d] flex-shrink-0 border-b border-[#21262d]">
                <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-[#0d1117]">
                  <span className="w-2 h-2 rounded-full bg-[#f85149]"/>
                  <span className="text-[13px] text-[#7d8590]">原始内容</span>
                </div>
                <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-[#0d1117]">
                  <span className="w-2 h-2 rounded-full bg-[#3fb950]"/>
                  <span className="text-[13px] text-[#7d8590]">AI 优化后</span>
                </div>
              </div>

              {/* diff 主体 — 同步滚动 */}
              <div className="flex-1 flex divide-x divide-[#21262d] min-h-0 overflow-hidden">
                <div ref={leftRef} onScroll={onLeftScroll}
                  className="flex-1 overflow-auto font-mono text-[13px] leading-6 bg-[#0d1117]">
                  {leftDiff.map((row, idx) => (
                    <div key={idx} className={`flex min-w-0 hover:bg-[#161b22] transition-colors ${rowBg(row.type, 'left')}`}>
                      <span className={`w-12 shrink-0 text-right pr-3 py-0.5 select-none text-[11px] border-r border-[#21262d] ${lineNoBg(row.type)}`}>
                        {row.lineNo ?? ''}
                      </span>
                      <span className={`w-5 shrink-0 flex items-center justify-center py-0.5`}>
                        {marker(row.type)}
                      </span>
                      <span className={`flex-1 py-0.5 pr-4 whitespace-pre ${textColor(row.type)}`}>
                        {row.type === 'empty' ? '\u00a0' : row.text}
                      </span>
                    </div>
                  ))}
                </div>

                <div ref={rightRef} onScroll={onRightScroll}
                  className="flex-1 overflow-auto font-mono text-[13px] leading-6 bg-[#0d1117]">
                  {rightDiff.map((row, idx) => (
                    <div key={idx} className={`flex min-w-0 hover:bg-[#161b22] transition-colors ${rowBg(row.type, 'right')}`}>
                      <span className={`w-12 shrink-0 text-right pr-3 py-0.5 select-none text-[11px] border-r border-[#21262d] ${lineNoBg(row.type)}`}>
                        {row.lineNo ?? ''}
                      </span>
                      <span className={`w-5 shrink-0 flex items-center justify-center py-0.5`}>
                        {marker(row.type)}
                      </span>
                      <span className={`flex-1 py-0.5 pr-4 whitespace-pre ${textColor(row.type)}`}>
                        {row.type === 'empty' ? '\u00a0' : row.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[#21262d] flex-shrink-0 bg-[#0d1117]">
                <button
                  onClick={() => { setShowDiffModal(false); }}
                  className="px-4 py-1.5 text-[13px] border border-[#30363d] text-[#c9d1d9] rounded-md hover:bg-[#21262d] hover:border-[#484f58] transition-colors"
                >
                  放弃，保留原始内容
                </button>
                <button
                  onClick={() => { setEditContent(aiDiffContent); setShowDiffModal(false); setAiDiffContent(''); }}
                  className="inline-flex items-center px-4 py-1.5 text-[13px] font-medium bg-[#238636] text-white rounded-md hover:bg-[#2ea043] transition-colors"
                >
                  <CheckCircle size={14} className="mr-1.5" />
                  采用 AI 优化内容
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
