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
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/permissions';
import { getCategories, Category } from '@/lib/categories';
import { exportAsSkillFile, copySkillMdToClipboard } from '@/lib/skill-export';
import { useTechStackOptions } from '@/hooks/useTechStackOptions';
import { useVulnerabilityPatterns, VulnerabilityPattern } from '@/hooks/useVulnerabilityPatterns';
import { buildFullSkill, getFormatGuideData, cleanSkillContentForOptimization, type SkillIntent } from '@/lib/skill-builder';
import { SkillVersionHistory } from '@/components/skills/SkillVersionHistory';
import { SkillVersionDiffModal } from '@/components/skills/SkillVersionDiffModal';
import { SkillRollbackModal } from '@/components/skills/SkillRollbackModal';
import toast from 'react-hot-toast';

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  techStack: string | null;
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
  vulnerabilityCount: number;  // 发现问题数
  successExecCount: number;    // 有发现问题的执行次数
  createdAt: string;
  updatedAt: string;
  userId: string | null;  // 创建者ID
  isPublic: boolean;  // 是否公开分享
  vulnerabilityPatternId: string | null;  // 漏洞模式 ID
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
  const [editCategory, setEditCategory] = useState('');
  const [editTechStack, setEditTechStack] = useState<string[]>([]);
  const [editContent, setEditContent] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editVulnerabilityPatternId, setEditVulnerabilityPatternId] = useState<string>('');
  const [vulnerabilitySearch, setVulnerabilitySearch] = useState('');
  const [showVulnerabilityDropdown, setShowVulnerabilityDropdown] = useState(false);
  const vulnerabilityDropdownRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<Category[]>([]);
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
  
  // 获取漏洞列表
  const fetchVulnerabilities = async (page: number = 1) => {
    if (!skillId) return;
    setVulnLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}/vulnerabilities?page=${page}&limit=10`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setVulnerabilities(data.vulnerabilities || []);
        setVulnTotal(data.pagination?.total || 0);
        setVulnTotalPages(data.pagination?.totalPages || 0);
        setVulnPage(page);
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

  // 技术栈选择相关
  const [techStackSearch, setTechStackSearch] = useState('');
  const [showTechStackDropdown, setShowTechStackDropdown] = useState(false);
  
  // 使用 Hook 获取技术栈选项
  const { options: techStackOptions, loading: loadingTechStack } = useTechStackOptions();
  
  // 使用 Hook 获取漏洞模式
  const { patterns: vulnerabilityPatterns, groupedPatterns, loading: loadingVulnerabilityPatterns } = useVulnerabilityPatterns();
  
  // 获取选中的漏洞模式对象
  const selectedVulnerabilityPattern = vulnerabilityPatterns.find(p => p.id === editVulnerabilityPatternId);

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
    // 加载分类
    getCategories().then((cats) => {
      setCategories(cats);
    });
  }, []);

  // 点击外部关闭漏洞模式下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (vulnerabilityDropdownRef.current && !vulnerabilityDropdownRef.current.contains(event.target as Node)) {
        setShowVulnerabilityDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
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

  const startEditing = () => {
    if (!skill) return;
    setEditName(skill.displayName);
    setEditCategory(skill.category);
    setEditVulnerabilityPatternId(skill.vulnerabilityPatternId || '');
    // 解析技术栈 JSON
    try {
      setEditTechStack(skill.techStack ? JSON.parse(skill.techStack) : []);
    } catch {
      setEditTechStack([]);
    }
    setEditContent(skill.content || '');
    setEditIsActive(skill.isActive);
    setIsEditing(true);
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

    if (!editVulnerabilityPatternId) {
      alert('请选择漏洞模式');
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
          category: selectedVulnerabilityPattern?.category || editCategory,
          vulnerabilityPatternId: editVulnerabilityPatternId,
          cwe: selectedVulnerabilityPattern?.cwe || null,
          techStack: editTechStack,
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
        category: skill.category,
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
        category: skill.category,
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
        category: skill.category,
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
        category: skill.category,
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
            category: editCategory || skill.category,
            content: editContent,  // 用户当前完整编辑内容，AI 必须在此基础上优化
            systemPrompt: '',
            userPrompt: '',
            tools: [],
            techStack: editTechStack.length > 0 ? editTechStack : (skill.techStack ? JSON.parse(skill.techStack) : []),
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
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        {error || 'Skill 不存在'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* AI 优化全屏遮罩 */}
      {aiOptimizing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4 max-w-sm w-full mx-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center animate-pulse">
              <Sparkles size={32} className="text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">AI 正在优化 Skill</h3>
            <p className="text-sm text-gray-500 text-center">
              大模型分析中，请勿关闭页面或进行其他操作...
            </p>
            {/* 进度条动画 */}
            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
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
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-gray-900">{skill.displayName}</h1>
              {skill.isBuiltin && (
                <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded-full">
                  内置
                </span>
              )}
              {!skill.isActive && (
                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                  已禁用
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600">{skill.name}</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {/* 导出按钮 */}
          <button
            onClick={handleCopyMd}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {copied ? (
              <>
                <CheckCircle size={16} className="mr-2 text-green-600" />
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
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      取消
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
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        {isEditing ? (
          /* 编辑模式 */
          <div className="space-y-6">
            {/* 基本信息 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Skill 名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              
              {/* 漏洞模式选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  漏洞模式 <span className="text-red-500">*</span>
                </label>
                
                {/* 热门漏洞快捷标签 */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {['SQL注入', 'XSS', '命令注入', '路径遍历', 'SSRF', '越权访问'].map((name) => {
                    const pattern = vulnerabilityPatterns.find(p => 
                      p.displayName === name || p.displayName.includes(name)
                    );
                    if (!pattern) return null;
                    return (
                      <button
                        key={pattern.id}
                        type="button"
                        onClick={() => {
                          setEditVulnerabilityPatternId(pattern.id);
                          setEditCategory(pattern.category);
                          setVulnerabilitySearch('');
                          setShowVulnerabilityDropdown(false);
                        }}
                        className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                          pattern.id === editVulnerabilityPatternId
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300'
                        }`}
                      >
                        {pattern.displayName}
                      </button>
                    );
                  })}
                </div>
                
                <div className="relative" ref={vulnerabilityDropdownRef}>
                  <input
                    type="text"
                    value={vulnerabilitySearch || (selectedVulnerabilityPattern 
                      ? `${selectedVulnerabilityPattern.displayName}${selectedVulnerabilityPattern.cwe ? ` (${selectedVulnerabilityPattern.cwe})` : ''}`
                      : '')}
                    onChange={(e) => {
                      setVulnerabilitySearch(e.target.value);
                      setShowVulnerabilityDropdown(true);
                    }}
                    onFocus={() => setShowVulnerabilityDropdown(true)}
                    placeholder={loadingVulnerabilityPatterns ? "加载中..." : "搜索并选择漏洞模式..."}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={loadingVulnerabilityPatterns}
                  />
                  {showVulnerabilityDropdown && !loadingVulnerabilityPatterns && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {/* 搜索提示 */}
                      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                        输入关键词搜索，如 "SQL"、"XSS"、"注入" 等
                      </div>
                      {Object.entries(groupedPatterns).map(([category, patterns]) => {
                        const filtered = patterns.filter((p) => 
                          p.displayName.toLowerCase().includes(vulnerabilitySearch.toLowerCase()) ||
                          (p.cwe && p.cwe.toLowerCase().includes(vulnerabilitySearch.toLowerCase())) ||
                          p.name.toLowerCase().includes(vulnerabilitySearch.toLowerCase())
                        );
                        if (filtered.length === 0) return null;
                        return (
                          <div key={category}>
                            <div className="px-4 py-1.5 bg-gray-100 text-xs font-semibold text-gray-600 uppercase sticky top-0">
                              {category}
                            </div>
                            {filtered.slice(0, 15).map((pattern) => (
                              <button
                                key={pattern.id}
                                type="button"
                                onClick={() => {
                                  setEditVulnerabilityPatternId(pattern.id);
                                  setEditCategory(pattern.category);
                                  setVulnerabilitySearch('');
                                  setShowVulnerabilityDropdown(false);
                                }}
                                className={`w-full px-4 py-2 text-left hover:bg-gray-100 text-sm ${
                                  pattern.id === editVulnerabilityPatternId ? 'bg-blue-50 text-blue-700' : ''
                                }`}
                              >
                                {pattern.displayName}
                                {pattern.cwe && <span className="text-gray-400 ml-2">({pattern.cwe})</span>}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                      {Object.values(groupedPatterns).every(
                        (patterns) => !patterns.some((p) => 
                          p.displayName.toLowerCase().includes(vulnerabilitySearch.toLowerCase()) ||
                          (p.cwe && p.cwe.toLowerCase().includes(vulnerabilitySearch.toLowerCase()))
                        )
                      ) && (
                        <div className="px-4 py-2 text-sm text-gray-500">
                          无匹配选项
                        </div>
                      )}
                    </div>
                  )}
                  {loadingVulnerabilityPatterns && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3">
                      <div className="flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        <span className="text-sm text-gray-500">加载中...</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 技术栈选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  适合的技术栈
                </label>
                <div className="relative">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {editTechStack.map((ts) => (
                      <span
                        key={ts}
                        className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                      >
                        {ts}
                        <button
                          type="button"
                          onClick={() => setEditTechStack(editTechStack.filter((t) => t !== ts))}
                          className="ml-2 text-blue-600 hover:text-blue-800"
                        >
                          <X size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={techStackSearch}
                      onChange={(e) => {
                        setTechStackSearch(e.target.value);
                        setShowTechStackDropdown(true);
                      }}
                      onFocus={() => setShowTechStackDropdown(true)}
                      placeholder={loadingTechStack ? "加载中..." : "搜索并选择技术栈..."}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={loadingTechStack}
                    />
                    {showTechStackDropdown && !loadingTechStack && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {techStackOptions
                          .filter((option) => 
                            option.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                            !editTechStack.includes(option)
                          )
                          .slice(0, 20)
                          .map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setEditTechStack([...editTechStack, option]);
                                setTechStackSearch('');
                                setShowTechStackDropdown(false);
                              }}
                              className="w-full px-4 py-2 text-left hover:bg-gray-100 text-sm"
                            >
                              {option}
                            </button>
                          ))}
                        {techStackOptions.filter((option) => 
                          option.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                          !editTechStack.includes(option)
                        ).length === 0 && (
                          <div className="px-4 py-2 text-sm text-gray-500">
                            无匹配选项
                          </div>
                        )}
                      </div>
                    )}
                    {loadingTechStack && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3">
                        <div className="flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          <span className="text-sm text-gray-500">加载中...</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Markdown 内容 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
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
                      className="inline-flex items-center px-3 py-1.5 text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-all"
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
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    重置为原始内容
                  </button>
                </div>
              </div>

              {/* AI 优化错误提示 */}
              {aiOptimizeError && (
                <div className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{aiOptimizeError}</span>
                </div>
              )}

              {/* AI 优化建议 */}
              {aiSuggestions.length > 0 && (
                <div className="mb-3 bg-purple-50 border border-purple-200 rounded-lg overflow-hidden">
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

              <div className="mb-3 border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowFormatHint(!showFormatHint)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-sm text-gray-600"
                >
                  <span className="flex items-center gap-1.5">
                    <FileText size={14} />
                    缺陷发现 Skill 格式建议
                  </span>
                  {showFormatHint ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showFormatHint && (
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                    {/* 新格式建议 */}
                    <div className="space-y-4">
                      {/* 禁止生成提醒 */}
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <p className="text-xs font-semibold text-red-700 mb-2">⛔ 禁止生成（系统会自动添加）</p>
                        <ul className="text-xs text-red-600 space-y-1">
                          <li>❌ YAML frontmatter（--- name: xxx ---）</li>
                          <li>❌ 一级标题（# 漏洞名称）</li>
                          <li>❌ ## 输出格式 章节</li>
                        </ul>
                      </div>
                      
                      {/* 推荐章节 */}
                      <div>
                        <p className="text-xs font-semibold text-gray-700 mb-2">必须包含的章节：</p>
                        <div className="text-xs text-gray-600 font-mono space-y-1">
                          {getFormatGuideData().sections.map((section, idx) => (
                            <p key={idx} className={section.highlight ? 'text-blue-600 font-medium' : ''}>
                              {section.name}
                            </p>
                          ))}
                        </div>
                      </div>
                      
                      {/* 关键原则 */}
                      <div>
                        <p className="text-xs font-semibold text-gray-700 mb-2">关键原则：</p>
                        <ul className="text-xs text-gray-600 space-y-1">
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
                className="w-full h-[500px] px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
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
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">启用此 Skill</span>
              </label>
            </div>
          </div>
        ) : (
          /* 查看模式 */
          <div className="space-y-6">
            {/* 基本信息 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">分类</h3>
                <p className="text-gray-900">
                  {categories.find(c => c.value === skill.category)?.label || skill.category}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">所属技术栈</h3>
                {skill.techStack ? (() => {
                  try {
                    const techStacks = JSON.parse(skill.techStack);
                    if (techStacks.length > 0) {
                      return (
                        <div className="flex flex-wrap gap-1">
                          {techStacks.map((ts: string) => (
                            <span key={ts} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                              {ts}
                            </span>
                          ))}
                        </div>
                      );
                    }
                  } catch {}
                  return <p className="text-gray-900">无</p>;
                })() : <p className="text-gray-900">无</p>}
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">CWE</h3>
                <p className="text-gray-900">{skill.cwe || '无'}</p>
              </div>
            </div>

            {/* Markdown 内容 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-medium text-gray-900">Skill 内容</h3>
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
                  className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                >
                  <Copy size={14} className="mr-1" />
                  复制 Markdown
                </button>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg overflow-x-auto text-sm prose prose-sm max-w-none">
                <ReactMarkdown
                  components={{
                    code: ({ node, inline, className, children, ...props }: any) => {
                      if (inline) {
                        return (
                          <code className="px-1.5 py-0.5 rounded bg-gray-100 text-blue-600 font-mono text-sm" {...props}>
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
                      <h1 className="text-2xl font-bold text-gray-900 mt-6 mb-4 pb-2 border-b border-gray-200" {...props}>
                        {children}
                      </h1>
                    ),
                    h2: ({ children, ...props }: any) => (
                      <h2 className="text-xl font-semibold text-gray-900 mt-5 mb-3 pb-2 border-b border-gray-200" {...props}>
                        {children}
                      </h2>
                    ),
                    h3: ({ children, ...props }: any) => (
                      <h3 className="text-lg font-semibold text-gray-900 mt-4 mb-2" {...props}>
                        {children}
                      </h3>
                    ),
                    h4: ({ children, ...props }: any) => (
                      <h4 className="text-base font-semibold text-gray-900 mt-3 mb-2" {...props}>
                        {children}
                      </h4>
                    ),
                    ul: ({ children, ...props }: any) => (
                      <ul className="mt-4 space-y-2 list-disc list-inside marker:text-blue-600" {...props}>
                        {children}
                      </ul>
                    ),
                    ol: ({ children, ...props }: any) => (
                      <ol className="mt-4 space-y-2 list-decimal list-inside" {...props}>
                        {children}
                      </ol>
                    ),
                    li: ({ children, ...props }: any) => (
                      <li className="text-gray-700 ml-6" {...props}>
                        {children}
                      </li>
                    ),
                    blockquote: ({ children, ...props }: any) => (
                      <blockquote className="border-l-4 border-blue-500 pl-4 italic my-4 text-gray-600" {...props}>
                        {children}
                      </blockquote>
                    ),
                    table: ({ children, ...props }: any) => (
                      <div className="my-6 overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 border border-gray-300" {...props}>
                          {children}
                        </table>
                      </div>
                    ),
                    thead: ({ children, ...props }: any) => (
                      <thead className="bg-gray-50" {...props}>{children}</thead>
                    ),
                    tbody: ({ children, ...props }: any) => (
                      <tbody className="divide-y divide-gray-200" {...props}>{children}</tbody>
                    ),
                    tr: ({ children, ...props }: any) => (
                      <tr className="hover:bg-gray-50" {...props}>{children}</tr>
                    ),
                    th: ({ children, ...props }: any) => (
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" {...props}>
                        {children}
                      </th>
                    ),
                    td: ({ children, ...props }: any) => (
                      <td className="px-4 py-2 text-sm text-gray-700" {...props}>
                        {children}
                      </td>
                    ),
                    a: ({ children, href, ...props }: any) => (
                      <a href={href} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer" {...props}>
                        {children}
                      </a>
                    ),
                    strong: ({ children, ...props }: any) => (
                      <strong className="font-semibold text-gray-900" {...props}>{children}</strong>
                    ),
                    del: ({ children, ...props }: any) => (
                      <del className="text-red-600 line-through" {...props}>{children}</del>
                    ),
                    p: ({ children, ...props }: any) => (
                      <p className="text-gray-700 leading-relaxed mb-3" {...props}>{children}</p>
                    ),
                    hr: ({ ...props }: any) => (
                      <hr className="my-4 border-gray-200" {...props} />
                    ),
                  }}
                >
                  {skillOutputTemplate && skillOutputTemplate.trim()
                    ? (skill.content || '') + '\n\n' + skillOutputTemplate
                    : (skill.content || '暂无内容')}
                </ReactMarkdown>
              </div>
            </div>

            {/* 元信息 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">版本</h3>
                <p className="text-gray-900">v{skill.version}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">执行次数</h3>
                <p className="text-gray-900">{skill.execCount}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">发现问题</h3>
                <button
                  onClick={() => {
                    setShowVulnerabilities(!showVulnerabilities);
                    if (!showVulnerabilities && vulnerabilities.length === 0) {
                      fetchVulnerabilities(1);
                    }
                  }}
                  className="text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                >
                  {skill.vulnerabilityCount || 0} 个
                  {showVulnerabilities ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">成功率</h3>
                <p className="text-gray-900">
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
              <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-gray-900">发现的漏洞明细</h4>
                  <span className="text-sm text-gray-500">共 {vulnTotal} 条</span>
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
                        <div key={item.mappingId || index} className="p-3 bg-white rounded border border-gray-100 hover:border-gray-200">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  item.vulnerability?.severity === 'critical' ? 'bg-red-100 text-red-700' :
                                  item.vulnerability?.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                                  item.vulnerability?.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                  item.vulnerability?.severity === 'low' ? 'bg-blue-100 text-blue-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {item.vulnerability?.severity || 'info'}
                                </span>
                                <span className="font-medium text-gray-900">{item.vulnerability?.title || '未命名漏洞'}</span>
                              </div>
                              <div className="mt-1 text-sm text-gray-600">
                                {item.vulnerability?.type && <span className="mr-2">类型: {item.vulnerability.type}</span>}
                                {item.vulnerability?.filePath && <span className="mr-2">文件: {item.vulnerability.filePath}</span>}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                发现时间: {new Date(item.matchedAt).toLocaleString()}
                                {item.evaluation?.project && <span className="ml-2">项目: {item.evaluation.project.name}</span>}
                              </div>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              item.matchType === 'exact' ? 'bg-green-50 text-green-600' :
                              item.matchType === 'fuzzy' ? 'bg-yellow-50 text-yellow-600' :
                              'bg-gray-50 text-gray-600'
                            }`}>
                              {item.matchType === 'exact' ? '精确匹配' : item.matchType === 'fuzzy' ? '模糊匹配' : '未匹配'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* 分页 */}
                    {vulnTotalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 mt-4">
                        <button
                          onClick={() => fetchVulnerabilities(vulnPage - 1)}
                          disabled={vulnPage === 1}
                          className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                        >
                          上一页
                        </button>
                        <span className="text-sm text-gray-600">{vulnPage} / {vulnTotalPages}</span>
                        <button
                          onClick={() => fetchVulnerabilities(vulnPage + 1)}
                          disabled={vulnPage === vulnTotalPages}
                          className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                        >
                          下一页
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== 版本管理区域 ===== */}
      {!isEditing && skill && (
        <>
          {/* 版本查看提示条 */}
          {viewingVersionId && viewingVersionId !== skill.id && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 flex items-center justify-between">
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
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">
              v{viewingVersionNumber} 版本内容
            </h3>
            <button
              onClick={() => {
                if (viewingVersionContent) {
                  navigator.clipboard.writeText(viewingVersionContent);
                  toast.success('已复制版本内容');
                }
              }}
              className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
            >
              <Copy size={14} className="mr-1" />
              复制内容
            </button>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg overflow-x-auto text-sm prose prose-sm max-w-none">
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
          if (type === 'removed') return 'bg-red-50';
          if (type === 'added') return 'bg-green-50';
          if (type === 'empty') return side === 'left' ? 'bg-green-50/40' : 'bg-red-50/40';
          return '';
        };
        const textColor = (type: DiffRow['type']) => {
          if (type === 'removed') return 'text-red-700';
          if (type === 'added') return 'text-green-700';
          if (type === 'empty') return 'text-transparent select-none';
          return 'text-gray-700';
        };
        const lineNoBg = (type: DiffRow['type']) => {
          if (type === 'removed') return 'bg-red-100 text-red-400';
          if (type === 'added') return 'bg-green-100 text-green-500';
          if (type === 'empty') return 'bg-gray-50 text-transparent';
          return 'bg-gray-50 text-gray-300';
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
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[92vh] flex flex-col">

              {/* 弹窗头部 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                    <Sparkles size={16} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">AI 优化内容对比</h2>
                    <p className="text-xs text-gray-500">
                      共 <span className="font-medium text-orange-500">{changedCount}</span> 处变更 &nbsp;·&nbsp;
                      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-100 border border-red-300 inline-block"/>删除</span> &nbsp;
                      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-100 border border-green-300 inline-block"/>新增</span>
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowDiffModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <X size={20} />
                </button>
              </div>

              {/* AI 优化建议 */}
              {aiSuggestions.length > 0 && (
                <div className="px-6 py-2.5 bg-purple-50 border-b border-purple-100 flex-shrink-0">
                  <span className="text-xs font-medium text-purple-700">AI 优化说明：</span>
                  <span className="text-xs text-purple-600 ml-2">{aiSuggestions.join('；')}</span>
                </div>
              )}

              {/* 列标题 */}
              <div className="flex divide-x divide-gray-200 flex-shrink-0 border-b border-gray-200">
                <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-gray-50">
                  <span className="w-2 h-2 rounded-full bg-red-400"/>
                  <span className="text-sm font-medium text-gray-600">原始内容（你编辑的）</span>
                </div>
                <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-purple-50">
                  <span className="w-2 h-2 rounded-full bg-purple-500"/>
                  <span className="text-sm font-medium text-purple-700">AI 优化后的内容</span>
                </div>
              </div>

              {/* diff 主体 — 同步滚动 */}
              <div className="flex-1 flex divide-x divide-gray-200 min-h-0 overflow-hidden">
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
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 flex-shrink-0 bg-gray-50 rounded-b-2xl">
                <button
                  onClick={() => { setShowDiffModal(false); }}
                  className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
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
