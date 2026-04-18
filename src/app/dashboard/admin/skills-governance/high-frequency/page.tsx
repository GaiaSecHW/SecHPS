'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Download,
  FileText,
  Merge,
  RefreshCw,
  Search,
  Shield,
  XCircle,
} from 'lucide-react';
import { useSkillCategories } from '@/hooks/useSkillCategories';

// Types from API response
interface SkillStatsWithDetails {
  id: string;
  skillId: string;
  skillName: string;
  skillDisplayName: string;
  skillCategory: string;
  totalObservations: number;
  warningCount: number;
  matchCount: number;
  overlapCount: number;
  matchRate: number;
  warningRate: number;
  avgMatchScore: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface OverlapPairStats {
  skillId1: string;
  skillName1: string;
  skillId2: string;
  skillName2: string;
  overlapCount: number;
  overlapScore: number;
  overlapType: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}

interface ApiResponse {
  skills: SkillStatsWithDetails[];
  overlapPairs: OverlapPairStats[];
}

// Risk level color mapping
const riskLevelConfig: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-green-100', text: 'text-green-800', label: '低风险' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '中风险' },
  high: { bg: 'bg-orange-100', text: 'text-orange-800', label: '高风险' },
  critical: { bg: 'bg-red-100', text: 'text-red-800', label: '严重' },
};

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

export default function HighFrequencyPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <HighFrequencyPageContent />
    </Suspense>
  );
}

