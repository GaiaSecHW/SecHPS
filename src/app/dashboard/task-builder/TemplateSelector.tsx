'use client';

import { Shield, Bug, Sword, Network, CheckCircle2 } from 'lucide-react';
import { TaskTemplate } from './types';

const iconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Shield,
  Bug,
  Sword,
  Network,
};

const colorMap: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  blue: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-600',
    badge: 'bg-blue-100 text-blue-700',
  },
  red: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-600',
    badge: 'bg-red-100 text-red-700',
  },
  orange: {
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-600',
    badge: 'bg-orange-100 text-orange-700',
  },
  purple: {
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-600',
    badge: 'bg-purple-100 text-purple-700',
  },
};

interface Props {
  templates: TaskTemplate[];
  selectedId: string;
  onSelect: (templateId: string) => void;
  compact?: boolean;
}

export default function TemplateSelector({ templates, selectedId, onSelect, compact }: Props) {
  return (
    <div className="space-y-3">
      {!compact && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            选择一个任务模板开始构建。每个模板预设了安全审计任务的标准参数配置。
          </p>
        </div>
      )}

      {compact && (
        <p className="text-sm text-gray-600 mb-3">选择模板类型：</p>
      )}

      <div className={`grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}>
        {templates.map((template) => {
          const Icon = iconMap[template.icon] || Shield;
          const colors = colorMap[template.color] || colorMap.blue;
          const isSelected = selectedId === template.id;

          return (
            <div
              key={template.id}
              onClick={() => onSelect(template.id)}
              className={`relative rounded-lg border-2 cursor-pointer transition-all ${
                isSelected
                  ? `${colors.bg} ${colors.border} shadow-md`
                  : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow'
              } ${compact ? 'p-3' : 'p-4'}`}
            >
              {isSelected && (
                <div className="absolute top-1.5 right-1.5">
                  <CheckCircle2 size={compact ? 16 : 20} className={colors.text} />
                </div>
              )}

              <div className="flex items-start gap-2">
                <div className={`p-1.5 rounded-lg ${colors.bg}`}>
                  <Icon size={compact ? 18 : 24} className={colors.text} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className={`font-semibold text-gray-900 ${compact ? 'text-sm' : ''}`}>
                    {template.name}
                  </h3>
                  {!compact && (
                    <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                  )}

                  {!compact && template.tags && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {template.tags.map((tag) => (
                        <span
                          key={tag}
                          className={`px-2 py-0.5 text-xs rounded ${colors.badge}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {!compact && (
                    <div className="text-xs text-gray-500 mt-2">
                      {template.parameters.length} 个参数
                      {template.parameters.filter(p => p.required).length > 0 &&
                        ` · ${template.parameters.filter(p => p.required).length} 个必填`}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}