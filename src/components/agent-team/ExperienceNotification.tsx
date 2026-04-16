'use client';

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Lightbulb,
  X,
  RefreshCw,
} from 'lucide-react';

// ============ Props Interface ============

interface ExperienceNotificationProps {
  iteration: number;
  experiencesFound: number;
  experienceTitles: string[];
  guidanceInjected: string;
  variant?: 'inline' | 'toast';
  onDismiss?: () => void;
}

// ============ Helper Functions ============

function truncateGuidance(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// ============ Sub Components ============

interface ExperienceBadgeProps {
  count: number;
}

function ExperienceBadge({ count }: ExperienceBadgeProps) {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800 border border-purple-200">
      <Sparkles size={14} className="mr-1.5" />
      {count} 条经验
    </span>
  );
}

interface ExperienceTitleListProps {
  titles: string[];
  maxVisible?: number;
}

function ExperienceTitleList({ titles, maxVisible = 3 }: ExperienceTitleListProps) {
  const visibleTitles = titles.slice(0, maxVisible);
  const hiddenCount = titles.length - maxVisible;

  return (
    <div className="space-y-1">
      {visibleTitles.map((title, index) => (
        <div key={index} className="flex items-start space-x-2">
          <BookOpen size={14} className="text-purple-500 mt-0.5" />
          <span className="text-sm text-gray-700">{title}</span>
        </div>
      ))}
      {hiddenCount > 0 && (
        <p className="text-xs text-gray-500 pl-5">
          还有 {hiddenCount} 条经验...
        </p>
      )}
    </div>
  );
}

// ============ Toast Notification ============

export function showExperienceToast(
  iteration: number,
  experiencesFound: number,
  experienceTitles: string[]
) {
  toast.custom(
    (t) => (
      <div
        className={`${
          t.visible ? 'animate-enter' : 'animate-leave'
        } max-w-md w-full bg-white shadow-lg rounded-lg border border-purple-200 pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
      >
        <div className="flex-1 w-0 p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0 pt-0.5">
              <Sparkles size={20} className="text-purple-500" />
            </div>
            <div className="ml-3 flex-1">
              <p className="text-sm font-medium text-gray-900">
                经验学习已触发
              </p>
              <p className="mt-1 text-sm text-gray-500">
                迭代 #{iteration}: 查询到 {experiencesFound} 条相关经验
              </p>
              {experienceTitles.length > 0 && (
                <div className="mt-2 text-xs text-gray-600">
                  {experienceTitles.slice(0, 2).join(', ')}
                  {experienceTitles.length > 2 && '...'}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex border-l border-gray-200">
          <button
            onClick={() => toast.dismiss(t.id)}
            className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-gray-600 hover:text-gray-500 focus:outline-none"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    ),
    {
      duration: 5000,
      position: 'top-right',
      icon: <Sparkles size={16} className="text-purple-500" />,
    }
  );
}

// ============ Inline Notification Component ============

export function ExperienceNotification({
  iteration,
  experiencesFound,
  experienceTitles,
  guidanceInjected,
  variant = 'inline',
  onDismiss,
}: ExperienceNotificationProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Auto-dismiss after 10 seconds if not expanded
  useEffect(() => {
    if (!isExpanded && variant === 'inline') {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onDismiss?.();
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [isExpanded, variant, onDismiss]);

  if (!isVisible) return null;

  const handleDismiss = () => {
    setIsVisible(false);
    onDismiss?.();
  };

  if (variant === 'toast') {
    // Use toast notification
    showExperienceToast(iteration, experiencesFound, experienceTitles);
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 p-4 animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
              <Sparkles size={20} className="text-purple-600" />
            </div>
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <h4 className="text-sm font-semibold text-gray-900">
                经验学习已触发
              </h4>
              <ExperienceBadge count={experiencesFound} />
            </div>
            <p className="text-xs text-gray-600 mt-0.5">
              迭代 #{iteration} - 从历史失败序列中学习
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {isExpanded ? (
              <ChevronUp size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
          </button>

          <button
            onClick={handleDismiss}
            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="mt-4 pt-3 border-t border-purple-200 space-y-3">
          {/* Experience Titles */}
          {experienceTitles.length > 0 && (
            <div>
              <div className="flex items-center space-x-1 mb-2">
                <BookOpen size={14} className="text-purple-500" />
                <span className="text-xs font-medium text-gray-700">
                  相关经验
                </span>
              </div>
              <ExperienceTitleList titles={experienceTitles} />
            </div>
          )}

          {/* Guidance Injected */}
          {guidanceInjected && (
            <div>
              <div className="flex items-center space-x-1 mb-2">
                <Lightbulb size={14} className="text-yellow-500" />
                <span className="text-xs font-medium text-gray-700">
                  注入指导
                </span>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {truncateGuidance(guidanceInjected, 300)}
                </p>
              </div>
            </div>
          )}

          {/* Info */}
          <div className="flex items-center space-x-2 text-xs text-gray-500">
            <RefreshCw size={12} />
            <span>
              这些经验将用于指导本轮迭代，帮助避免重复错误
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExperienceNotification;