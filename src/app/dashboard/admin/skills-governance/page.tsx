'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Award,
  AlertTriangle,
  TrendingUp,
  Clock,
  Activity,
  Layers,
  Sparkles,
  BarChart3,
  ChevronRight,
  RefreshCw,
  Brain,
  Play,
  Loader2,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';

// Types based on API response
interface ObservationStatsSummary {
  totalSkills: number;
  totalObservations: number;
  totalWarnings: number;
  totalMatches: number;
  totalOverlaps: number;
  avgMatchRate: number;
  avgWarningRate: number;
  highRiskSkills: number;
  recentObservations: number;
}

interface TopOverlapSkill {
  skillId: string;
  skillName: string;
  skillDisplayName: string;
  skillCategory: string;
  overlapCount: number;
  warningCount: number;
  riskLevel: string;
}

interface OverlapPair {
  skillId1: string;
  skillName1: string;
  skillId2: string;
  skillName2: string;
  overlapCount: number;
  overlapScore: number;
  overlapType: string;
}

interface PendingItems {
  impactAnalysis: number;
  mergeRecords: number;
  llmAnalysis: number;
  duplicateGroups: number;
}

interface GovernanceOverview {
  stats: ObservationStatsSummary;
  topOverlapSkills: TopOverlapSkill[];
  overlapPairs: OverlapPair[];
  pendingItems: PendingItems;
}

// Tab definitions
const tabs = [
  { id: 'high-frequency', label: '高频重复', icon: TrendingUp },
  { id: 'overlap-groups', label: '重复组', icon: Layers },
  { id: 'new-impact', label: '新增影响', icon: Sparkles },
  { id: 'trends', label: '趋势', icon: BarChart3 },
];

// Risk level color mapping
const riskLevelColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
};

// Overlap type labels
const overlapTypeLabels: Record<string, string> = {
  exact: '完全匹配',
  'semantic-overlap': '语义重叠',
  'techStack-overlap': '技术栈重叠',
  'trigger-overlap': '触发词重叠',
};

export default function SkillsGovernancePage() {
  return (
    <AdminGuard>
      <SkillsGovernanceContent />
    </AdminGuard>
  );
}

