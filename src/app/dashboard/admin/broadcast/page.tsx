'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Megaphone,
  Save,
  Loader2,
  Eye,
  EyeOff,
  Palette,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';

interface BroadcastConfig {
  content: string;
  enabled: boolean;
  color: string;
}

const COLOR_OPTIONS = [
  { value: 'blue', label: '蓝色', preview: 'bg-gradient-to-r from-blue-600 via-blue-500 to-blue-600' },
  { value: 'yellow', label: '黄色', preview: 'bg-gradient-to-r from-yellow-600 via-yellow-500 to-yellow-600' },
  { value: 'red', label: '红色', preview: 'bg-gradient-to-r from-red-600 via-red-500 to-red-600' },
  { value: 'green', label: '绿色', preview: 'bg-gradient-to-r from-green-600 via-green-500 to-green-600' },
];

export default function BroadcastManagePage() {
  return (
    <AdminGuard>
      <BroadcastManageContent />
    </AdminGuard>
  );
}

function BroadcastManageContent() {
  const router = useRouter();
  const [config, setConfig] = useState<BroadcastConfig>({
    content: '欢迎使用 AI4WEB 测试平台',
    enabled: true,
    color: 'blue',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    fetch('/api/admin/broadcast', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.config) {
          setConfig(data.config);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [router]);

  const handleSave = async () => {
    if (!config.content.trim()) {
      toast.error('广播内容不能为空');
      return;
    }

    setSaving(true);
    const token = localStorage.getItem('token');

    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(config),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '保存失败');
      }

      toast.success('广播配置已保存');
      
      // 强制刷新页面让跑马灯立即生效
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-dark-surface rounded-lg shadow-sm border border-gray-700/50">
        {/* Header */}
        <div className="p-6 border-b border-gray-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Megaphone className="w-6 h-6 text-blue-500" />
              <h1 className="text-xl font-semibold text-gray-100">通知广播管理</h1>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  保存
                </>
              )}
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-400">
            配置顶部通知广播内容，支持多条消息轮播（用 || 分隔）
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium text-gray-100">启用广播</label>
              <p className="text-sm text-gray-500">关闭后顶部将不显示跑马灯</p>
            </div>
            <button
              onClick={() => setConfig({ ...config, enabled: !config.enabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                config.enabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-dark-surface transition-transform ${
                  config.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Content Input */}
          <div>
            <label className="block font-medium text-gray-100 mb-2">
              广播内容
            </label>
            <textarea
              value={config.content}
              onChange={(e) => setConfig({ ...config, content: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="输入广播内容，多条消息用 || 分隔"
            />
            <p className="mt-1 text-xs text-gray-500">
              示例：欢迎使用 AI4WEB 测试平台 || 系统将于今晚 22:00 进行维护
            </p>
          </div>

          {/* Color Selection */}
          <div>
            <label className="block font-medium text-gray-100 mb-2">
              <Palette className="w-4 h-4 inline mr-1" />
              背景颜色
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {COLOR_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setConfig({ ...config, color: option.value })}
                  className={`relative h-10 rounded-lg ${option.preview} transition-all ${
                    config.color === option.value
                      ? 'ring-2 ring-offset-2 ring-primary-500'
                      : 'hover:opacity-80'
                  }`}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-white font-medium text-sm">
                    {option.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div>
            <label className="block font-medium text-gray-100 mb-2">
              <Eye className="w-4 h-4 inline mr-1" />
              效果预览
            </label>
            <div
              className={`overflow-hidden rounded-md shadow-sm h-10 ${
                config.enabled
                  ? COLOR_OPTIONS.find((c) => c.value === config.color)?.preview
                  : 'bg-gray-100'
              }`}
            >
              <div className="flex items-center h-full px-4">
                {config.enabled ? (
                  <>
                    <Megaphone className="w-5 h-5 text-white mr-3 flex-shrink-0" />
                    <div className="overflow-hidden whitespace-nowrap flex-1">
                      <span className="text-white font-medium text-base animate-marquee">
                        {config.content.split('||')[0].trim()}
                      </span>
                    </div>
                  </>
                ) : (
                  <span className="text-gray-400 text-sm">广播已禁用</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}