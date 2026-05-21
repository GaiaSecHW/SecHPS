'use client';

import { ReactNode } from 'react';

interface ContainerProps {
  children?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' | 'prose';
  as?: 'div' | 'section' | 'article' | 'main';
  padding?: boolean;
  center?: boolean;
}

const sizeClasses: Record<string, string> = {
  sm: 'max-w-3xl',
  md: 'max-w-4xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
  '2xl': 'max-w-screen-2xl',
  full: 'max-w-full',
  prose: 'max-w-3xl prose-container',
};

export function Container({
  children,
  className = '',
  size = '2xl',
  as = 'div',
  padding = true,
  center = true,
}: ContainerProps) {
  const Element = as;
  
  const classes = `
    w-full
    ${sizeClasses[size]}
    ${center ? 'mx-auto' : ''}
    ${padding ? 'px-4 md:px-6 lg:px-8' : ''}
    ${className}
  `;

  return (
    <Element className={classes}>
      {children}
    </Element>
  );
}

interface PageContainerProps {
  children?: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  padding?: boolean;
}

export function PageContainer({
  children,
  className = '',
  title,
  description,
  actions,
  padding = true,
}: PageContainerProps) {
  return (
    <div className={`min-h-full flex flex-col ${className}`}>
      {(title || actions) && (
        <div className={`flex items-center justify-between gap-4 flex-wrap ${padding ? 'px-4 md:px-6 lg:px-8 py-4 md:py-6' : 'py-4'}`}>
          <div className="flex-1 min-w-0">
            {title && (
              <h1 className="text-xl md:text-2xl font-semibold text-zinc-100 truncate">
                {title}
              </h1>
            )}
            {description && (
              <p className="text-sm md:text-base text-zinc-400 mt-1 truncate">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {actions}
            </div>
          )}
        </div>
      )}
      
      <div className={`flex-1 ${padding ? 'px-4 md:px-6 lg:px-8 pb-6' : ''}`}>
        {children}
      </div>
    </div>
  );
}

interface ContentContainerProps {
  children?: ReactNode;
  className?: string;
  maxWidth?: 'prose' | 'narrow' | 'medium' | 'wide';
}

const maxWidthClasses: Record<string, string> = {
  prose: 'max-w-3xl',
  narrow: 'max-w-2xl',
  medium: 'max-w-4xl',
  wide: 'max-w-5xl',
};

export function ContentContainer({
  children,
  className = '',
  maxWidth = 'prose',
}: ContentContainerProps) {
  return (
    <div className={`w-full ${maxWidthClasses[maxWidth]} mx-auto ${className}`}>
      {children}
    </div>
  );
}