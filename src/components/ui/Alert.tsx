// src/components/ui/Alert.tsx
'use client';

import { AlertCircle, CheckCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Alert 类型
 */
export type AlertType = 'error' | 'success' | 'warning' | 'info';

/**
 * Alert 组件属性
 */
export interface AlertProps {
  /** Alert 类型 */
  type?: AlertType;
  /** Alert 标题 */
  title?: string;
  /** Alert 内容 */
  children?: React.ReactNode;
  /** 是否可关闭 */
  dismissible?: boolean;
  /** 关闭回调 */
  onDismiss?: () => void;
  /** 是否显示图标 */
  showIcon?: boolean;
  /** 自定义图标 */
  icon?: React.ReactNode;
  /** 自定义类名 */
  className?: string;
}

/**
 * 类型配置映射
 */
const typeConfig = {
  error: {
    container: 'bg-red-50 border border-red-200 text-red-700',
    icon: AlertCircle,
    iconClass: 'text-red-500',
  },
  success: {
    container: 'bg-green-50 border border-green-200 text-green-700',
    icon: CheckCircle,
    iconClass: 'text-green-500',
  },
  warning: {
    container: 'bg-yellow-50 border border-yellow-200 text-yellow-700',
    icon: AlertTriangle,
    iconClass: 'text-yellow-500',
  },
  info: {
    container: 'bg-blue-50 border border-blue-200 text-blue-700',
    icon: Info,
    iconClass: 'text-blue-500',
  },
};

/**
 * Alert 提示组件
 * 
 * 统一的提示消息展示组件，支持多种类型
 * 
 * @example
 * // 错误提示
 * <Alert type="error">操作失败</Alert>
 * 
 * @example
 * // 成功提示带标题
 * <Alert type="success" title="保存成功">
 *   您的更改已保存
 * </Alert>
 * 
 * @example
 * // 可关闭提示
 * <Alert type="warning" dismissible onDismiss={() => setShow(false)}>
 *   请注意风险
 * </Alert>
 */
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
            'flex-shrink-0 p-1 rounded hover:bg-black/5 transition-colors',
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

/**
 * 错误提示快捷组件
 */
export function ErrorAlert({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Alert type="error" className={className}>
      {children}
    </Alert>
  );
}

/**
 * 成功提示快捷组件
 */
export function SuccessAlert({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Alert type="success" className={className}>
      {children}
    </Alert>
  );
}

/**
 * 警告提示快捷组件
 */
export function WarningAlert({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Alert type="warning" className={className}>
      {children}
    </Alert>
  );
}

/**
 * 信息提示快捷组件
 */
export function InfoAlert({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Alert type="info" className={className}>
      {children}
    </Alert>
  );
}

/**
 * 内联错误提示（用于表单等场景）
 */
export function InlineError({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('text-sm text-red-600 flex items-center gap-1', className)}>
      <AlertCircle size={14} />
      <span>{children}</span>
    </div>
  );
}
