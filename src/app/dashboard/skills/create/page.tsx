'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  X,
  Loader2,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eye,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/permissions';
import { getCategories, Category } from '@/lib/categories';
import { useTechStackOptions } from '@/hooks/useTechStackOptions';

const DEFAULT_TEMPLATE = `# Skill 名称

## 描述
简要描述这个 Skill 的作用和检测目标...

## CWE 编号
（可选，如 CWE-89）

## 系统提示词
你是一个专业的安全代码审计专家...

## 用户提示词
请分析以下代码...

## 工具
- read_file
- search_pattern
`;

export default function CreateSkillPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState(DEFAULT_TEMPLATE);
  const [isPublic, setIsPublic] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [techStack, setTechStack] = useState<string[]>([]);
  const [techStackSearch, setTechStackSearch] = useState('');
  const [showTechStackDropdown, setShowTechStackDropdown] = useState(false);

  // AI 生成相关状态
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenerateError, setAiGenerateError] = useState('');
  const [aiGenerateSuccess, setAiGenerateSuccess] = useState(false);
  const [aiDiffContent, setAiDiffContent] = useState('');   // AI 生成的内容（待对比）
  const [showDiffModal, setShowDiffModal] = useState(false); // 对比弹窗
  const [aiCountdown, setAiCountdown] = useState(0);
  const aiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showFormatHint, setShowFormatHint] = useState(true); // 格式建议默认展开

  const clearAiTimers = () => {
    if (aiTimeoutRef.current) { clearTimeout(aiTimeoutRef.current); aiTimeoutRef.current = null; }
    if (aiCountdownRef.current) { clearInterval(aiCountdownRef.current); aiCountdownRef.current = null; }
  };

  const unlockAi = (reason?: 'timeout') => {
    clearAiTimers();
    setAiGenerating(false);
    setAiCountdown(0);
    if (reason === 'timeout') {
      setAiGenerateError('AI 生成超时（5 分钟），界面已自动解锁，请稍后重试。');
    }
  };

  // 使用 Hook 获取技术栈选项
  const { options: techStackOptions, loading: loadingTechStack } = useTechStackOptions();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE));
      } catch (error) {
        console.error('解析 token 失败:', error);
      }
    }
  }, []);

  useEffect(() => {
    // 加载分类
    getCategories().then((cats) => {
      setCategories(cats);
      if (cats.length > 0 && !category) {
        setCategory(cats[0].value);
      }
    });
  }, [category]);

  // AI 生成 Skill 内容
  const handleAiGenerate = async () => {
    if (!name.trim()) {
      setAiGenerateError('请先填写 Skill 名称，AI 将根据名称和分类生成内容');
      return;
    }

    setAiGenerating(true);
    setAiGenerateError('');
    setAiGenerateSuccess(false);

    // 启动 5 分钟超时自动解锁
    const TIMEOUT_MS = 5 * 60 * 1000;
    setAiCountdown(TIMEOUT_MS / 1000);
    clearAiTimers();

    // 每秒倒计时
    aiCountdownRef.current = setInterval(() => {
      setAiCountdown((prev) => {
        if (prev <= 1) { clearAiTimers(); return 0; }
        return prev - 1;
      });
    }, 1000);

    // 5 分钟强制解锁
    aiTimeoutRef.current = setTimeout(() => {
      unlockAi('timeout');
    }, TIMEOUT_MS);

try {
        const token = localStorage.getItem('token');
        console.log('[Quick Create] 发送 AI 生成请求');
        const response = await fetch('/api/skills/generate', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            intent: {
              name: name.trim(),
              description: name.trim(),
              category: category || 'code-audit',
              whatDoesItDo: `检测 ${name.trim()} 相关的安全漏洞`,
              whenShouldItTrigger: `当用户要求审计${name.trim()}时触发`,
              expectedOutput: '详细的漏洞分析报告，包含漏洞位置、成因和修复建议',
            },
          }),
        });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'AI 生成失败');
      }

      if (data.skill?.content) {
        setAiDiffContent(data.skill.content);
        setShowDiffModal(true);
      }
      if (data.skill?.displayName && !name.trim()) {
        setName(data.skill.displayName);
      }
      setAiGenerateSuccess(true);
      setTimeout(() => setAiGenerateSuccess(false), 3000);
    } catch (err) {
      setAiGenerateError(err instanceof Error ? err.message : 'AI 生成失败，请重试');
    } finally {
      unlockAi();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('请输入 Skill 名称');
      return;
    }

    if (!content.trim()) {
      setError('请输入 Skill 内容');
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
          name: name.trim(),
          displayName: name.trim(),
          description: name.trim(),
          category,
          techStack,
          content,
          cwe: null,
          isPublic,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '创建失败');
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
      {/* AI 生成全屏遮罩 */}
      {aiGenerating && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4 max-w-sm w-full mx-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center animate-pulse">
              <Sparkles size={32} className="text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">AI 正在生成 Skill</h3>
            <p className="text-sm text-gray-500 text-center">
              大模型内容生成中，请勿关闭页面或进行其他操作...
            </p>
            {/* 进度条 */}
            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full"
                style={{ width: `${Math.max(5, 100 - (aiCountdown / 300) * 100)}%`, transition: 'width 1s linear' }}
              />
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
            <h1 className="text-2xl font-bold text-gray-900">创建新 Skill</h1>
            <p className="text-sm text-gray-600">定义一个新的 AI 漏洞检测技能</p>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-6">
          {/* 基本信息 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Skill 名称 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Skill 名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：SQL注入检测"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            {/* 漏洞分类 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                漏洞分类 <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 技术栈 */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                适合的技术栈
              </label>
              <div className="relative">
                <div className="flex flex-wrap gap-2 mb-2">
                  {techStack.map((ts) => (
                    <span
                      key={ts}
                      className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                    >
                      {ts}
                      <button
                        type="button"
                        onClick={() => setTechStack(techStack.filter((t) => t !== ts))}
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
                          !techStack.includes(option)
                        )
                        .slice(0, 20)
                        .map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setTechStack([...techStack, option]);
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
                        !techStack.includes(option)
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
                <p className="text-xs text-gray-500 mt-1">
                  可选择多个技术栈，表示此Skill适用于这些技术
                </p>
              </div>
            </div>
          </div>

          {/* 是否公开 */}
          {isAdmin && (
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">
                  公开 Skill（所有用户可见）
                </span>
              </label>
            </div>
          )}

          {/* Markdown 内容 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Skill 内容（Markdown 格式）<span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAiGenerate}
                  disabled={aiGenerating}
                  className="inline-flex items-center px-3 py-1.5 text-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  title="根据填写的名称和分类，使用大模型 AI 自动生成完整的 Skill 内容"
                >
                  {aiGenerating ? (
                    <>
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                      AI 生成中...
                    </>
                  ) : aiGenerateSuccess ? (
                    <>
                      <CheckCircle size={14} className="mr-1.5" />
                      生成成功！
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} className="mr-1.5" />
                      AI 生成内容
                    </>
                  )}
                </button>
                {/* 有缓存的 AI 结果时，显示重新查看对比按钮 */}
                {aiDiffContent && !aiGenerating && (
                  <button
                    type="button"
                    onClick={() => setShowDiffModal(true)}
                    className="inline-flex items-center px-3 py-1.5 text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-all"
                    title="重新打开上次 AI 生成结果的对比弹窗"
                  >
                    <Eye size={14} className="mr-1.5" />
                    查看上次对比
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setContent(DEFAULT_TEMPLATE)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  重置模板
                </button>
              </div>
            </div>

            {/* AI 生成错误提示 */}
            {aiGenerateError && (
              <div className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{aiGenerateError}</span>
              </div>
            )}

            {/* AI 生成提示 */}
            {aiGenerateSuccess && (
              <div className="mb-3 flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
                <CheckCircle size={16} className="flex-shrink-0" />
                <span>AI 已根据 Skill 名称和分类生成内容，你可以在下方编辑器中继续修改完善。</span>
              </div>
            )}

            <div className="mb-3 border border-gray-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFormatHint(!showFormatHint)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-sm text-gray-600"
              >
                <span>格式建议</span>
                {showFormatHint ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showFormatHint && (
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                  <div className="text-xs text-gray-500 font-mono space-y-1">
                    <p># Skill 名称</p>
                    <p>## 描述</p>
                    <p>## CWE 编号</p>
                    <p>## 系统提示词</p>
                    <p>## 用户提示词</p>
                    <p>## 工具 (使用 - 列表)</p>
                  </div>
                </div>
              )}
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-[500px] px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              placeholder="输入 Markdown 格式的 Skill 定义，或点击上方「AI 生成内容」按钮自动生成..."
              required
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
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

      {/* AI 生成内容对比弹窗 */}
      {showDiffModal && (() => {
        const leftLines = content.split('\n');
        const rightLines = aiDiffContent.split('\n');

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

              {/* 头部 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                    <Sparkles size={16} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">AI 生成内容对比</h2>
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

              {/* 列标题 */}
              <div className="flex divide-x divide-gray-200 flex-shrink-0 border-b border-gray-200">
                <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-gray-50">
                  <span className="w-2 h-2 rounded-full bg-red-400"/>
                  <span className="text-sm font-medium text-gray-600">当前内容（你填写的）</span>
                </div>
                <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-purple-50">
                  <span className="w-2 h-2 rounded-full bg-purple-500"/>
                  <span className="text-sm font-medium text-purple-700">AI 生成的内容</span>
                </div>
              </div>

              {/* diff 主体 */}
              <div className="flex-1 flex divide-x divide-gray-200 min-h-0 overflow-hidden">
                <div ref={(el) => { (window as any).__diffLeft = el; }}
                  onScroll={onLeftScroll}
                  className="flex-1 overflow-auto font-mono text-xs leading-5">
                  {leftDiff.map((row, idx) => (
                    <div key={idx} className={`flex min-w-0 ${rowBg(row.type, 'left')}`}>
                      <span className={`w-10 shrink-0 text-right pr-2 py-0.5 select-none text-[10px] border-r border-gray-100 ${lineNoBg(row.type)}`}>
                        {row.lineNo ?? ''}
                      </span>
                      <span className="w-4 shrink-0 flex items-center justify-center py-0.5">
                        {marker(row.type)}
                      </span>
                      <span className={`flex-1 py-0.5 pr-4 whitespace-pre ${textColor(row.type)}`}>
                        {row.type === 'empty' ? '\u00a0' : row.text}
                      </span>
                    </div>
                  ))}
                </div>
                <div ref={(el) => { (window as any).__diffRight = el; }}
                  onScroll={onRightScroll}
                  className="flex-1 overflow-auto font-mono text-xs leading-5">
                  {rightDiff.map((row, idx) => (
                    <div key={idx} className={`flex min-w-0 ${rowBg(row.type, 'right')}`}>
                      <span className={`w-10 shrink-0 text-right pr-2 py-0.5 select-none text-[10px] border-r border-gray-100 ${lineNoBg(row.type)}`}>
                        {row.lineNo ?? ''}
                      </span>
                      <span className="w-4 shrink-0 flex items-center justify-center py-0.5">
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
                  onClick={() => setShowDiffModal(false)}
                  className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  放弃，保留当前内容
                </button>
                <button
                  onClick={() => { setContent(aiDiffContent); setShowDiffModal(false); setAiDiffContent(''); }}
                  className="inline-flex items-center px-5 py-2 text-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all shadow-sm"
                >
                  <CheckCircle size={15} className="mr-1.5" />
                  采用 AI 生成内容
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
