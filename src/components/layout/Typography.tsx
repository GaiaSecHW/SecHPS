'use client';

import { ReactNode } from 'react';

interface PageTitleProps {
  children?: ReactNode;
  className?: string;
  as?: 'h1' | 'h2';
}

export function PageTitle({
  children,
  className = '',
  as = 'h1',
}: PageTitleProps) {
  const Element = as;
  
  return (
    <Element className={`text-xl md:text-2xl lg:text-3xl font-semibold text-zinc-100 tracking-tight ${className}`}>
      {children}
    </Element>
  );
}

interface SectionTitleProps {
  children?: ReactNode;
  className?: string;
  as?: 'h2' | 'h3' | 'h4';
}

export function SectionTitle({
  children,
  className = '',
  as = 'h2',
}: SectionTitleProps) {
  const Element = as;
  
  return (
    <Element className={`text-lg md:text-xl font-semibold text-zinc-100 ${className}`}>
      {children}
    </Element>
  );
}

interface DescriptionProps {
  children?: ReactNode;
  className?: string;
}

export function Description({
  children,
  className = '',
}: DescriptionProps) {
  return (
    <p className={`text-sm md:text-base text-zinc-400 leading-relaxed ${className}`}>
      {children}
    </p>
  );
}

interface LabelProps {
  children?: ReactNode;
  className?: string;
  muted?: boolean;
}

export function Label({
  children,
  className = '',
  muted = false,
}: LabelProps) {
  return (
    <span className={`text-xs md:text-sm font-medium ${muted ? 'text-zinc-500' : 'text-zinc-300'} ${className}`}>
      {children}
    </span>
  );
}

interface TextProps {
  children?: ReactNode;
  className?: string;
  size?: 'sm' | 'base' | 'lg';
  color?: 'primary' | 'secondary' | 'muted' | 'accent';
}

const textSizeClasses: Record<string, string> = {
  sm: 'text-xs md:text-sm',
  base: 'text-sm md:text-base',
  lg: 'text-base md:text-lg',
};

const textColorClasses: Record<string, string> = {
  primary: 'text-zinc-100',
  secondary: 'text-zinc-300',
  muted: 'text-zinc-400',
  accent: 'text-cyan-400',
};

export function Text({
  children,
  className = '',
  size = 'base',
  color = 'primary',
}: TextProps) {
  return (
    <span className={`${textSizeClasses[size]} ${textColorClasses[color]} ${className}`}>
      {children}
    </span>
  );
}

interface BadgeProps {
  children?: ReactNode;
  className?: string;
  color?: 'cyan' | 'emerald' | 'amber' | 'rose' | 'violet' | 'gray';
  size?: 'sm' | 'md';
}

const badgeColorClasses: Record<string, string> = {
  cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  rose: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  violet: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  gray: 'bg-zinc-700/50 text-zinc-400 border-zinc-700',
};

const badgeSizeClasses: Record<string, string> = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-1 text-xs',
};

export function Badge({
  children,
  className = '',
  color = 'gray',
  size = 'md',
}: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded border ${badgeColorClasses[color]} ${badgeSizeClasses[size]} font-medium ${className}`}>
      {children}
    </span>
  );
}