'use client';

import { ReactNode } from 'react';

interface CardProps {
  children?: ReactNode;
  className?: string;
  variant?: 'default' | 'surface' | 'outline' | 'ghost';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  as?: 'div' | 'article' | 'section';
}

const variantClasses: Record<string, string> = {
  default: 'bg-zinc-900 border border-zinc-800',
  surface: 'bg-zinc-900/50 border border-zinc-800/50',
  outline: 'bg-transparent border border-zinc-800',
  ghost: 'bg-transparent border-0',
};

const paddingClasses: Record<string, string> = {
  none: 'p-0',
  sm: 'p-3 md:p-4',
  md: 'p-4 md:p-5',
  lg: 'p-5 md:p-6',
};

export function Card({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
  hover = false,
  as = 'div',
}: CardProps) {
  const Element = as;
  
  const classes = `
    rounded-xl
    flex
    flex-col
    min-w-0
    min-h-0
    overflow-hidden
    ${variantClasses[variant]}
    ${paddingClasses[padding]}
    ${hover ? 'transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-800/50' : ''}
    ${className}
  `;

  return (
    <Element className={classes}>
      {children}
    </Element>
  );
}

interface CardHeaderProps {
  children?: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  border?: boolean;
}

export function CardHeader({
  children,
  className = '',
  title,
  description,
  icon,
  actions,
  border = false,
}: CardHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 flex-wrap ${border ? 'border-b border-zinc-800 pb-4 mb-4' : ''} ${className}`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {icon && (
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center">
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          {title && (
            <h3 className="text-base md:text-lg font-semibold text-zinc-100 truncate">
              {title}
            </h3>
          )}
          {description && (
            <p className="text-sm text-zinc-400 mt-0.5 truncate">
              {description}
            </p>
          )}
          {children}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}

interface CardContentProps {
  children?: ReactNode;
  className?: string;
  scroll?: boolean;
}

export function CardContent({
  children,
  className = '',
  scroll = false,
}: CardContentProps) {
  return (
    <div className={`flex-1 min-h-0 min-w-0 ${scroll ? 'overflow-y-auto custom-scrollbar' : ''} ${className}`}>
      {children}
    </div>
  );
}

interface CardFooterProps {
  children?: ReactNode;
  className?: string;
  border?: boolean;
}

export function CardFooter({
  children,
  className = '',
  border = false,
}: CardFooterProps) {
  return (
    <div className={`flex items-center justify-between gap-4 flex-wrap ${border ? 'border-t border-zinc-800 pt-4 mt-4' : ''} ${className}`}>
      {children}
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  color?: 'cyan' | 'emerald' | 'amber' | 'rose' | 'violet' | 'purple';
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  className?: string;
}

const colorClasses: Record<string, { bg: string; iconBg: string; text: string }> = {
  cyan: { bg: 'bg-cyan-500/10', iconBg: 'bg-gradient-to-br from-cyan-400 to-blue-500', text: 'text-cyan-400' },
  emerald: { bg: 'bg-emerald-500/10', iconBg: 'bg-gradient-to-br from-emerald-400 to-green-500', text: 'text-emerald-400' },
  amber: { bg: 'bg-amber-500/10', iconBg: 'bg-gradient-to-br from-amber-400 to-orange-500', text: 'text-amber-400' },
  rose: { bg: 'bg-rose-500/10', iconBg: 'bg-gradient-to-br from-rose-400 to-red-500', text: 'text-rose-400' },
  violet: { bg: 'bg-violet-500/10', iconBg: 'bg-gradient-to-br from-violet-400 to-purple-500', text: 'text-violet-400' },
  purple: { bg: 'bg-purple-500/10', iconBg: 'bg-gradient-to-br from-purple-400 to-violet-500', text: 'text-purple-400' },
};

export function MetricCard({
  label,
  value,
  icon,
  color = 'cyan',
  trend,
  trendValue,
  className = '',
}: MetricCardProps) {
  const style = colorClasses[color];

  return (
    <div className={`${style.bg} rounded-lg p-3 md:p-4 border border-zinc-800/50 min-w-0 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        {icon && (
          <div className={`w-7 h-7 md:w-8 md:h-8 ${style.iconBg} rounded-lg flex items-center justify-center`}>
            <div className="text-white text-sm">{icon}</div>
          </div>
        )}
        {trend && (
          <span className={`text-xs ${trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-rose-400' : 'text-zinc-400'}`}>
            {trendValue}
          </span>
        )}
      </div>
      <div className="text-lg md:text-xl font-bold text-zinc-100 truncate">{value}</div>
      <div className={`text-xs ${style.text} mt-0.5 truncate`}>{label}</div>
    </div>
  );
}