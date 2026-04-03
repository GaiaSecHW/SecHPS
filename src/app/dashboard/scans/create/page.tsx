'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap,
  ArrowLeft,
  Save,
} from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  severity: string;
  isActive: boolean;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
}

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
  info: 'bg-gray-100 text-gray-800',
};

export default function CreateScanPage() {
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [schedule, setSchedule] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');

      const [skillsRes, projectsRes] = await Promise.all([
        fetch('/api/skills?isActive=true', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/projects', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (skillsRes.ok) {
        const data = await skillsRes.json();
        setSkills(data.skills || []);
      }

      if (projectsRes.ok) {
        const data = await projectsRes.json();
        setProjects(data.projects || []);
        if (data.projects?.length > 0) {
          setProjectId(data.projects[0].id);
        }
      }
    } catch (err) {
      console.error('获取数据失败:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !projectId || selectedSkills.length === 0) {
      setError('请填写必填字段');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('token');
      const response = await fetch('/api/scans', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          description,
          projectId,
          skillIds: selectedSkills,
          schedule: schedule || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '创建失败');
      }

      router.push('/dashboard/scans');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleSkill = (skillId: string) => {
    setSelectedSkills(prev =>
      prev.includes(skillId)
        ? prev.filter(id => id !== skillId)
        : [...prev, skillId]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">创建扫描任务</h1>
          <p className="mt-1 text-sm text-gray-600">选择项目和 Skills 进行安全扫描</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">基本信息</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                任务名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="例如：每周安全扫描"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="任务描述（可选）"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                目标项目 <span className="text-red-500">*</span>
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">定时计划（可选）</label>
              <input
                type="text"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="例如：0 2 * * 1 (每周一凌晨2点)"
              />
              <p className="mt-1 text-xs text-gray-500">使用 Cron 表达式，留空表示手动触发</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            选择 Skills <span className="text-red-500">*</span>
          </h3>
          <p className="text-sm text-gray-600 mb-4">已选择 {selectedSkills.length} 个 Skills</p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {skills.map((skill) => (
              <div
                key={skill.id}
                onClick={() => toggleSkill(skill.id)}
                className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedSkills.includes(skill.id)
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-gray-900">{skill.displayName}</div>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${severityColors[skill.severity]}`}>
                    {skill.severity}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{skill.description}</p>
              </div>
            ))}
          </div>

          {skills.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Zap className="mx-auto h-12 w-12 mb-2" />
              <p>暂无可用 Skills，请先创建 Skills</p>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading || !name || !projectId || selectedSkills.length === 0}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '创建中...' : (
              <>
                <Save size={20} className="mr-2" />
                创建任务
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}