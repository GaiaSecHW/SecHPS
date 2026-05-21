'use client';

import { ReactNode } from 'react';

interface HeaderProps {
  children?: ReactNode;
  className?: string;
  height?: number;
}

export function Header({
  children,
  className = '',
  height = 56,
}: HeaderProps) {
  return (
    <header
      className={`sticky top-0 z-20 bg-zinc-900/80 backdrop-blur-sm border-b border-zinc-800 flex-shrink-0 ${className}`}
      style={{ height }}
    >
      <div className="h-full flex items-center justify-between px-4 md:px-6 lg:px-8 gap-4">
        {children}
      </div>
    </header>
  );
}

interface HeaderLeftProps {
  children?: ReactNode;
  className?: string;
}

export function HeaderLeft({ children, className = '' }: HeaderLeftProps) {
  return (
    <div className={`flex items-center gap-4 flex-1 min-w-0 ${className}`}>
      {children}
    </div>
  );
}

interface HeaderCenterProps {
  children?: ReactNode;
  className?: string;
}

export function HeaderCenter({ children, className = '' }: HeaderCenterProps) {
  return (
    <div className={`flex items-center justify-center flex-shrink-0 ${className}`}>
      {children}
    </div>
  );
}

interface HeaderRightProps {
  children?: ReactNode;
  className?: string;
}

export function HeaderRight({ children, className = '' }: HeaderRightProps) {
  return (
    <div className={`flex items-center gap-3 flex-shrink-0 ${className}`}>
      {children}
    </div>
  );
}