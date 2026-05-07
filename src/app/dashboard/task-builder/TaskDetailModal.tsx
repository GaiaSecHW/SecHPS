'use client';

import { Calendar, User, Shield, Bug, Sword, Network, FileText, Settings, Clock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { TaskInstance } from './types';

const iconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Shield,
  Bug,
  Sword,
  Network,
};

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-700', label: '待执行' },
  running: { bg: 'bg-blue-100', text: 'text-blue-700', label: '执行中' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: '已完成' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: '执行失败' },
};

const templateStyleMap: Record<string, { bg: string; iconBg: string; iconColor: string }> = {
  'code-review': { bg: 'bg-blue-50', iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
  'vuln-scan': { bg: 'bg-red-50', iconBg: 'bg-red-100', iconColor: 'text-red-600' },
  'penetration-test': { bg: 'bg-orange-50', iconBg: 'bg-orange-100', iconColor: 'text-orange-600' },
  'threat-modeling': { bg: 'bg-purple-50', iconBg: 'bg-purple-100', iconColor: 'text-purple-600' },
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  task: TaskInstance | null;
}

export default function TaskDetailModal({ isOpen, onClose, task }: Props) {
  if (!task) return null;

  const Icon = iconMap[task.templateId === 'code-review' ? 'Shield' :
                     task.templateId === 'vuln-scan' ? 'Bug' :
                     task.templateId === 'penetration-test' ? 'Sword' : 'Network'];
  const config = statusConfig[task.status] || statusConfig.pending;
  const style = templateStyleMap[task.templateId] || templateStyleMap['code-review'];

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="任务详情" size="lg">
      <div className="space-y-6 p-6">
        {/* 基本信息 */}
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-lg ${style.iconBg}`}>
            <Icon size={32} className={style.iconColor} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{task.name}</h2>
            <p className="text-sm text-gray-600 mt-1">{task.templateName}</p>
          </div>
          <div className="ml-auto">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
              {config.label}
            </span>
          </div>
        </div>

        {/* 时间信息 */}
        <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">创建时间</p>
              <p className="text-sm font-medium text-gray-900">{formatDate(task.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">更新时间</p>
              <p className="text-sm font-medium text-gray-900">{formatDate(task.updatedAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <User size={18} className="text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">创建人</p>
              <p className="text-sm font-medium text-gray-900">{task.userName || '未知'}</p>
            </div>
          </div>
        </div>

        {/* 参数配置 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Settings size={18} className="text-gray-600" />
            <h3 className="text-lg font-medium text-gray-900">参数配置</h3>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">参数名</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">参数值</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {Object.entries(task.parameters).map(([key, value]) => (
                  <tr key={key}>
                    <td className="px-4 py-2 text-sm font-medium text-gray-700">{key}</td>
                    <td className="px-4 py-2 text-sm text-gray-900">{value || '-'}</td>
                  </tr>
                ))}
                {Object.keys(task.parameters).length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-4 py-2 text-sm text-gray-500 text-center">
                      无参数配置
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 备注说明 */}
        {task.notes && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileText size={18} className="text-gray-600" />
              <h3 className="text-lg font-medium text-gray-900">备注说明</h3>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{task.notes}</p>
            </div>
          </div>
        )}

        {/* 关闭按钮 */}
        <div className="flex justify-end pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            关闭
          </button>
        </div>
      </div>
    </Modal>
  );
}