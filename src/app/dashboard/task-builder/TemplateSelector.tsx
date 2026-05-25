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
    bg: 'bg-indigo-500/10',
    border: 'border-indigo-500/50',
    text: 'text-indigo-400',
    badge: 'bg-indigo-500/15 text-indigo-400',
  },
  red: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/50',
    text: 'text-red-400',
    badge: 'bg-red-500/15 text-red-400',
  },
  orange: {
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/50',
    text: 'text-orange-400',
    badge: 'bg-orange-500/15 text-orange-400',
  },
  purple: {
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/50',
    text: 'text-purple-400',
    badge: 'bg-purple-500/15 text-purple-400',
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
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-4">
          <p className="text-sm text-dark-text-secondary">
            选择一个任务模板开始构建。每个模板预设了安全审计任务的标准参数配置。
          </p>
        </div>
      )}

      {compact && (
        <p className="text-sm text-dark-text-muted mb-3">选择模板类型：</p>
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
                  : 'bg-dark-surface border-dark-border hover:border-dark-surface-hover hover:shadow'
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
                  <h3 className={`font-semibold text-dark-text ${compact ? 'text-sm' : ''}`}>
                    {template.name}
                  </h3>
                  {!compact && (
                    <p className="text-sm text-dark-text-muted mt-1">{template.description}</p>
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