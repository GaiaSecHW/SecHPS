// src/components/ui/Alert.tsx
'use client';

import { AlertCircle, CheckCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AlertType = 'error' | 'success' | 'warning' | 'info';

export interface AlertProps {
  type?: AlertType;
  title?: string;
  children?: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  showIcon?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

const typeConfig = {
  error: {
    container: 'bg-red-900/20 border border-red-800/40 text-red-300',
    icon: AlertCircle,
    iconClass: 'text-red-400',
  },
  success: {
    container: 'bg-green-900/20 border border-green-800/40 text-green-300',
    icon: CheckCircle,
    iconClass: 'text-green-400',
  },
  warning: {
    container: 'bg-yellow-900/20 border border-yellow-800/40 text-yellow-300',
    icon: AlertTriangle,
    iconClass: 'text-yellow-400',
  },
  info: {
    container: 'bg-blue-900/20 border border-blue-800/40 text-blue-300',
    icon: Info,
    iconClass: 'text-blue-400',
  },
};

export function Alert({
  type = 'info',
  title,
  children,
  dismissible = false,
  onDismiss,
  showIcon = true,
  icon,
  className,
}: AlertProps) {
  const config = typeConfig[type];
  const IconComponent = config.icon;

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg flex items-start gap-3',
        config.container,
        className
      )}
      role="alert"
    >
      {showIcon && (
        <div className={cn('flex-shrink-0 mt-0.5', config.iconClass)}>
          {icon || <IconComponent size={18} />}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {title && (
          <h4 className="font-medium mb-1">{title}</h4>
        )}
        {children && (
          <div className="text-sm opacity-90">{children}</div>
        )}
      </div>
      {dismissible && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            'flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors',
            config.iconClass
          )}
          aria-label="关闭"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function ErrorAlert({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Alert type="error" className={className}>{children}</Alert>;
}

export function SuccessAlert({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Alert type="success" className={className}>{children}</Alert>;
}

export function WarningAlert({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Alert type="warning" className={className}>{children}</Alert>;
}

export function InfoAlert({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Alert type="info" className={className}>{children}</Alert>;
}

export function InlineError({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('text-sm text-red-400 flex items-center gap-1', className)}>
      <AlertCircle size={14} />
      <span>{children}</span>
    </div>
  );
}
