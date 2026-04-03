// src/lib/code-analyzer/base-parser.ts

import { ParseResult, SupportedLanguage } from './types';

/**
 * 代码解析器基类
 */
export abstract class BaseParser {
  protected language: SupportedLanguage;
  protected filePath: string;

  constructor(language: SupportedLanguage, filePath: string) {
    this.language = language;
    this.filePath = filePath;
  }

  /**
   * 解析代码
   */
  abstract parse(code: string): Promise<ParseResult>;

  /**
   * 检测是否可以解析该文件
   */
  static canParse(filePath: string): boolean {
    return false;
  }

  /**
   * 生成实体 ID
   */
  protected generateEntityId(name: string, line: number): string {
    return `${this.filePath}:${name}:${line}`;
  }

  /**
   * 提取函数签名
   */
  protected extractFunctionSignature(
    name: string,
    params: Array<{ name: string; type?: string }>,
    returnType?: string
  ): string {
    const paramStr = params.map(p => p.type ? `${p.name}: ${p.type}` : p.name).join(', ');
    const returnStr = returnType ? `: ${returnType}` : '';
    return `${name}(${paramStr})${returnStr}`;
  }
}

/**
 * 解析器工厂
 */
export class ParserFactory {
  private static parsers: Map<SupportedLanguage, typeof BaseParser> = new Map();

  static register(language: SupportedLanguage, parser: typeof BaseParser): void {
    this.parsers.set(language, parser);
  }

  static getParser(language: SupportedLanguage, filePath: string): BaseParser | null {
    const ParserClass = this.parsers.get(language);
    if (!ParserClass) return null;
    return new ParserClass(language, filePath);
  }

  static getSupportedLanguage(filePath: string): SupportedLanguage | null {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!ext) return null;

    const LANGUAGE_MAP: Record<string, SupportedLanguage> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      mjs: 'javascript',
      cjs: 'javascript',
      py: 'python',
    };

    return LANGUAGE_MAP[ext] || null;
  }
}
