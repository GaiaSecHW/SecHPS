// src/components/ui/Modal.tsx
'use client';

import { useEffect, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Modal 组件属性
 */
export interface ModalProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 标题 */
  title?: string;
  /** 子内容 */
  children: React.ReactNode;
  /** 尺寸 */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** 是否显示关闭按钮 */
  showCloseButton?: boolean;
  /** 点击遮罩是否关闭 */
  closeOnOverlayClick?: boolean;
  /** 按 ESC 是否关闭 */
  closeOnEsc?: boolean;
  /** 自定义类名（容器） */
  className?: string;
  /** 自定义类名（内容区域） */
  contentClassName?: string;
  /** 是否显示底部按钮区域 */
  showFooter?: boolean;
  /** 底部内容 */
  footer?: React.ReactNode;
}

/**
 * Modal 尺寸映射
 */
const sizeMap = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[90vw]',
};

/**
 * 通用模态框组件
 * 
 * 统一的模态框实现，替代分散在各处的重复代码
 * 
 * @example
 * <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="创建用户">
 *   <form>...</form>
 * </Modal>
 * 
 * @example
 * // 带底部按钮
 * <Modal 
 *   isOpen={isOpen} 
 *   onClose={handleClose}
 *   footer={
 *     <>
 *       <Button variant="outline" onClick={handleClose}>取消</Button>
 *       <Button onClick={handleSubmit}>确认</Button>
 *     </>
 *   }
 * >
 *   <div>内容</div>
 * </Modal>
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  className,
  contentClassName,
  showFooter = false,
  footer,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // 处理 ESC 键关闭
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEsc) {
        onClose();
      }
    },
    [closeOnEsc, onClose]
  );

  // 处理点击遮罩关闭
  const handleOverlayClick = useCallback(
    (event: React.MouseEvent) => {
      if (closeOnOverlayClick && event.target === event.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlayClick, onClose]
  );

  // 添加/移除键盘事件监听
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  // 不渲染
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div
        ref={modalRef}
        className={cn(
          'bg-white rounded-lg shadow-xl w-full max-h-[90vh] flex flex-col',
          sizeMap[size],
          className
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            {title && (
              <h2 id="modal-title" className="text-lg font-semibold text-gray-900">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className={cn('flex-1 overflow-y-auto', contentClassName)}>
          {children}
        </div>

        {/* Footer */}
        {showFooter && footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 确认对话框属性
 */
export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
}

/**
 * 确认对话框
 * 
 * 替代原生 confirm() 的 React 实现
 * 
 * @example
 * const [showConfirm, setShowConfirm] = useState(false);
 * 
 * <ConfirmDialog
 *   isOpen={showConfirm}
 *   onClose={() => setShowConfirm(false)}
 *   onConfirm={handleDelete}
 *   title="删除确认"
 *   message="确定要删除此项吗？此操作不可撤销。"
 *   variant="danger"
 *   confirmText="删除"
 * />
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = '确认操作',
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'info',
  loading = false,
}: ConfirmDialogProps) {
  const variantStyles = {
    danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    warning: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
    info: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      showCloseButton={false}
    >
      <div className="px-6 py-4">
        <p className="text-gray-600">{message}</p>
      </div>
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={cn(
            'px-4 py-2 text-sm font-medium text-white rounded-md transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2',
            variantStyles[variant]
          )}
        >
          {loading ? '处理中...' : confirmText}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Modal 底部按钮组件
 */
export function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-3">
      {children}
    </div>
  );
}

/**
 * 取消按钮组件
 */
export function CancelButton({
  onClick,
  children = '取消',
  disabled = false,
}: {
  onClick: () => void;
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * 确认按钮组件
 */
export function ConfirmButton({
  onClick,
  children = '确认',
  disabled = false,
  loading = false,
  variant = 'primary',
}: {
  onClick: () => void;
  children?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'danger';
}) {
  const variantStyles = {
    primary: 'bg-blue-600 hover:bg-blue-700',
    danger: 'bg-red-600 hover:bg-red-700',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'px-4 py-2 text-sm font-medium text-white rounded-md transition-colors disabled:opacity-50 flex items-center gap-2',
        variantStyles[variant]
      )}
    >
      {loading && (
        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
      )}
      {children}
    </button>
  );
}
