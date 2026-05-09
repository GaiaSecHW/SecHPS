'use client';

import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary 组件
 *
 * 捕获子组件树中的 JavaScript 错误，记录错误并显示备用 UI。
 * 用于防止整个应用因组件错误而崩溃。
 *
 * @example
 * <ErrorBoundary>
 *   <MyComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // 更新 state 使下一次渲染能够显示备用 UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 记录错误信息
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // 可以在这里将错误日志上报到服务器
    // logErrorToService(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleGoHome = (): void => {
    window.location.href = '/dashboard';
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      // 如果提供了自定义 fallback，使用它
      if (fallback) {
        return fallback;
      }

      // 默认的错误 UI
      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-dark-surface rounded-lg shadow-lg border border-gray-700/50 p-6">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-900/20 rounded-full mb-4">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>

            <h2 className="text-xl font-semibold text-gray-100 text-center mb-2">
              页面出现错误
            </h2>

            <p className="text-gray-400 text-center mb-4">
              很抱歉，页面加载时出现了问题。您可以尝试刷新页面或返回首页。
            </p>

            {process.env.NODE_ENV === 'development' && error && (
              <div className="mb-4 p-3 bg-[#0F172A] rounded-md overflow-auto max-h-32">
                <p className="text-sm font-mono text-red-400 whitespace-pre-wrap">
                  {error.message}
                </p>
              </div>
            )}

            <div className="flex items-center justify-center space-x-3">
              <button
                onClick={this.handleRetry}
                className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span>重试</span>
              </button>

              <button
                onClick={this.handleGoHome}
                className="flex items-center space-x-2 px-4 py-2 bg-dark-surface border border-gray-600 text-gray-300 rounded-md hover:bg-dark-surface-hover transition-colors"
              >
                <Home className="w-4 h-4" />
                <span>返回首页</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}

/**
 * 用于包装页面组件的简化版本
 * 显示更简洁的错误 UI
 */
export class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('PageErrorBoundary caught an error:', error);
    this.setState({ error, errorInfo });
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
          <h3 className="text-lg font-medium text-gray-100 mb-2">加载失败</h3>
          <p className="text-gray-500 mb-4">页面加载时出现错误</p>
          <button
            onClick={this.handleRetry}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>重新加载</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
