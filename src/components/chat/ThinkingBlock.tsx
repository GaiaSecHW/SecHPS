'use client';

import { useState } from 'react';
import { Brain, ChevronDown, ChevronUp } from 'lucide-react';

interface ThinkingBlockProps {
  content: string;
  isExpanded?: boolean;
  className?: string;
}

export function ThinkingBlock({
  content,
  isExpanded = false,
  className = '',
}: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(isExpanded);

  if (!content.trim()) {
    return null;
  }

  return (
    <div className={`bg-gray-50 border border-gray-200 rounded-lg ${className}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-100 transition-colors rounded-lg"
      >
        <div className="flex items-center space-x-2">
          <Brain size={16} className="text-purple-600" />
          <span className="text-sm font-medium text-gray-700">思考过程</span>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="text-gray-500" />
        ) : (
          <ChevronDown size={16} className="text-gray-500" />
        )}
      </button>

      {expanded && (
        <div className="px-3 py-2 border-t border-gray-200">
          <div className="text-sm text-gray-600 italic whitespace-pre-wrap leading-relaxed">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}
