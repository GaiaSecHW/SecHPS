'use client';

import { ReactNode, useState, useCallback, createContext, useContext, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface LayoutContextType {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarWidth: number;
}

const LayoutContext = createContext<LayoutContextType | null>(null);

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within AppLayout');
  }
  return context;
}

interface AppLayoutProps {
  children: ReactNode;
  sidebar?: ReactNode;
  headerContent?: ReactNode;
  className?: string;
}

export function AppLayout({
  children,
  sidebar,
  headerContent,
  className = '',
}: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  const sidebarWidth = sidebarCollapsed ? 64 : 240;

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarCollapsed(true);
      }
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <LayoutContext.Provider value={{ sidebarCollapsed, setSidebarCollapsed, sidebarWidth }}>
      <div className={`h-screen w-screen overflow-hidden bg-zinc-950 ${className}`}>
        <div className="flex h-full">
          {sidebar || <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />}
          
          <div 
            className="flex flex-1 flex-col min-w-0 transition-all duration-300 ease-in-out"
            style={{ marginLeft: sidebarCollapsed ? 64 : 240 }}
          >
            <Header>{headerContent}</Header>
            
            <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar content-scrollbar">
              <div className="w-full h-full">
                {children}
              </div>
            </main>
          </div>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}

export function AppLayoutSidebar({ children }: { children: ReactNode }) {
  const { sidebarCollapsed, setSidebarCollapsed } = useLayout();
  
  return (
    <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}>
      {children}
    </Sidebar>
  );
}