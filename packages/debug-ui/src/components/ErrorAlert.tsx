import { AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

export function ErrorAlert({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'flex items-center gap-2 px-4 py-3 rounded-lg bg-red-900/20 border border-red-700/40 text-red-400 text-sm',
      className,
    )}>
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
