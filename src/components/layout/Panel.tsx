'use client';

import { ReactNode, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeft } from 'lucide-react';

interface PanelProps {
  children?: ReactNode;
  className?: string;
  position?: 'left' | 'right';
  defaultOpen?: boolean;
  width?: number | string;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  collapsible?: boolean;
  overlay?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Panel({
  children,
  className = '',
  position = 'right',
  defaultOpen = true,
  width = 320,
  minWidth = 240,
  maxWidth = 480,
  resizable = false,
  collapsible = true,
  overlay = false,
  onOpenChange,
}: PanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [currentWidth, setCurrentWidth] = useState(typeof width === 'number' ? width : parseInt(width));

  const togglePanel = useCallback(() => {
    const newState = !isOpen;
    setIsOpen(newState);
    onOpenChange?.(newState);
  }, [isOpen, onOpenChange]);

  const actualWidth = isOpen ? currentWidth : 0;
  const widthStyle = typeof width === 'string' ? width : `${actualWidth}px`;

  return (
    <>
      {overlay && isOpen && (
        <div 
          className="fixed inset-0 bg-zinc-950/50 z-20" 
          onClick={togglePanel}
        />
      )}
      
      <aside
        className={`
          ${position === 'left' ? 'border-r' : 'border-l'}
          border-zinc-800
          bg-zinc-900
          flex
          flex-col
          min-h-0
          transition-all
          duration-300
          ease-in-out
          ${isOpen ? '' : 'w-0'}
          ${overlay ? 'fixed z-30' : 'relative'}
          ${className}
        `}
        style={{ width: widthStyle, minWidth: minWidth, maxWidth: maxWidth }}
      >
        {collapsible && (
          <button
            onClick={togglePanel}
            className={`absolute ${position === 'left' ? '-right-3' : '-left-3'} top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors shadow-lg border border-zinc-700`}
            title={isOpen ? '收起面板' : '展开面板'}
          >
            {position === 'left' 
              ? (isOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />)
              : (isOpen ? <ChevronRight size={12} /> : <ChevronLeft size={12} />)
            }
          </button>
        )}
        
        {isOpen && (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar sidebar-scrollbar">
            {children}
          </div>
        )}
      </aside>
    </>
  );
}

interface SplitPanelProps {
  left?: ReactNode;
  right?: ReactNode;
  main?: ReactNode;
  className?: string;
  leftWidth?: number;
  rightWidth?: number;
}

export function SplitPanel({
  left,
  right,
  main,
  className = '',
  leftWidth = 280,
  rightWidth = 320,
}: SplitPanelProps) {
  return (
    <div className={`flex h-full min-h-0 ${className}`}>
      {left && (
        <div 
          className="flex-shrink-0 border-r border-zinc-800 bg-zinc-900/50 overflow-y-auto custom-scrollbar"
          style={{ width: leftWidth }}
        >
          {left}
        </div>
      )}
      
      {main && (
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar content-scrollbar">
          {main}
        </div>
      )}
      
      {right && (
        <div 
          className="flex-shrink-0 border-l border-zinc-800 bg-zinc-900/50 overflow-y-auto custom-scrollbar"
          style={{ width: rightWidth }}
        >
          {right}
        </div>
      )}
    </div>
  );
}

interface TwoColumnLayoutProps {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
  leftRatio?: number;
  gap?: number;
}

export function TwoColumnLayout({
  left,
  right,
  className = '',
  leftRatio = 60,
  gap = 16,
}: TwoColumnLayoutProps) {
  return (
    <div 
      className={`flex h-full min-h-0 gap-4 md:gap-${gap / 4} ${className}`}
      style={{ gap: `${gap}px` }}
    >
      {left && (
        <div 
          className="min-w-0 min-h-0 overflow-y-auto custom-scrollbar"
          style={{ flex: `${leftRatio} 1 0%` }}
        >
          {left}
        </div>
      )}
      
      {right && (
        <div 
          className="min-w-0 min-h-0 overflow-y-auto custom-scrollbar"
          style={{ flex: `${100 - leftRatio} 1 0%` }}
        >
          {right}
        </div>
      )}
    </div>
  );
}