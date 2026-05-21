'use client';

import { ReactNode } from 'react';

interface ResponsiveGridProps {
  children?: ReactNode;
  className?: string;
  minItemWidth?: number | string;
  maxColumns?: number;
  gap?: 'sm' | 'md' | 'lg' | 'xl';
  as?: 'div' | 'section' | 'ul';
}

const gapClasses: Record<string, string> = {
  sm: 'gap-3',
  md: 'gap-4 md:gap-5',
  lg: 'gap-5 md:gap-6',
  xl: 'gap-6 md:gap-8',
};

export function ResponsiveGrid({
  children,
  className = '',
  minItemWidth = 280,
  maxColumns = 4,
  gap = 'md',
  as = 'div',
}: ResponsiveGridProps) {
  const Element = as;
  
  const minWidth = typeof minItemWidth === 'number' ? `${minItemWidth}px` : minItemWidth;
  
  const classes = `
    grid
    w-full
    ${gapClasses[gap]}
    grid-cols-1
    md:grid-cols-2
    lg:grid-cols-[repeat(auto-fit,minmax(${minWidth},1fr))]
    ${className}
  `;

  return (
    <Element 
      className={classes}
      style={{ 
        maxWidth: maxColumns ? `calc(${maxColumns} * ${minWidth} + ${maxColumns - 1} * 1rem)` : undefined 
      }}
    >
      {children}
    </Element>
  );
}

interface FixedGridProps {
  children?: ReactNode;
  className?: string;
  cols?: {
    base?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
    '2xl'?: number;
  };
  gap?: 'sm' | 'md' | 'lg' | 'xl';
}

export function FixedGrid({
  children,
  className = '',
  cols = { base: 1, md: 2, lg: 3, xl: 4 },
  gap = 'md',
}: FixedGridProps) {
  const colClasses = [
    cols.base && `grid-cols-${cols.base}`,
    cols.sm && `sm:grid-cols-${cols.sm}`,
    cols.md && `md:grid-cols-${cols.md}`,
    cols.lg && `lg:grid-cols-${cols.lg}`,
    cols.xl && `xl:grid-cols-${cols.xl}`,
    cols['2xl'] && `2xl:grid-cols-${cols['2xl']}`,
  ].filter(Boolean).join(' ');

  return (
    <div className={`grid w-full ${colClasses} ${gapClasses[gap]} ${className}`}>
      {children}
    </div>
  );
}

interface BentoGridProps {
  children?: ReactNode;
  className?: string;
}

export function BentoGrid({
  children,
  className = '',
}: BentoGridProps) {
  return (
    <div className={`grid grid-cols-12 gap-4 md:gap-5 w-full ${className}`}>
      {children}
    </div>
  );
}

interface BentoItemProps {
  children?: ReactNode;
  className?: string;
  colSpan?: {
    base?: number;
    md?: number;
    lg?: number;
  };
  rowSpan?: number;
}

export function BentoItem({
  children,
  className = '',
  colSpan = { base: 12, md: 6, lg: 4 },
  rowSpan = 1,
}: BentoItemProps) {
  const colClasses = [
    `col-span-${colSpan.base || 12}`,
    colSpan.md && `md:col-span-${colSpan.md}`,
    colSpan.lg && `lg:col-span-${colSpan.lg}`,
  ].filter(Boolean).join(' ');

  return (
    <div 
      className={`min-h-0 ${colClasses} ${className}`}
      style={{ gridRow: rowSpan > 1 ? `span ${rowSpan}` : undefined }}
    >
      {children}
    </div>
  );
}