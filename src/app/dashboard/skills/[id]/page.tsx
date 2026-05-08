'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
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
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/permissions';
import { exportAsSkillFile, copySkillMdToClipboard } from '@/lib/skill-export';
import { buildFullSkill, getFormatGuideData, cleanSkillContentForOptimization, type SkillIntent } from '@/lib/skill-builder';
import { SkillVersionHistory } from '@/components/skills/SkillVersionHistory';
import { SkillVersionDiffModal } from '@/components/skills/SkillVersionDiffModal';
import { SkillRollbackModal } from '@/components/skills/SkillRollbackModal';
import { SkillNewVersionModal } from '@/components/skills/SkillNewVersionModal';
import toast from 'react-hot-toast';

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  categoryId: string;
  vulnerabilityTreeId: string | null;
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
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editCategoryId, setEditCategoryId] = useState<string>('');
  const [editVulnerabilityTreeId, setEditVulnerabilityTreeId] = useState<string>('');
  const [editSelectedLanguageId, setEditSelectedLanguageId] = useState<string>('');
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
  const [vulnerabilityTree, setVulnerabilityTree] = useState<Array<{ id: string; name: string; displayName: string; patterns: Array<{ id: string; name: string; displayName: string }> }>>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  
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
    setEditCategoryId(skill.categoryId || '');
    setEditVulnerabilityTreeId(skill.vulnerabilityTreeId || '');
    setEditSelectedLanguageId('');
    setEditContent(skill.content || '');
    setEditIsActive(skill.isActive);
    setIsEditing(true);

    // 加载分类和漏洞树数据
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

    // 如果有子维度，加载漏洞树并回显语言
    if (skill.hasSubDimension) {
      setLoadingTree(true);
      try {
        const res = await fetch('/api/skills/vulnerability-tree', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setVulnerabilityTree(data.tree || []);
          // 回显：根据当前 vulnerabilityTreeId 找到所属语言
          if (skill.vulnerabilityTreeId) {
            for (const lang of (data.tree || [])) {
              const found = lang.patterns.find((p: { id: string }) => p.id === skill.vulnerabilityTreeId);
              if (found) {
                setEditSelectedLanguageId(lang.id);
                break;
              }
            }
          }
        }
      } catch (e) {
        console.error('获取漏洞树失败:', e);
      } finally {
        setLoadingTree(false);
      }
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!skill) return;

    if (!editName.trim()) {
      alert('请输入 Skill 名称');
      return;
    }

    if (!editCategoryId) {
      alert('请选择分类');
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');

      // 直接保存用户编辑的内容，不清理输出格式
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
          vulnerabilityTreeId: editVulnerabilityTreeId || null,
          content: editContent,
          isActive: editIsActive,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '保存失败');
      }

      setIsEditing(false);
      fetchSkill();
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
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
    } catch (error) {
      console.error('复制失败:', error);
      alert('复制失败，请重试');
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
                    setEditVulnerabilityTreeId('');
                    setEditSelectedLanguageId('');
                    // 检查选中的分类是否有子维度
                    const selected = categories.find(c => c.id === e.target.value);
                    if (selected?.hasSubDimension) {
                      setLoadingTree(true);
                      const token = localStorage.getItem('token');
                      fetch('/api/skills/vulnerability-tree', { headers: { Authorization: `Bearer ${token}` } })
                        .then(res => res.ok ? res.json() : { tree: [] })
                        .then(data => setVulnerabilityTree(data.tree || []))
                        .catch(() => setVulnerabilityTree([]))
                        .finally(() => setLoadingTree(false));
                    } else {
                      setVulnerabilityTree([]);
                    }
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

              {/* 语言选择（仅当分类有子维度时显示） */}
              {(() => {
                const selectedCat = categories.find(c => c.id === editCategoryId);
                return selectedCat?.hasSubDimension ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      语言
                    </label>
                    <select
                      value={editSelectedLanguageId}
                      onChange={(e) => {
                        setEditSelectedLanguageId(e.target.value);
                        setEditVulnerabilityTreeId('');
                      }}
                      disabled={loadingTree}
                      className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value="">选择语言</option>
                      {vulnerabilityTree.map((lang) => (
                        <option key={lang.id} value={lang.id}>{lang.displayName}</option>
                      ))}
                    </select>
                  </div>
                ) : null;
              })()}

              {/* 模式选择（级联，选择语言后显示） */}
              {editSelectedLanguageId && (() => {
                const selectedLang = vulnerabilityTree.find(l => l.id === editSelectedLanguageId);
                return selectedLang && selectedLang.patterns.length > 0 ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      模式
                    </label>
                    <select
                      value={editVulnerabilityTreeId}
                      onChange={(e) => setEditVulnerabilityTreeId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value="">选择模式</option>
                      {selectedLang.patterns.map((p) => (
                        <option key={p.id} value={p.id}>{p.displayName}</option>
                      ))}
                    </select>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Markdown 内容 */}
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
                  {/* 有缓存的 AI 结果时，显示重新查看对比按钮 */}
                  {aiDiffContent && !aiOptimizing && (
                    <button
                      type="button"
                      onClick={() => setShowDiffModal(true)}
                      className="inline-flex items-center px-3 py-1.5 text-sm bg-indigo-900/20 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-all"
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

              {/* AI 优化错误提示 */}
              {aiOptimizeError && (
                <div className="mb-3 flex items-start gap-2 bg-red-900/20 border border-red-200 text-red-400 px-4 py-3 rounded-lg text-sm">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{aiOptimizeError}</span>
                </div>
              )}

              {/* AI 优化建议 */}
              {aiSuggestions.length > 0 && (
                <div className="mb-3 bg-purple-900/20 border border-purple-200 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowAiSuggestions(!showAiSuggestions)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-purple-800 hover:bg-purple-100 transition-colors"
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
                        <li key={idx} className="flex items-start gap-2 text-sm text-purple-700">
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
                    {/* 新格式建议 */}
                    <div className="space-y-4">
                      {/* 禁止生成提醒 */}
                      <div className="bg-red-900/20 border border-red-200 rounded-lg p-3">
                        <p className="text-xs font-semibold text-red-400 mb-2">⛔ 禁止生成（系统会自动添加）</p>
                        <ul className="text-xs text-red-400 space-y-1">
                          <li>❌ YAML frontmatter（--- name: xxx ---）</li>
                          <li>❌ 一级标题（# 漏洞名称）</li>
                          <li>❌ ## 输出格式 章节</li>
                        </ul>
                      </div>
                      
                      {/* 推荐章节 */}
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
                      
                      {/* 关键原则 */}
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
                  className={`text-lg font-semibold flex items-center gap-1 ${(vulnStats.falsePositive || 0) > 0 ? 'text-orange-600 hover:text-orange-800 hover:underline' : 'text-gray-400'}`}
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
                        className={`px-2 py-1 text-xs rounded ${vulnFilter === 'false-positive' ? 'bg-orange-100 text-orange-700' : 'bg-dark-surface-hover text-gray-400 hover:bg-gray-200'}`}
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
                                  item.vulnerability?.severity === 'high' ? 'bg-orange-100 text-orange-700' :
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
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm bg-purple-900/20 text-purple-700 rounded-md">
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
                  <p className="text-gray-100">
                    <div className="flex items-center gap-1">
                      {skill.languageName && (
                        <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-400 rounded">
                          {skill.languageName}
                        </span>
                      )}
                      {skill.patternName && (
                        <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">
                          {skill.patternName}
                        </span>
                      )}
                      {!skill.languageName && !skill.patternName && <span>无</span>}
                    </div>
                  </p>
                </div>
              )}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">适用产品</h3>
                <p className="text-gray-100">
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
                </p>
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
                <ReactMarkdown
                  components={{
                    code: ({ node, inline, className, children, ...props }: any) => {
                      if (inline) {
                        return (
                          <code className="px-1.5 py-0.5 rounded bg-dark-surface-hover text-blue-400 font-mono text-sm" {...props}>
                            {children}
                          </code>
                        );
                      }
                      return (
                        <code className="block px-4 py-3 rounded-lg bg-gray-900 text-gray-100 font-mono text-sm overflow-x-auto" {...props}>
                          {children}
                        </code>
                      );
                    },
                    pre: ({ node, children, ...props }: any) => (
                      <pre className="px-4 py-3 rounded-lg bg-gray-900 text-gray-100 font-mono text-sm overflow-x-auto" {...props}>
                        {children}
                      </pre>
                    ),
                    h1: ({ children, ...props }: any) => (
                      <h1 className="text-2xl font-bold text-gray-100 mt-6 mb-4 pb-2 border-b border-gray-700/50" {...props}>
                        {children}
                      </h1>
                    ),
                    h2: ({ children, ...props }: any) => (
                      <h2 className="text-xl font-semibold text-gray-100 mt-5 mb-3 pb-2 border-b border-gray-700/50" {...props}>
                        {children}
                      </h2>
                    ),
                    h3: ({ children, ...props }: any) => (
                      <h3 className="text-lg font-semibold text-gray-100 mt-4 mb-2" {...props}>
                        {children}
                      </h3>
                    ),
                    h4: ({ children, ...props }: any) => (
                      <h4 className="text-base font-semibold text-gray-100 mt-3 mb-2" {...props}>
                        {children}
                      </h4>
                    ),
                    ul: ({ children, ...props }: any) => (
                      <ul className="mt-4 space-y-2 list-disc list-inside marker:text-blue-400" {...props}>
                        {children}
                      </ul>
                    ),
                    ol: ({ children, ...props }: any) => (
                      <ol className="mt-4 space-y-2 list-decimal list-inside" {...props}>
                        {children}
                      </ol>
                    ),
                    li: ({ children, ...props }: any) => (
                      <li className="text-gray-300 ml-6" {...props}>
                        {children}
                      </li>
                    ),
                    blockquote: ({ children, ...props }: any) => (
                      <blockquote className="border-l-4 border-blue-500 pl-4 italic my-4 text-gray-400" {...props}>
                        {children}
                      </blockquote>
                    ),
                    table: ({ children, ...props }: any) => (
                      <div className="my-6 overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-700/50 border border-gray-600" {...props}>
                          {children}
                        </table>
                      </div>
                    ),
                    thead: ({ children, ...props }: any) => (
                      <thead className="bg-[#0F172A]" {...props}>{children}</thead>
                    ),
                    tbody: ({ children, ...props }: any) => (
                      <tbody className="divide-y divide-gray-700/50" {...props}>{children}</tbody>
                    ),
                    tr: ({ children, ...props }: any) => (
                      <tr className="hover:bg-dark-surface-hover" {...props}>{children}</tr>
                    ),
                    th: ({ children, ...props }: any) => (
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" {...props}>
                        {children}
                      </th>
                    ),
                    td: ({ children, ...props }: any) => (
                      <td className="px-4 py-2 text-sm text-gray-300" {...props}>
                        {children}
                      </td>
                    ),
                    a: ({ children, href, ...props }: any) => (
                      <a href={href} className="text-blue-400 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer" {...props}>
                        {children}
                      </a>
                    ),
                    strong: ({ children, ...props }: any) => (
                      <strong className="font-semibold text-gray-100" {...props}>{children}</strong>
                    ),
                    del: ({ children, ...props }: any) => (
                      <del className="text-red-400 line-through" {...props}>{children}</del>
                    ),
                    p: ({ children, ...props }: any) => (
                      <p className="text-gray-300 leading-relaxed mb-3" {...props}>{children}</p>
                    ),
                    hr: ({ ...props }: any) => (
                      <hr className="my-4 border-gray-700/50" {...props} />
                    ),
                  }}
                >
                  {skillOutputTemplate && skillOutputTemplate.trim()
                    ? (skill.content || '') + '\n\n' + skillOutputTemplate
                    : (skill.content || '暂无内容')}
                </ReactMarkdown>
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
                <History size={18} className="text-indigo-600" />
                <div>
                  <span className="text-sm font-medium text-indigo-800">
                    正在查看历史版本 v{viewingVersionNumber}
                  </span>
                  <span className="text-xs text-indigo-600 ml-2">
                    (当前版本: v{skill.version})
                  </span>
                </div>
              </div>
              <button
                onClick={handleCloseVersionView}
                className="px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors"
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
            <ReactMarkdown>{viewingVersionContent || '暂无内容'}</ReactMarkdown>
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
          if (type === 'removed') return 'bg-red-900/20';
          if (type === 'added') return 'bg-green-900/20';
          if (type === 'empty') return side === 'left' ? 'bg-green-900/20/40' : 'bg-red-900/20/40';
          return '';
        };
        const textColor = (type: DiffRow['type']) => {
          if (type === 'removed') return 'text-red-400';
          if (type === 'added') return 'text-green-400';
          if (type === 'empty') return 'text-transparent select-none';
          return 'text-gray-300';
        };
        const lineNoBg = (type: DiffRow['type']) => {
          if (type === 'removed') return 'bg-red-100 text-red-400';
          if (type === 'added') return 'bg-green-100 text-green-500';
          if (type === 'empty') return 'bg-dark-bg text-transparent';
          return 'bg-dark-bg text-gray-300';
        };
        const marker = (type: DiffRow['type']) => {
          if (type === 'removed') return <span className="text-red-400 select-none mr-1">−</span>;
          if (type === 'added') return <span className="text-green-500 select-none mr-1">+</span>;
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-dark-surface rounded-2xl shadow-2xl w-full max-w-7xl max-h-[92vh] flex flex-col">

              {/* 弹窗头部 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                    <Sparkles size={16} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-100">AI 优化内容对比</h2>
                    <p className="text-xs text-gray-500">
                      共 <span className="font-medium text-orange-500">{changedCount}</span> 处变更 &nbsp;·&nbsp;
                      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-100 border border-red-300 inline-block"/>删除</span> &nbsp;
                      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-100 border border-green-300 inline-block"/>新增</span>
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowDiffModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-400 hover:bg-dark-surface-hover rounded-lg transition-colors">
                  <X size={20} />
                </button>
              </div>

              {/* AI 优化建议 */}
              {aiSuggestions.length > 0 && (
                <div className="px-6 py-2.5 bg-purple-900/20 border-b border-purple-100 flex-shrink-0">
                  <span className="text-xs font-medium text-purple-700">AI 优化说明：</span>
                  <span className="text-xs text-purple-600 ml-2">{aiSuggestions.join('；')}</span>
                </div>
              )}

              {/* 列标题 */}
              <div className="flex divide-x divide-gray-700/50 flex-shrink-0 border-b border-gray-700/50">
                <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-[#0F172A]">
                  <span className="w-2 h-2 rounded-full bg-red-400"/>
                  <span className="text-sm font-medium text-gray-400">原始内容（你编辑的）</span>
                </div>
                <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-purple-900/20">
                  <span className="w-2 h-2 rounded-full bg-purple-600"/>
                  <span className="text-sm font-medium text-purple-700">AI 优化后的内容</span>
                </div>
              </div>

              {/* diff 主体 — 同步滚动 */}
              <div className="flex-1 flex divide-x divide-gray-700/50 min-h-0 overflow-hidden">
                {/* 左侧 */}
                <div ref={leftRef} onScroll={onLeftScroll}
                  className="flex-1 overflow-auto font-mono text-xs leading-5">
                  {leftDiff.map((row, idx) => (
                    <div key={idx} className={`flex min-w-0 ${rowBg(row.type, 'left')}`}>
                      <span className={`w-10 shrink-0 text-right pr-2 py-0.5 select-none text-[10px] border-r border-gray-100 ${lineNoBg(row.type)}`}>
                        {row.lineNo ?? ''}
                      </span>
                      <span className={`w-4 shrink-0 flex items-center justify-center py-0.5`}>
                        {marker(row.type)}
                      </span>
                      <span className={`flex-1 py-0.5 pr-4 whitespace-pre ${textColor(row.type)}`}>
                        {row.type === 'empty' ? '\u00a0' : row.text}
                      </span>
                    </div>
                  ))}
                </div>

                {/* 右侧 */}
                <div ref={rightRef} onScroll={onRightScroll}
                  className="flex-1 overflow-auto font-mono text-xs leading-5">
                  {rightDiff.map((row, idx) => (
                    <div key={idx} className={`flex min-w-0 ${rowBg(row.type, 'right')}`}>
                      <span className={`w-10 shrink-0 text-right pr-2 py-0.5 select-none text-[10px] border-r border-gray-100 ${lineNoBg(row.type)}`}>
                        {row.lineNo ?? ''}
                      </span>
                      <span className={`w-4 shrink-0 flex items-center justify-center py-0.5`}>
                        {marker(row.type)}
                      </span>
                      <span className={`flex-1 py-0.5 pr-4 whitespace-pre ${textColor(row.type)}`}>
                        {row.type === 'empty' ? '\u00a0' : row.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 底部操作 */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700/50 flex-shrink-0 bg-dark-bg rounded-b-2xl">
                <button
                  onClick={() => { setShowDiffModal(false); }}
                  className="px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded-lg hover:bg-dark-surface-hover transition-colors"
                >
                  放弃，保留原始内容
                </button>
                <button
                  onClick={() => { setEditContent(aiDiffContent); setShowDiffModal(false); setAiDiffContent(''); }}
                  className="inline-flex items-center px-5 py-2 text-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all shadow-sm"
                >
                  <CheckCircle size={15} className="mr-1.5" />
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
