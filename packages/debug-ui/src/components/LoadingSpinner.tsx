import { cn } from '../lib/utils';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: 'blue' | 'gray' | 'white' | 'primary';
  text?: string;
  className?: string;
}

const sizeMap = {
  sm: 'h-4 w-4 border',
  md: 'h-6 w-6 border-b-2',
  lg: 'h-8 w-8 border-b-2',
  xl: 'h-12 w-12 border-b-2 border-t-2',
};

const colorMap = {
  blue: 'border-blue-400',
  gray: 'border-gray-500',
  white: 'border-white',
  primary: 'border-blue-500',
};

export function LoadingSpinner({
  size = 'md',
  color = 'primary',
  text,
  className,
}: LoadingSpinnerProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3', className)}>
      <div
        className={cn('animate-spin rounded-full', sizeMap[size], colorMap[color])}
        role="status"
        aria-label="加载中"
      />
      {text && <span className="text-sm text-gray-400">{text}</span>}
    </div>
  );
}
