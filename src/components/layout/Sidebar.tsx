'use client';

import { ReactNode, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
  className?: string;
  width?: number;
}

export function Sidebar({
  collapsed = false,
  onToggle,
  children,
  className = '',
  width,
}: SidebarProps) {
  const actualWidth = width ?? (collapsed ? 64 : 240);

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-zinc-900 border-r border-zinc-800 flex flex-col z-30 transition-all duration-300 ease-in-out ${className}`}
      style={{ width: actualWidth }}
    >
      {onToggle && (
        <button
          onClick={onToggle}
          className="absolute -right-3 top-6 z-40 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:bg-cyan-600 hover:text-white transition-colors shadow-lg border border-zinc-700"
          title={collapsed ? '展开菜单' : '收起菜单'}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      )}

      <div className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar sidebar-scrollbar ${collapsed ? 'px-2 py-2' : 'px-3 py-3'}`}>
        {children}
      </div>
    </aside>
  );
}

interface SidebarSectionProps {
  title?: string;
  children: ReactNode;
  collapsed?: boolean;
  className?: string;
}

export function SidebarSection({
  title,
  children,
  collapsed = false,
  className = '',
}: SidebarSectionProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {!collapsed && title && (
        <div className="px-3 py-2">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium select-none">
            {title}
          </p>
        </div>
      )}
      {collapsed && title && <div className="my-2 mx-2 border-t border-zinc-800" />}
      {children}
    </div>
  );
}

interface SidebarItemProps {
  icon?: ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  collapsed?: boolean;
  badge?: string | number;
  className?: string;
}

export function SidebarItem({
  icon,
  label,
  href,
  onClick,
  active = false,
  collapsed = false,
  badge,
  className = '',
}: SidebarItemProps) {
  const baseClasses = `
    flex items-center gap-3 rounded-lg transition-all duration-200
    ${collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'}
    ${active 
      ? 'bg-cyan-500/15 text-cyan-400 border-l-2 border-cyan-500' 
      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}
    ${className}
  `;

  const content = (
    <>
      {icon && <span className="flex-shrink-0 w-[18px] h-[18px]">{icon}</span>}
      {!collapsed && (
        <span className="flex-1 truncate text-sm">{label}</span>
      )}
      {!collapsed && badge !== undefined && (
        <span className="px-1.5 py-0.5 text-xs bg-zinc-700 text-zinc-400 rounded">
          {badge}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <a href={href} className={baseClasses} title={collapsed ? label : undefined}>
        {content}
      </a>
    );
  }

  return (
    <button onClick={onClick} className={baseClasses} title={collapsed ? label : undefined}>
      {content}
    </button>
  );
}

interface SidebarFooterProps {
  children: ReactNode;
  collapsed?: boolean;
  className?: string;
}

export function SidebarFooter({
  children,
  collapsed = false,
  className = '',
}: SidebarFooterProps) {
  return (
    <div className={`border-t border-zinc-800 ${collapsed ? 'p-2' : 'p-3'} ${className}`}>
      {children}
    </div>
  );
}