// src/lib/utils.ts
/**
 * 通用工具函数
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 Tailwind CSS 类名
 * 使用 clsx 处理条件类名，使用 tailwind-merge 处理类名冲突
 * 
 * @example
 * cn('px-4 py-2', 'bg-blue-500', { 'opacity-50': disabled })
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
