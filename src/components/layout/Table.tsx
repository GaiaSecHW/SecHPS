'use client';

import { ReactNode, forwardRef, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ResponsiveTableProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  className?: string;
  fixedLayout?: boolean;
  minWidth?: number | string;
  maxHeight?: number | string;
}

export const ResponsiveTable = forwardRef<HTMLDivElement, ResponsiveTableProps>(
  ({
    children,
    className = '',
    fixedLayout = false,
    minWidth = 600,
    maxHeight,
    ...props
  }, ref) => {
    const minW = typeof minWidth === 'number' ? `${minWidth}px` : minWidth;
    const maxH = maxHeight ? (typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight) : undefined;

    return (
      <div
        ref={ref}
        className={cn(
          'w-full overflow-x-auto overflow-y-hidden',
          'rounded-lg border border-zinc-800',
          className
        )}
        style={{ maxHeight: maxH }}
        {...props}
      >
        <div 
          className="min-w-0 inline-block w-full"
          style={{ minWidth: minW }}
        >
          <table className={cn(
            'w-full border-collapse',
            fixedLayout ? 'table-fixed' : 'table-auto'
          )}>
            {children}
          </table>
        </div>
      </div>
    );
  }
);

ResponsiveTable.displayName = 'ResponsiveTable';

interface TableHeaderProps {
  children?: ReactNode;
  className?: string;
}

export function TableHeader({
  children,
  className = '',
}: TableHeaderProps) {
  return (
    <thead className={cn('bg-zinc-900/60 sticky top-0 z-10', className)}>
      {children}
    </thead>
  );
}

interface TableBodyProps {
  children?: ReactNode;
  className?: string;
}

export function TableBody({
  children,
  className = '',
}: TableBodyProps) {
  return (
    <tbody className={cn('divide-y divide-zinc-800', className)}>
      {children}
    </tbody>
  );
}

interface TableRowProps {
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export function TableRow({
  children,
  className = '',
  onClick,
  hoverable = true,
}: TableRowProps) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'transition-colors',
        hoverable && 'hover:bg-zinc-800/40',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </tr>
  );
}

interface TableCellProps {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
  truncate?: boolean;
  minWidth?: number | string;
}

export function TableCell({
  children,
  className = '',
  align = 'left',
  truncate = false,
  minWidth,
}: TableCellProps) {
  const minW = minWidth ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined;

  return (
    <td
      className={cn(
        'px-3 md:px-4 py-3 text-sm md:text-base text-zinc-300',
        align === 'center' && 'text-center',
        align === 'right' && 'text-right',
        truncate && 'truncate',
        className
      )}
      style={{ minWidth: minW }}
    >
      {children}
    </td>
  );
}

interface TableHeaderCellProps {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  minWidth?: number | string;
}

export function TableHeaderCell({
  children,
  className = '',
  align = 'left',
  sortable = false,
  minWidth,
}: TableHeaderCellProps) {
  const minW = minWidth ? (typeof minWidth === 'number' ? `${minWidth}px` : minWidth) : undefined;

  return (
    <th
      className={cn(
        'px-3 md:px-4 py-3 text-xs md:text-sm font-semibold text-zinc-400 uppercase tracking-wider',
        align === 'center' && 'text-center',
        align === 'right' && 'text-right',
        sortable && 'cursor-pointer hover:text-zinc-200 select-none',
        className
      )}
      style={{ minWidth: minW }}
    >
      {children}
    </th>
  );
}

interface DataTableProps {
  columns: Array<{
    key: string;
    header: ReactNode;
    render?: (row: any) => ReactNode;
    width?: number | string;
    align?: 'left' | 'center' | 'right';
    truncate?: boolean;
  }>;
  data: Array<any>;
  className?: string;
  rowKey?: string;
  onRowClick?: (row: any) => void;
  emptyMessage?: string;
  loading?: boolean;
}

export function DataTable({
  columns,
  data,
  className = '',
  rowKey = 'id',
  onRowClick,
  emptyMessage = '暂无数据',
  loading = false,
}: DataTableProps) {
  if (loading) {
    return (
      <div className={cn('w-full rounded-lg border border-zinc-800 p-8', className)}>
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-cyan-500/20 border-t-cyan-500"></div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={cn('w-full rounded-lg border border-zinc-800 p-8', className)}>
        <p className="text-center text-zinc-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ResponsiveTable className={className}>
      <TableHeader>
        <TableRow hoverable={false}>
          {columns.map(col => (
            <TableHeaderCell
              key={col.key}
              align={col.align}
              minWidth={col.width}
            >
              {col.header}
            </TableHeaderCell>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map(row => (
          <TableRow
            key={row[rowKey] || row.id || JSON.stringify(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map(col => (
              <TableCell
                key={col.key}
                align={col.align}
                truncate={col.truncate}
                minWidth={col.width}
              >
                {col.render ? col.render(row) : row[col.key]}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </ResponsiveTable>
  );
}