// src/types/global.d.ts
/**
 * 全局类型定义
 * 
 * 扩展 Window 接口以支持类型安全的全局变量
 */

declare global {
  interface Window {
    /** Diff 工具左侧引用 */
    __diffLeft: HTMLDivElement | null;
    /** Diff 工具右侧引用 */
    __diffRight: HTMLDivElement | null;
  }
}

declare module 'ansi-to-html' {
  class Convert {
    constructor(options?: Record<string, unknown>);
    toHtml(text: string): string;
  }
  export default Convert;
}

export {};