function SkillsGovernanceContent() {
  const router = useRouter();
  const [overview, setOverview] = useState<GovernanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('high-frequency');
  const [refreshing, setRefreshing] = useState(false);
  
  // LLM 全量分析状态
  const [analysisPreview, setAnalysisPreview] = useState<{
    totalSkills: number;
    filteredPairs: number;
    estimatedTime: string;
    estimatedCost: string;
    progress?: {
      status: 'idle' | 'running' | 'completed' | 'error';
      startedAt: string | null;
      completedAt: string | null;
      updatedAt: string | null;
      current: number;
      total: number;
      error: string | null;
      results: { duplicates: number; related: number; distinct: number };
    };
  } | null>(null);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);

  // 判断进度是否卡住（超过 30 秒没更新）
  const isProgressStuck = () => {
    if (!analysisPreview?.progress || analysisPreview.progress.status !== 'running') return false;
    if (!analysisPreview.progress.updatedAt) return true; // 没有更新时间，认为卡住了
    const lastUpdate = new Date(analysisPreview.progress.updatedAt);
    const now = new Date();
    const secondsSinceUpdate = (now.getTime() - lastUpdate.getTime()) / 1000;
    return secondsSinceUpdate > 30;
  };

  useEffect(() => {
    fetchOverview();
    fetchAnalysisPreview();
  }, []);

  // 轮询进度
  useEffect(() => {
    if (!analysisRunning) return;
    
    const interval = setInterval(() => {
      fetchAnalysisPreview();
    }, 3000); // 每 3 秒轮询一次
    
    return () => clearInterval(interval);
  }, [analysisRunning]);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/skills-governance', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取观测数据失败');
      }

      const data = await response.json();
      setOverview(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await fetchOverview();
      toast.success('数据已刷新');
    } catch (err) {
      toast.error('刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  const fetchAnalysisPreview = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/skills-governance/full-analysis', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setAnalysisPreview(data.data);
        
        // 如果 API 返回进度状态为 running，更新本地状态
        if (data.data.progress?.status === 'running') {
          setAnalysisRunning(true);
          setAnalysisProgress({
            current: data.data.progress.current,
            total: data.data.progress.total,
          });
        } else if (data.data.progress?.status === 'completed' || data.data.progress?.status === 'error') {
          // 分析完成或出错，停止轮询
          if (analysisRunning) {
            setAnalysisRunning(false);
            if (data.data.progress.status === 'completed') {
              toast.success('分析已完成！');
            } else {
              toast.error(`分析失败: ${data.data.progress.error || '未知错误'}`);
            }
          }
        }
      }
    } catch (err) {
      // 静默失败
    }
  };

  const handleStartFullAnalysis = async () => {
    // 检查是否已有分析在进行
    if (analysisRunning || analysisPreview?.progress?.status === 'running') {
      toast.error('已有分析任务在进行中，请等待完成');
      return;
    }

    if (!confirm(`即将进行全量 LLM 分析，预计分析 ${analysisPreview?.filteredPairs || 0} 对技能。\n\n预估时间: ${analysisPreview?.estimatedTime}\n预估成本: ${analysisPreview?.estimatedCost}\n\n是否继续？`)) {
      return;
    }

    try {
      setAnalysisRunning(true);
      setAnalysisProgress({ current: 0, total: analysisPreview?.filteredPairs || 0 });

      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/skills-governance/full-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode: 'execute',
          limit: 100, // 限制一次最多分析 100 对
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '分析失败');
      }

      const data = await response.json();
      
      toast.success(`分析完成！发现 ${data.data.summary.duplicates} 个重复，${data.data.summary.related} 个相关，${data.data.summary.distinct} 个独立`);
      
      // 刷新数据
      await fetchOverview();
      await fetchAnalysisPreview();
      
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '分析失败');
      setAnalysisRunning(false);
      setAnalysisProgress(null);
    }
  };

  const handleResetProgress = async () => {
    if (!confirm('确定要重置进度吗？这将清除当前的分析状态，允许重新开始分析。')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/skills-governance/full-analysis', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('重置失败');
      }

      toast.success('进度已重置');
      setAnalysisRunning(false);
      setAnalysisProgress(null);
      await fetchAnalysisPreview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重置失败');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
        <button
          onClick={fetchOverview}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <RefreshCw size={20} className="mr-2" />
          重新加载
        </button>
      </div>
    );
  }

  const stats = overview?.stats;
  const pendingTotal = (overview?.pendingItems.impactAnalysis || 0) + 
                       (overview?.pendingItems.mergeRecords || 0) + 
                       (overview?.pendingItems.llmAnalysis || 0) + 
                       (overview?.pendingItems.duplicateGroups || 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Skills 观测治理</h1>
          <p className="mt-1 text-sm text-gray-600">
            监控 Skills 重复检测、重叠预警和治理建议
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {refreshing ? (
              <>
                <RefreshCw size={20} className="mr-2 animate-spin" />
                刷新中...
              </>
            ) : (
              <>
                <RefreshCw size={20} className="mr-2" />
                刷新数据
              </>
            )}
          </button>
        </div>
      </div>

      {/* LLM 全量分析卡片 */}
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-4">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Brain className="text-purple-600" size={24} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">LLM 深度分析</h3>
              <p className="text-sm text-gray-600 mt-1">
                使用 AI 模型智能判断 Skills 是否真正功能重复，减少误报
              </p>
              {analysisPreview && (
                <div className="flex items-center space-x-4 mt-3 text-sm">
                  <span className="text-gray-600">
                    待分析: <span className="font-semibold text-gray-900">{analysisPreview.filteredPairs}</span> 对
                  </span>
                  <span className="text-gray-600">
                    预计时间: <span className="font-semibold text-gray-900">{analysisPreview.estimatedTime}</span>
                  </span>
                  <span className="text-gray-600">
                    预估成本: <span className="font-semibold text-gray-900">{analysisPreview.estimatedCost}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={handleStartFullAnalysis}
            disabled={analysisRunning || analysisPreview?.progress?.status === 'running' || analysisPreview?.filteredPairs === 0}
            className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {analysisRunning || analysisPreview?.progress?.status === 'running' ? (
              <>
                <Loader2 size={20} className="mr-2 animate-spin" />
                分析中...
              </>
            ) : !analysisPreview ? (
              <>
                <Loader2 size={20} className="mr-2 animate-spin" />
                加载中...
              </>
            ) : (
              <>
                <Play size={20} className="mr-2" />
                开始分析
              </>
            )}
          </button>
          {/* 卡住的进度显示重置按钮 */}
          {analysisPreview?.progress?.status === 'running' && isProgressStuck() && (
            <button
              onClick={handleResetProgress}
              className="inline-flex items-center px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm"
              title="分析任务可能已停止，点击重置进度状态"
            >
              重置进度
            </button>
          )}
        </div>
        
        {(analysisRunning || analysisPreview?.progress?.status === 'running') && (analysisProgress || analysisPreview?.progress) && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
              <span>分析进度</span>
              <span>{analysisProgress?.current ?? analysisPreview?.progress?.current ?? 0} / {analysisProgress?.total ?? analysisPreview?.progress?.total ?? 0}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${((analysisProgress?.current ?? analysisPreview?.progress?.current ?? 0) / (analysisProgress?.total ?? analysisPreview?.progress?.total ?? 1)) * 100}%` }}
              />
            </div>
            {analysisPreview?.progress?.results && (
              <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                <span>重复: {analysisPreview.progress.results.duplicates}</span>
                <span>相关: {analysisPreview.progress.results.related}</span>
                <span>独立: {analysisPreview.progress.results.distinct}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 待审核入口 */}
      {overview?.pendingItems.llmAnalysis && overview.pendingItems.llmAnalysis > 0 && (
        <Link
          href="/dashboard/admin/skills-governance/analysis-review?status=pending"
          className="block bg-gradient-to-r from-orange-50 to-yellow-50 rounded-lg border border-orange-200 p-4 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <AlertTriangle className="text-orange-600" size={20} />
              </div>
              <div>
                <h4 className="font-semibold text-gray-900">待审核分析结果</h4>
                <p className="text-sm text-gray-600">有 {overview.pendingItems.llmAnalysis} 个 LLM 分析结果等待人工确认</p>
              </div>
            </div>
            <ChevronRight className="text-gray-400" size={24} />
          </div>
        </Link>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Skills总数 */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Skills总数</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">
                {stats?.totalSkills || 0}
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <Award className="text-blue-600" size={24} />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            有观测记录的 Skills
          </p>
        </div>

        {/* 预警记录 */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">预警记录</p>
              <p className="text-3xl font-bold text-orange-600 mt-1">
                {stats?.totalWarnings || 0}
              </p>
            </div>
            <div className="p-3 bg-orange-100 rounded-lg">
              <AlertTriangle className="text-orange-600" size={24} />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            预警率: {((stats?.avgWarningRate || 0) * 100).toFixed(1)}%
          </p>
        </div>

        {/* 高频重复 */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">高频重复</p>
              <p className="text-3xl font-bold text-red-600 mt-1">
                {stats?.highRiskSkills || 0}
              </p>
            </div>
            <div className="p-3 bg-red-100 rounded-lg">
              <TrendingUp className="text-red-600" size={24} />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            高风险 Skills (预警率≥50%)
          </p>
        </div>

        {/* 待处理 */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">待处理</p>
              <p className="text-3xl font-bold text-purple-600 mt-1">
                {pendingTotal}
              </p>
            </div>
            <div className="p-3 bg-purple-100 rounded-lg">
              <Clock className="text-purple-600" size={24} />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            LLM分析: {overview?.pendingItems.llmAnalysis || 0} | 重复组: {overview?.pendingItems.duplicateGroups || 0} | 影响: {overview?.pendingItems.impactAnalysis || 0}
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-6">
            <span className="text-gray-600">
              <Activity size={16} className="inline mr-1" />
              总观测: <span className="font-semibold text-gray-900">{stats?.totalObservations || 0}</span>
            </span>
            <span className="text-gray-600">
              匹配次数: <span className="font-semibold text-gray-900">{stats?.totalMatches || 0}</span>
            </span>
            <span className="text-gray-600">
              重叠检测: <span className="font-semibold text-gray-900">{stats?.totalOverlaps || 0}</span>
            </span>
            <span className="text-gray-600">
              最近7天: <span className="font-semibold text-gray-900">{stats?.recentObservations || 0}</span>
            </span>
          </div>
          <span className="text-gray-600">
            平均匹配率: <span className="font-semibold text-blue-600">{((stats?.avgMatchRate || 0) * 100).toFixed(1)}%</span>
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon size={18} className="mr-2" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* 高频重复 Tab */}
          {activeTab === 'high-frequency' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">高频重叠 Skills</h3>
                <button
                  onClick={() => router.push('/dashboard/admin/skills-governance/high-frequency')}
                  className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700"
                >
                  查看全部
                  <ChevronRight size={16} className="ml-1" />
                </button>
              </div>
              
              {overview?.topOverlapSkills.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <TrendingUp className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                  <p>暂无高频重叠 Skills</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {overview?.topOverlapSkills.map((skill, index) => (
                    <div
                      key={skill.skillId}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                      onClick={() => router.push(`/dashboard/skills/${skill.skillId}`)}
                    >
                      <div className="flex items-center space-x-4">
                        <span className="text-sm font-medium text-gray-500 w-6">{index + 1}</span>
                        <div>
                          <p className="font-medium text-gray-900">{skill.skillDisplayName}</p>
                          <p className="text-sm text-gray-500">{skill.skillName}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className="text-sm text-gray-600">
                          重叠: <span className="font-semibold">{skill.overlapCount}</span>
                        </span>
                        <span className="text-sm text-gray-600">
                          预警: <span className="font-semibold">{skill.warningCount}</span>
                        </span>
                        <span className={`px-2 py-1 text-xs rounded-full ${riskLevelColors[skill.riskLevel] || 'bg-gray-100 text-gray-600'}`}>
                          {skill.riskLevel}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 重复组 Tab */}
          {activeTab === 'overlap-groups' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">重叠技能组</h3>
                <button
                  onClick={() => router.push('/dashboard/admin/skills-governance/merge-candidates')}
                  className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700"
                >
                  查看合并候选
                  <ChevronRight size={16} className="ml-1" />
                </button>
              </div>
              
              {overview?.overlapPairs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Layers className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                  <p>暂无重叠技能组</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {overview?.overlapPairs.map((pair, index) => (
                    <div
                      key={`${pair.skillId1}-${pair.skillId2}`}
                      className="p-4 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-500">组 {index + 1}</span>
                        <span className={`px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800`}>
                          {overlapTypeLabels[pair.overlapType] || pair.overlapType}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => router.push(`/dashboard/skills/${pair.skillId1}`)}
                            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {pair.skillName1}
                          </button>
                          <span className="text-gray-400">+</span>
                          <button
                            onClick={() => router.push(`/dashboard/skills/${pair.skillId2}`)}
                            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {pair.skillName2}
                          </button>
                        </div>
                        <div className="flex items-center space-x-3 text-sm text-gray-600">
                          <span>重叠次数: {pair.overlapCount}</span>
                          <span>相似度: {(pair.overlapScore * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 新增影响 Tab */}
          {activeTab === 'new-impact' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">新增 Skill 影响分析</h3>
                <button
                  onClick={() => router.push('/dashboard/admin/skills-governance/new-impact')}
                  className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700"
                >
                  查看全部
                  <ChevronRight size={16} className="ml-1" />
                </button>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Sparkles className="text-blue-600" size={20} />
                    <span className="text-sm text-blue-800">
                      待处理影响分析: <span className="font-semibold">{overview?.pendingItems.impactAnalysis || 0}</span> 个
                    </span>
                  </div>
                  {(overview?.pendingItems.impactAnalysis ?? 0) > 0 && (
                    <button
                      onClick={() => router.push('/dashboard/admin/skills-governance/new-impact')}
                      className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      处理待办
                      <ChevronRight size={16} className="ml-1" />
                    </button>
                  )}
                </div>
              </div>

              {(overview?.pendingItems.impactAnalysis || 0) === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Sparkles className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                  <p>暂无待处理的影响分析</p>
                </div>
              )}
            </div>
          )}

          {/* 趋势 Tab */}
          {activeTab === 'trends' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">观测趋势</h3>
                <button
                  onClick={() => router.push('/dashboard/admin/skills-governance/trends')}
                  className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700"
                >
                  查看详细趋势
                  <ChevronRight size={16} className="ml-1" />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">最近7天观测</span>
                    <TrendingUp className="text-green-500" size={18} />
                  </div>
                  <p className="text-2xl font-bold text-gray-900">{stats?.recentObservations || 0}</p>
                  <p className="text-xs text-gray-500 mt-1">观测活动趋势</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">平均预警率</span>
                    <AlertTriangle className="text-orange-500" size={18} />
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {((stats?.avgWarningRate || 0) * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-gray-500 mt-1">预警趋势指标</p>
                </div>
              </div>

              <div className="text-center py-4 text-gray-500 text-sm">
                <BarChart3 className="inline h-5 w-5 mr-1" />
                详细趋势图表请点击"查看详细趋势"
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}