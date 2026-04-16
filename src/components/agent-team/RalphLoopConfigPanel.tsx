'use client';

import React from 'react';
import {
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  DollarSign,
  Repeat,
  Sparkles,
  Code,
  Info,
} from 'lucide-react';
import type { RalphLoopConfig } from '@/types/ralph-loop-config';
import { DEFAULT_RALPH_LOOP_CONFIG } from '@/types/ralph-loop-config';

// ============ Props Interface ============

interface RalphLoopConfigPanelProps {
  config: RalphLoopConfig;
  onChange: (config: RalphLoopConfig) => void;
  disabled?: boolean;
}

// ============ Helper Components ============

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  description?: string;
}

function SliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  disabled,
  icon,
  description,
}: SliderControlProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {icon}
          <label className="text-sm font-medium text-gray-700">{label}</label>
        </div>
        <span className="text-sm font-semibold text-gray-900">
          {value}{unit}
        </span>
      </div>

      {description && (
        <p className="text-xs text-gray-500">{description}</p>
      )}

      <div className="relative">
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={disabled}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, #e5e7eb ${percentage}%, #e5e7eb 100%)`,
          }}
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>{min}{unit}</span>
          <span>{max}{unit}</span>
        </div>
      </div>
    </div>
  );
}

interface DropdownControlProps {
  label: string;
  value: string;
  options: { value: string; label: string; description?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}

function DropdownControl({
  label,
  value,
  options,
  onChange,
  disabled,
  icon,
}: DropdownControlProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        {icon}
        <label className="text-sm font-medium text-gray-700">{label}</label>
      </div>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Show selected option description */}
      {options.find(o => o.value === value)?.description && (
        <p className="text-xs text-gray-500">
          {options.find(o => o.value === value)?.description}
        </p>
      )}
    </div>
  );
}

// ============ Main Component ============

export function RalphLoopConfigPanel({
  config,
  onChange,
  disabled = false,
}: RalphLoopConfigPanelProps) {
  const mergedConfig = { ...DEFAULT_RALPH_LOOP_CONFIG, ...config };

  const handleToggle = () => {
    if (disabled) return;
    onChange({ ...mergedConfig, enabled: !mergedConfig.enabled });
  };

  const handleMaxIterationsChange = (value: number) => {
    onChange({ ...mergedConfig, maxIterations: value });
  };

  const handleMaxCostChange = (value: number) => {
    onChange({ ...mergedConfig, maxCostUsd: value });
  };

  const handleExperienceTriggerChange = (value: string) => {
    onChange({
      ...mergedConfig,
      experienceTrigger: value as 'on_failure' | 'always' | 'disabled',
    });
  };

  const handleVerifyCompletionChange = (value: string) => {
    onChange({ ...mergedConfig, verifyCompletion: value || undefined });
  };

  const experienceTriggerOptions = [
    {
      value: 'on_failure',
      label: '失败时查询',
      description: '仅在验证失败时查询历史经验，推荐设置',
    },
    {
      value: 'always',
      label: '每次迭代查询',
      description: '每次迭代后都查询经验，可能增加成本',
    },
    {
      value: 'disabled',
      label: '禁用经验学习',
      description: '不使用经验学习功能',
    },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      {/* Header with Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <RefreshCw
            size={20}
            className={mergedConfig.enabled ? 'text-blue-500' : 'text-gray-400'}
          />
          <h3 className="font-semibold text-gray-900">Ralph Loop 配置</h3>
        </div>

        <button
          onClick={handleToggle}
          disabled={disabled}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg transition-colors disabled:cursor-not-allowed"
          style={{
            backgroundColor: mergedConfig.enabled ? '#dbeafe' : '#f3f4f6',
          }}
        >
          {mergedConfig.enabled ? (
            <>
              <ToggleRight size={20} className="text-blue-600" />
              <span className="text-sm font-medium text-blue-700">已启用</span>
            </>
          ) : (
            <>
              <ToggleLeft size={20} className="text-gray-500" />
              <span className="text-sm font-medium text-gray-600">已禁用</span>
            </>
          )}
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start space-x-2">
        <Info size={16} className="text-blue-500 mt-0.5" />
        <p className="text-sm text-blue-700">
          Ralph Loop 是一种迭代执行模式，Agent 团队会持续迭代直到任务验证完成或达到限制条件。
        </p>
      </div>

      {/* Configuration Controls - only show when enabled */}
      {mergedConfig.enabled && (
        <div className="space-y-4 pt-2 border-t border-gray-200">
          {/* Max Iterations */}
          <SliderControl
            label="最大迭代次数"
            value={mergedConfig.maxIterations}
            min={1}
            max={20}
            step={1}
            onChange={handleMaxIterationsChange}
            disabled={disabled}
            icon={<Repeat size={16} className="text-gray-500" />}
            description="达到此迭代次数后将停止执行"
          />

          {/* Max Cost */}
          <SliderControl
            label="最大成本 (USD)"
            value={mergedConfig.maxCostUsd}
            min={0.5}
            max={20}
            step={0.5}
            unit="$"
            onChange={handleMaxCostChange}
            disabled={disabled}
            icon={<DollarSign size={16} className="text-gray-500" />}
            description="成本超过此限制后将停止执行"
          />

          {/* Experience Trigger */}
          <DropdownControl
            label="经验学习触发时机"
            value={mergedConfig.experienceTrigger}
            options={experienceTriggerOptions}
            onChange={handleExperienceTriggerChange}
            disabled={disabled}
            icon={<Sparkles size={16} className="text-gray-500" />}
          />

          {/* Verify Completion (Optional) */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Code size={16} className="text-gray-500" />
              <label className="text-sm font-medium text-gray-700">
                验证函数 (可选)
              </label>
            </div>

            <textarea
              value={mergedConfig.verifyCompletion || ''}
              onChange={(e) => handleVerifyCompletionChange(e.target.value)}
              disabled={disabled}
              rows={4}
              placeholder="输入自定义验证脚本或代码..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed text-sm font-mono"
            />

            <p className="text-xs text-gray-500">
              可选：提供自定义验证逻辑。如不提供，将使用默认验证器检查输出完整性。
            </p>
          </div>
        </div>
      )}

      {/* Summary when disabled */}
      {!mergedConfig.enabled && (
        <div className="text-center py-4 text-gray-500">
          <p className="text-sm">
            启用 Ralph Loop 后可配置迭代执行参数
          </p>
        </div>
      )}
    </div>
  );
}

export default RalphLoopConfigPanel;