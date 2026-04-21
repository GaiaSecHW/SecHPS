// src/components/ui/index.ts
/**
 * UI 组件统一导出
 * 
 * 使用方式：
 * import { LoadingSpinner, Alert, Modal } from '@/components/ui';
 */

export {
  LoadingSpinner,
  PageLoading,
  ContentLoading,
  InlineLoading,
  LoadingOverlay,
} from './LoadingSpinner';

export type { LoadingSpinnerProps } from './LoadingSpinner';

export {
  Alert,
  ErrorAlert,
  SuccessAlert,
  WarningAlert,
  InfoAlert,
  InlineError,
} from './Alert';

export type { AlertProps, AlertType } from './Alert';

export {
  Modal,
  ConfirmDialog,
  ModalFooter,
  CancelButton,
  ConfirmButton,
} from './Modal';

export type { ModalProps, ConfirmDialogProps } from './Modal';
