'use client';

import { ReactNode, forwardRef, HTMLAttributes } from 'react';

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  className?: string;
  orientation?: 'vertical' | 'horizontal' | 'both';
  scrollbar?: 'default' | 'sidebar' | 'content' | 'thin' | 'hidden';
}

const scrollbarClasses: Record<string, string> = {
  default: 'custom-scrollbar',
  sidebar: 'custom-scrollbar sidebar-scrollbar',
  content: 'custom-scrollbar content-scrollbar',
  thin: 'custom-scrollbar thin-scrollbar',
  hidden: 'overflow-auto scrollbar-hide',
};

const orientationClasses: Record<string, string> = {
  vertical: 'overflow-y-auto overflow-x-hidden',
  horizontal: 'overflow-x-auto overflow-y-hidden',
  both: 'overflow-auto',
};

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({
    children,
    className = '',
    orientation = 'vertical',
    scrollbar = 'default',
    ...props
  }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex-1 min-h-0 min-w-0 ${orientationClasses[orientation]} ${scrollbarClasses[scrollbar]} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

ScrollArea.displayName = 'ScrollArea';

interface VirtualScrollProps {
  children?: ReactNode;
  className?: string;
  maxHeight?: string | number;
}

export function VirtualScroll({
  children,
  className = '',
  maxHeight = '100%',
}: VirtualScrollProps) {
  const height = typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;
  
  return (
    <div 
      className={`overflow-y-auto custom-scrollbar content-scrollbar ${className}`}
      style={{ maxHeight: height }}
    >
      {children}
    </div>
  );
}

interface OverflowContainerProps {
  children?: ReactNode;
  className?: string;
  direction?: 'x' | 'y' | 'both';
}

export function OverflowContainer({
  children,
  className = '',
  direction = 'x',
}: OverflowContainerProps) {
  const overflowClass = direction === 'x' 
    ? 'overflow-x-auto overflow-y-hidden' 
    : direction === 'y' 
    ? 'overflow-y-auto overflow-x-hidden' 
    : 'overflow-auto';

  return (
    <div className={`min-w-0 min-h-0 ${overflowClass} custom-scrollbar ${className}`}>
      {children}
    </div>
  );
}