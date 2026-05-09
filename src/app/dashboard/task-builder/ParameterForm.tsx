'use client';

import { HelpCircle, Info } from 'lucide-react';
import { TaskTemplate } from './types';

interface Props {
  template: TaskTemplate;
  parameters: Record<string, string>;
  notes: string;
  onParameterChange: (name: string, value: string) => void;
  onNotesChange: (notes: string) => void;
  compact?: boolean;
}

export default function ParameterForm({
  template,
  parameters,
  notes,
  onParameterChange,
  onNotesChange,
  compact,
}: Props) {
  return (
    <div className="space-y-4">
      {!compact && (
        <div className="bg-green-900/20 border border-green-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <Info size={18} className="text-green-400 mt-0.5" />
            <div className="text-sm text-green-800">
              <p className="font-medium">已选择模板：{template.name}</p>
              <p className="mt-1 text-green-400">请填写以下参数来配置任务实例。必填参数标记了 * 符号。</p>
            </div>
          </div>
        </div>
      )}

      {compact && (
        <div className="text-sm text-gray-400 mb-3">
          已选择：<span className="font-medium text-gray-100">{template.name}</span>
        </div>
      )}

      <div className="space-y-3">
        {!compact && <h3 className="text-lg font-medium text-gray-100">任务参数</h3>}

        {template.parameters.map((param) => (
          <div key={param.name}>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {param.label}
              {param.required && <span className="text-red-500 ml-1">*</span>}
            </label>

            {param.type === 'text' && (
              <input
                type="text"
                value={parameters[param.name] || ''}
                onChange={(e) => onParameterChange(param.name, e.target.value)}
                placeholder={param.placeholder}
                className={`w-full px-3 py-1.5 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent ${compact ? 'text-sm' : 'px-4 py-2'}`}
              />
            )}

            {param.type === 'url' && (
              <input
                type="url"
                value={parameters[param.name] || ''}
                onChange={(e) => onParameterChange(param.name, e.target.value)}
                placeholder={param.placeholder}
                className={`w-full px-3 py-1.5 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent ${compact ? 'text-sm' : 'px-4 py-2'}`}
              />
            )}

            {param.type === 'textarea' && (
              <textarea
                value={parameters[param.name] || ''}
                onChange={(e) => onParameterChange(param.name, e.target.value)}
                placeholder={param.placeholder}
                rows={compact ? 2 : 3}
                className={`w-full px-3 py-1.5 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none ${compact ? 'text-sm' : 'px-4 py-2'}`}
              />
            )}

            {param.type === 'select' && (
              <select
                value={parameters[param.name] || param.defaultValue || ''}
                onChange={(e) => onParameterChange(param.name, e.target.value)}
                className={`w-full px-3 py-1.5 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-dark-surface ${compact ? 'text-sm' : 'px-4 py-2'}`}
              >
                {param.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}

            {!compact && param.description && (
              <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                <HelpCircle size={12} />
                {param.description}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className={!compact ? 'border-t border-gray-700/50 pt-4' : ''}>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          备注说明
          <span className="text-gray-500 text-xs ml-2">（可选）</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="添加任何额外的说明或特殊要求..."
          rows={compact ? 1 : 2}
          className={`w-full px-3 py-1.5 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none ${compact ? 'text-sm' : 'px-4 py-2'}`}
        />
      </div>
    </div>
  );
}