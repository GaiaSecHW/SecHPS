// src/components/ui/LoadingSpinner.tsx
'use client';

import { cn } from '@/lib/utils';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: 'blue' | 'gray' | 'white' | 'primary';
  text?: string;
  fullscreen?: boolean;
  className?: string;
}

const sizeMap = {
  sm: 'h-4 w-4 border',
  md: 'h-6 w-6 border-b-2',
  lg: 'h-8 w-8 border-b-2',
  xl: 'h-12 w-12 border-b-2 border-t-2',
};

const colorMap = {
  blue: 'border-primary-400',
  gray: 'border-gray-500',
  white: 'border-white',
  primary: 'border-primary-500',
};

export function LoadingSpinner({
  size = 'md',
  color = 'primary',
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
        <span className="text-sm text-gray-400">{text}</span>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0B1120]/80 backdrop-blur-sm z-50">
        {spinner}
      </div>
    );
  }

  return spinner;
}

export function PageLoading({ text = '加载中...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <LoadingSpinner size="lg" text={text} />
    </div>
  );
}

export function ContentLoading({ height = 'h-32' }: { height?: string }) {
  return (
    <div className={cn('flex items-center justify-center', height)}>
      <LoadingSpinner size="md" />
    </div>
  );
}

export function InlineLoading({ className }: { className?: string }) {
  return (
    <LoadingSpinner size="sm" className={cn('inline-flex', className)} />
  );
}

export function LoadingOverlay({ text }: { text?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0B1120]/60 backdrop-blur-sm z-10 rounded-lg">
      <LoadingSpinner size="lg" text={text} />
    </div>
  );
}
