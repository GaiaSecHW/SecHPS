// src/components/ui/LoadingSpinner.tsx
'use client';

import { cn } from '@/lib/utils';

/**
 * 加载动画组件属性
 */
export interface LoadingSpinnerProps {
  /** 尺寸：sm | md | lg | xl */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** 颜色主题 */
  color?: 'blue' | 'gray' | 'white' | 'primary';
  /** 是否显示文字提示 */
  text?: string;
  /** 是否全屏居中 */
  fullscreen?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 尺寸映射
 */
const sizeMap = {
  sm: 'h-4 w-4 border',
  md: 'h-6 w-6 border-b-2',
  lg: 'h-8 w-8 border-b-2',
  xl: 'h-12 w-12 border-b-2 border-t-2',
};

/**
 * 颜色映射
 */
const colorMap = {
  blue: 'border-blue-500',
  gray: 'border-gray-500',
  white: 'border-white',
  primary: 'border-blue-600',
};

/**
 * 加载动画组件
 * 
 * 统一的加载状态展示组件，替代分散在各处的重复代码
 * 
 * @example
 * // 基础用法
 * <LoadingSpinner />
 * 
 * @example
 * // 带文字提示
 * <LoadingSpinner text="加载中..." />
 * 
 * @example
 * // 全屏居中
 * <LoadingSpinner fullscreen text="正在处理..." />
 * 
 * @example
 * // 不同尺寸
 * <LoadingSpinner size="sm" />
 * <LoadingSpinner size="lg" />
 */
export function LoadingSpinner({
  size = 'md',
  color = 'blue',
  text,
  fullscreen = false,
  className,
}: LoadingSpinnerProps) {
  const spinner = (
    <div className={cn('flex flex-col items-center justify-center gap-3', className)}>
      <div
        className={cn(
          'animate-spin rounded-full',
          sizeMap[size],
          colorMap[color]
        )}
        role="status"
        aria-label="加载中"
      />
      {text && (
        <span className="text-sm text-gray-500">{text}</span>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white/80 z-50">
        {spinner}
      </div>
    );
  }

  return spinner;
}

/**
 * 页面加载占位组件
 * 在页面数据加载时显示
 * 
 * @example
 * if (loading) return <PageLoading />;
 */
export function PageLoading({ text = '加载中...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <LoadingSpinner size="lg" text={text} />
    </div>
  );
}

/**
 * 内容区域加载占位组件
 * 
 * @example
 * if (loading) return <ContentLoading />;
 */
export function ContentLoading({ height = 'h-32' }: { height?: string }) {
  return (
    <div className={cn('flex items-center justify-center', height)}>
      <LoadingSpinner size="md" />
    </div>
  );
}

/**
 * 内联加载指示器
 * 用于按钮或小区域的加载状态
 * 
 * @example
 * <button disabled={loading}>
 *   {loading ? <InlineLoading /> : '提交'}
 * </button>
 */
export function InlineLoading({ className }: { className?: string }) {
  return (
    <LoadingSpinner size="sm" className={cn('inline-flex', className)} />
  );
}

/**
 * 高度可定制的加载遮罩组件
 * 用于覆盖在内容区域上方
 * 
 * @example
 * <div className="relative">
 *   <Content />
 *   {loading && <LoadingOverlay />}
 * </div>
 */
export function LoadingOverlay({ text }: { text?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10 rounded-lg">
      <LoadingSpinner size="lg" text={text} />
    </div>
  );
}
