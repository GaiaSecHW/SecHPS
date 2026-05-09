'use client';

import { FolderOpen, Cpu, Code2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface StatusBarProps {
  cwd?: string;
  model?: string;
  version?: string;
  provider?: 'claude' | 'cursor' | 'codex' | 'gemini';
  sessionCount?: number;
}

export default function StatusBar({
  cwd,
  model,
  version,
  provider = 'claude',
  sessionCount,
}: StatusBarProps): ReactNode {
  const getProviderIcon = (): ReactNode => {
    switch (provider) {
      case 'claude':
        return '✨';
      case 'cursor':
        return <Code2 size={14} className="text-purple-500" />;
      case 'codex':
        return <Cpu size={14} className="text-green-500" />;
      case 'gemini':
        return '🌟';
      default:
        return '🤖';
    }
  };

  const getProviderName = (): string => {
    switch (provider) {
      case 'claude':
        return 'Claude';
      case 'cursor':
        return 'Cursor';
      case 'codex':
        return 'Codex';
      case 'gemini':
        return 'Gemini';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="h-7 bg-dark-surface border-t border-gray-700/50 flex items-center px-3 text-xs text-gray-400">
      {cwd && (
        <div className="flex items-center gap-1 mr-4">
          <FolderOpen size={12} />
          <span className="truncate max-w-xs" title={cwd}>
            {cwd}
          </span>
        </div>
      )}

      <div className="flex items-center gap-1 mr-4">
        {getProviderIcon()}
        <span>{getProviderName()}</span>
        {model && (
          <span className="text-gray-500 ml-1">{model}</span>
        )}
      </div>

      {version && (
        <div className="text-gray-500">
          v{version}
        </div>
      )}

      {sessionCount !== undefined && (
        <div className="ml-auto text-gray-500">
          {sessionCount} 会话
        </div>
      )}
    </div>
  );
}