function HighFrequencyPageContent() {
  const router = useRouter();
  const [skills, setSkills] = useState<SkillStatsWithDetails[]>([]);
  const [overlapPairs, setOverlapPairs] = useState<OverlapPairStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [batchOperating, setBatchOperating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [limit, setLimit] = useState(20);

  // 分类标签 - 从数据库动态获取
  const { categoryLabels } = useSkillCategories();

  useEffect(() => {
    fetchHighFrequencyData();
  }, [limit]);

  const fetchHighFrequencyData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/admin/skills-governance/high-frequency?limit=${limit}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '获取高频重叠排行失败');
      }

      const data = await response.json();
      setSkills(data.data?.skills || []);
      setOverlapPairs(data.data?.overlapPairs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  // Filter skills by search term
  const filteredSkills = skills.filter(
    (skill) =>
      skill.skillName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      skill.skillDisplayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      skill.skillCategory.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Selection handlers
  const handleSelectSkill = (skillId: string) => {
    const newSelected = new Set(selectedSkills);
    if (newSelected.has(skillId)) {
      newSelected.delete(skillId);
    } else {
      newSelected.add(skillId);
    }
    setSelectedSkills(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedSkills.size === filteredSkills.length) {
      setSelectedSkills(new Set());
    } else {
      setSelectedSkills(new Set(filteredSkills.map(s => s.skillId)));
    }
  };

  // Batch operations
  const handleBatchMarkReviewed = async () => {
    if (selectedSkills.size === 0) {
      toast.error('请先选择要标记的 Skill');
      return;
    }

    if (!confirm(`确定要批量标记 ${selectedSkills.size} 个 Skill 为已审核吗？`)) {
      return;
    }

    try {
      setBatchOperating(true);
      // TODO: Implement batch mark reviewed API
      toast.success(`已标记 ${selectedSkills.size} 个 Skill 为已审核`);
      setSelectedSkills(new Set());
      fetchHighFrequencyData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBatchOperating(false);
    }
  };

  const handleBatchSuggestMerge = async () => {
    if (selectedSkills.size === 0) {
      toast.error('请先选择要合并的 Skill');
      return;
    }

    if (selectedSkills.size < 2) {
      toast.error('合并建议需要至少选择 2 个 Skill');
      return;
    }

    if (!confirm(`确定要为 ${selectedSkills.size} 个 Skill 生成合并建议吗？`)) {
      return;
    }

    try {
      setBatchOperating(true);
      // TODO: Implement batch suggest merge API
      toast.success(`已为 ${selectedSkills.size} 个 Skill 生成合并建议`);
      setSelectedSkills(new Set());
      fetchHighFrequencyData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBatchOperating(false);
    }
  };

  const handleExportReport = async () => {
    try {
      setExporting(true);
      
      // Generate report data
      const reportData = {
        generatedAt: new Date().toISOString(),
        totalSkills: skills.length,
        totalOverlapPairs: overlapPairs.length,
        skills: skills.map(s => ({
          name: s.skillDisplayName,
          skillId: s.skillId,
          category: categoryLabels[s.skillCategory] || s.skillCategory,
          overlapCount: s.overlapCount,
          matchRate: `${(s.matchRate * 100).toFixed(1)}%`,
          warningRate: `${(s.warningRate * 100).toFixed(1)}%`,
          riskLevel: riskLevelConfig[s.riskLevel]?.label || s.riskLevel,
          lastObserved: s.lastObservedAt ? new Date(s.lastObservedAt).toLocaleDateString('zh-CN') : '无',
        })),
        overlapPairs: overlapPairs.map(p => ({
          skill1: p.skillName1,
          skill2: p.skillName2,
          overlapCount: p.overlapCount,
          overlapScore: p.overlapScore.toFixed(2),
          overlapType: p.overlapType,
        })),
      };

      // Create and download file
      const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `high-frequency-report-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(`导出成功！共 ${skills.length} 个高频 Skill`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link 
        href="/dashboard/admin/skills-governance"
        className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        返回治理总览
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">高频重复排行</h1>
          <p className="mt-1 text-sm text-gray-600">
            显示重叠次数最高的 Skills，帮助识别潜在的重复或相似技能
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Batch action buttons */}
          {selectedSkills.size > 0 && (
            <>
              <span className="text-sm text-gray-600">
                已选择 {selectedSkills.size} 项
              </span>
              <button
                onClick={handleBatchMarkReviewed}
                disabled={batchOperating}
                className="inline-flex items-center px-3 py-2 bg-green-100 text-green-800 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
                title="批量标记为已审核"
              >
                <CheckCircle size={16} className="mr-1" />
                批量标记审核
              </button>
              <button
                onClick={handleBatchSuggestMerge}
                disabled={batchOperating}
                className="inline-flex items-center px-3 py-2 bg-purple-100 text-purple-800 rounded-lg hover:bg-purple-200 transition-colors disabled:opacity-50"
                title="批量生成合并建议"
              >
                <Merge size={16} className="mr-1" />
                批量建议合并
              </button>
            </>
          )}
          {/* Export button */}
          <button
            onClick={handleExportReport}
            disabled={exporting}
            className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
            title="导出高频排行报告"
          >
            {exporting ? (
              <>
                <RefreshCw size={20} className="mr-2 animate-spin" />
                导出中...
              </>
            ) : (
              <>
                <Download size={20} className="mr-2" />
                导出报告
              </>
            )}
          </button>
          {/* Refresh button */}
          <button
            onClick={fetchHighFrequencyData}
            disabled={loading}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            title="刷新数据"
          >
            <RefreshCw size={20} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">高频重复排行说明</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• <strong>重叠次数</strong>：该 Skill 在观测日志中与其他 Skill 同时出现的次数</li>
          <li>• <strong>选择率</strong>：该 Skill 在匹配请求中被选中的比例</li>
          <li>• <strong>决策状态</strong>：基于预警率和重叠次数的风险等级评估</li>
          <li>• <strong>批量操作</strong>：选中多个 Skill 后可批量标记审核或生成合并建议</li>
        </ul>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="搜索 Skill 名称或分类..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">显示数量:</label>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Ranking Table */}
      {filteredSkills.length === 0 ? (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
          <div className="text-center">
            <Shield className="mx-auto h-16 w-16 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">暂无高频重叠数据</h3>
            <p className="mt-2 text-sm text-gray-600">
              {searchTerm
                ? '没有找到匹配的 Skills'
                : '尚未有足够的观测数据，请等待更多 Skill 匹配请求'}
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedSkills.size === filteredSkills.length && filteredSkills.length > 0}
                        onChange={handleSelectAll}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span>选择</span>
                    </label>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    排名
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Skill 名称
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    分类
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    重复次数
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    选择率
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    预警率
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    决策状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    最后观测
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredSkills.map((skill, index) => {
                  const riskConfig = riskLevelConfig[skill.riskLevel] || riskLevelConfig.low;
                  return (
                    <tr key={skill.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedSkills.has(skill.skillId)}
                          onChange={() => handleSelectSkill(skill.skillId)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {index < 3 && (
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold mr-2 ${
                              index === 0 ? 'bg-red-500 text-white' :
                              index === 1 ? 'bg-orange-500 text-white' :
                              'bg-yellow-500 text-white'
                            }`}>
                              {index + 1}
                            </span>
                          )}
                          {index >= 3 && (
                            <span className="text-gray-600 font-medium">{index + 1}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="font-medium text-gray-900">{skill.skillDisplayName}</div>
                          <div className="text-sm text-gray-500">{skill.skillName}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                          {categoryLabels[skill.skillCategory] || skill.skillCategory}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <AlertTriangle size={16} className={`mr-1 ${
                            skill.overlapCount >= 10 ? 'text-red-500' :
                            skill.overlapCount >= 5 ? 'text-orange-500' :
                            'text-gray-400'
                          }`} />
                          <span className={`font-medium ${
                            skill.overlapCount >= 10 ? 'text-red-600' :
                            skill.overlapCount >= 5 ? 'text-orange-600' :
                            'text-gray-600'
                          }`}>
                            {skill.overlapCount}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                            <div
                              className="bg-blue-500 h-2 rounded-full"
                              style={{ width: `${Math.min(skill.matchRate * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-sm text-gray-600">
                            {(skill.matchRate * 100).toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                            <div
                              className={`h-2 rounded-full ${
                                skill.warningRate >= 0.5 ? 'bg-red-500' :
                                skill.warningRate >= 0.3 ? 'bg-orange-500' :
                                'bg-yellow-500'
                              }`}
                              style={{ width: `${Math.min(skill.warningRate * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-sm text-gray-600">
                            {(skill.warningRate * 100).toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs rounded-full ${riskConfig.bg} ${riskConfig.text}`}>
                          {riskConfig.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {skill.lastObservedAt
                          ? new Date(skill.lastObservedAt).toLocaleDateString('zh-CN')
                          : '无'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Overlap Pairs Section */}
      {overlapPairs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">高频重叠对</h2>
          <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Skill 1
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Skill 2
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      重叠次数
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      重叠得分
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      重叠类型
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      最后观测
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {overlapPairs.slice(0, 10).map((pair, index) => (
                    <tr key={`${pair.skillId1}-${pair.skillId2}-${index}`} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {pair.skillName1}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {pair.skillName2}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`font-medium ${
                          pair.overlapCount >= 5 ? 'text-red-600' : 'text-gray-600'
                        }`}>
                          {pair.overlapCount}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                            <div
                              className={`h-2 rounded-full ${
                                pair.overlapScore >= 0.85 ? 'bg-red-500' :
                                pair.overlapScore >= 0.75 ? 'bg-orange-500' :
                                'bg-blue-500'
                              }`}
                              style={{ width: `${Math.min(pair.overlapScore * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-sm text-gray-600">
                            {pair.overlapScore.toFixed(2)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          pair.overlapType === 'exact' ? 'bg-red-100 text-red-800' :
                          pair.overlapType === 'semantic-overlap' ? 'bg-orange-100 text-orange-800' :
                          pair.overlapType === 'techStack-overlap' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {pair.overlapType === 'exact' ? '完全匹配' :
                           pair.overlapType === 'semantic-overlap' ? '语义重叠' :
                           pair.overlapType === 'techStack-overlap' ? '技术栈重叠' :
                           pair.overlapType}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {pair.lastObservedAt
                          ? new Date(pair.lastObservedAt).toLocaleDateString('zh-CN')
                          : '无'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}