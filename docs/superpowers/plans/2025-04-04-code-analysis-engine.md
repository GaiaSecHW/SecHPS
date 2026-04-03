# 代码分析引擎实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现真实的代码分析引擎，解析项目代码文件、提取代码实体（函数、类、接口等）、构建调用图、分析数据流。

**Architecture:** 创建 CodeAnalyzer 类，支持多语言解析（JavaScript/TypeScript、Python），提取代码实体和关系，存储到 CodeKnowledge 和 DataFlow 表，供 Agent 执行时使用。

**Tech Stack:** Next.js 16, TypeScript, Prisma ORM, @babel/parser (JS/TS), Python ast 模块

---

## 现状分析

当前实现：
- `src/app/api/code/analyze/route.ts` - API 存在，但只创建空记录，标记为 `TODO`
- `src/app/api/code/[projectId]/structure/route.ts` - 返回项目结构（空）
- `src/app/api/code/[projectId]/knowledge/route.ts` - 返回代码知识（空）
- `src/app/api/code/[projectId]/graph/route.ts` - 返回调用图（空）
- `src/app/api/code/[projectId]/dataflow/route.ts` - 返回数据流（空）
- `src/app/dashboard/code/page.tsx` - 前端页面已存在

需要实现：
1. 代码解析器（JS/TS、Python）
2. 实体提取器（函数、类、接口、变量）
3. 调用关系分析
4. 数据流分析
5. 分析协调器

---

## 文件结构

```
src/lib/code-analyzer/
├── index.ts                    # 导出和协调器
├── types.ts                    # 类型定义
├── base-parser.ts              # 解析器基类
├── js-parser.ts                # JavaScript/TypeScript 解析器
├── python-parser.ts            # Python 解析器
├── entity-extractor.ts         # 实体提取器
├── call-analyzer.ts            # 调用关系分析
├── dataflow-analyzer.ts        # 数据流分析
└── structure-builder.ts       # 项目结构构建

src/app/api/code/
├── analyze/route.ts            # 修改：实现实际分析逻辑
└── [projectId]/
    ├── structure/route.ts      # 修改：返回真实结构
    ├── knowledge/route.ts      # 已完成
    ├── graph/route.ts          # 已完成
    ├── dataflow/route.ts       # 已完成
    └── search/route.ts         # 已完成
```

---

## Task 1: 创建类型定义

**Files:**
- Create: `src/lib/code-analyzer/types.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
// src/lib/code-analyzer/types.ts

/**
 * 代码实体类型
 */
export type EntityType = 'function' | 'class' | 'interface' | 'variable' | 'import' | 'export' | 'method' | 'property';

/**
 * 代码实体
 */
export interface CodeEntity {
  id: string;
  entityType: EntityType;
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd?: number;
  parentId?: string;
  signature?: string;
  docstring?: string;
  code?: string;
  calls?: string[];
  calledBy?: string[];
}

/**
 * 文件结构节点
 */
export interface FileStructureNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  language?: string;
  size?: number;
  children?: FileStructureNode[];
}

/**
 * 项目结构
 */
export interface ProjectStructure {
  root: FileStructureNode;
  fileCount: number;
  codeCount: number;
  languageStats: Record<string, number>;
}

/**
 * 调用关系
 */
export interface CallRelation {
  callerId: string;
  callerName: string;
  calleeId: string;
  calleeName: string;
  filePath: string;
  line: number;
}

/**
 * 数据流
 */
export interface DataFlowInfo {
  sourceId: string;
  sourceName: string;
  sinkId: string;
  sinkName: string;
  path: string[];
  isUserInput: boolean;
  isSensitive: boolean;
}

/**
 * 分析结果
 */
export interface AnalysisResult {
  projectId: string;
  structure: ProjectStructure;
  entities: CodeEntity[];
  callRelations: CallRelation[];
  dataFlows: DataFlowInfo[];
  duration: number;
  errors: string[];
}

/**
 * 解析结果
 */
export interface ParseResult {
  entities: CodeEntity[];
  imports: Array<{ name: string; path: string; line: number }>;
  exports: Array<{ name: string; type: string; line: number }>;
  calls: Array<{ caller: string; callee: string; line: number }>;
}

/**
 * 支持的编程语言
 */
export type SupportedLanguage = 'javascript' | 'typescript' | 'python';

/**
 * 语言检测映射
 */
export const LANGUAGE_MAP: Record<string, SupportedLanguage> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
};
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/code-analyzer/types.ts
git commit -m "feat(code-analyzer): add type definitions for code analysis"
```

---

## Task 2: 创建解析器基类

**Files:**
- Create: `src/lib/code-analyzer/base-parser.ts`

- [ ] **Step 1: 创建解析器基类**

```typescript
// src/lib/code-analyzer/base-parser.ts

import { ParseResult, CodeEntity, SupportedLanguage } from './types';

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
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/code-analyzer/base-parser.ts
git commit -m "feat(code-analyzer): add base parser class and factory"
```

---

## Task 3: 创建 JavaScript/TypeScript 解析器

**Files:**
- Create: `src/lib/code-analyzer/js-parser.ts`

- [ ] **Step 1: 创建 JS/TS 解析器**

```typescript
// src/lib/code-analyzer/js-parser.ts

import { parse, ParserOptions } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import {
  File,
  FunctionDeclaration,
  ClassDeclaration,
  VariableDeclaration,
  ImportDeclaration,
  ExportDeclaration,
  CallExpression,
  Identifier,
  TSInterfaceDeclaration,
  ClassMethod,
  ObjectMethod,
} from '@babel/types';
import { BaseParser } from './base-parser';
import { ParseResult, CodeEntity, EntityType } from './types';

/**
 * JavaScript/TypeScript 解析器
 */
export class JavaScriptParser extends BaseParser {
  constructor(filePath: string) {
    super(filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript', filePath);
  }

  static canParse(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase();
    return ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext || '');
  }

  async parse(code: string): Promise<ParseResult> {
    const result: ParseResult = {
      entities: [],
      imports: [],
      exports: [],
      calls: [],
    };

    try {
      const ast = this.parseToAST(code);
      this.traverseAST(ast, result);
    } catch (error) {
      console.error(`[JSParser] 解析失败: ${this.filePath}`, error);
    }

    return result;
  }

  private parseToAST(code: string): File {
    const isTypeScript = this.filePath.endsWith('.ts') || this.filePath.endsWith('.tsx');
    
    const options: ParserOptions = {
      sourceType: 'module',
      plugins: [
        'jsx',
        ...(isTypeScript ? ['typescript'] : []),
      ],
    };

    return parse(code, options);
  }

  private traverseAST(ast: File, result: ParseResult): void {
    traverse(ast, {
      FunctionDeclaration: (path) => this.handleFunctionDeclaration(path, result),
      ClassDeclaration: (path) => this.handleClassDeclaration(path, result),
      VariableDeclaration: (path) => this.handleVariableDeclaration(path, result),
      ImportDeclaration: (path) => this.handleImportDeclaration(path, result),
      ExportDeclaration: (path) => this.handleExportDeclaration(path, result),
      CallExpression: (path) => this.handleCallExpression(path, result),
      TSInterfaceDeclaration: (path) => this.handleInterfaceDeclaration(path, result),
      ClassMethod: (path) => this.handleClassMethod(path, result),
    });
  }

  private handleFunctionDeclaration(
    path: NodePath<FunctionDeclaration>,
    result: ParseResult
  ): void {
    const node = path.node;
    if (!node.id) return;

    const entity: CodeEntity = {
      id: this.generateEntityId(node.id.name, node.loc?.start?.line || 0),
      entityType: 'function',
      name: node.id.name,
      filePath: this.filePath,
      lineStart: node.loc?.start?.line || 0,
      lineEnd: node.loc?.end?.line,
      signature: this.extractFunctionSignature(
        node.id.name,
        node.params.map((p) => {
          if (p.type === 'Identifier') {
            return { name: p.name };
          }
          return { name: 'param' };
        })
      ),
      code: this.getNodeCode(node),
    };

    result.entities.push(entity);
  }

  private handleClassDeclaration(
    path: NodePath<ClassDeclaration>,
    result: ParseResult
  ): void {
    const node = path.node;
    if (!node.id) return;

    const entity: CodeEntity = {
      id: this.generateEntityId(node.id.name, node.loc?.start?.line || 0),
      entityType: 'class',
      name: node.id.name,
      filePath: this.filePath,
      lineStart: node.loc?.start?.line || 0,
      lineEnd: node.loc?.end?.line,
      docstring: this.getLeadingComment(path),
    };

    result.entities.push(entity);
  }

  private handleInterfaceDeclaration(
    path: NodePath<TSInterfaceDeclaration>,
    result: ParseResult
  ): void {
    const node = path.node;

    const entity: CodeEntity = {
      id: this.generateEntityId(node.id.name, node.loc?.start?.line || 0),
      entityType: 'interface',
      name: node.id.name,
      filePath: this.filePath,
      lineStart: node.loc?.start?.line || 0,
      lineEnd: node.loc?.end?.line,
    };

    result.entities.push(entity);
  }

  private handleClassMethod(
    path: NodePath<ClassMethod | ObjectMethod>,
    result: ParseResult
  ): void {
    const node = path.node;
    const name = node.key.type === 'Identifier' ? node.key.name : 'method';

    const entity: CodeEntity = {
      id: this.generateEntityId(name, node.loc?.start?.line || 0),
      entityType: 'method',
      name,
      filePath: this.filePath,
      lineStart: node.loc?.start?.line || 0,
      lineEnd: node.loc?.end?.line,
      signature: this.extractFunctionSignature(
        name,
        node.params.map((p) => {
          if (p.type === 'Identifier') {
            return { name: p.name };
          }
          return { name: 'param' };
        })
      ),
    };

    result.entities.push(entity);
  }

  private handleVariableDeclaration(
    path: NodePath<VariableDeclaration>,
    result: ParseResult
  ): void {
    const node = path.node;

    for (const declaration of node.declarations) {
      if (declaration.id.type === 'Identifier') {
        // 检查是否是函数表达式
        const init = declaration.init;
        const isFunction = init && (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression');

        const entity: CodeEntity = {
          id: this.generateEntityId(declaration.id.name, node.loc?.start?.line || 0),
          entityType: isFunction ? 'function' : 'variable',
          name: declaration.id.name,
          filePath: this.filePath,
          lineStart: node.loc?.start?.line || 0,
          lineEnd: node.loc?.end?.line,
        };

        result.entities.push(entity);
      }
    }
  }

  private handleImportDeclaration(
    path: NodePath<ImportDeclaration>,
    result: ParseResult
  ): void {
    const node = path.node;
    const source = node.source.value;

    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
        const name = specifier.local.name;
        result.imports.push({
          name,
          path: source,
          line: node.loc?.start?.line || 0,
        });
        result.entities.push({
          id: this.generateEntityId(name, node.loc?.start?.line || 0),
          entityType: 'import',
          name,
          filePath: this.filePath,
          lineStart: node.loc?.start?.line || 0,
        });
      } else if (specifier.type === 'ImportSpecifier') {
        const name = specifier.local.name;
        result.imports.push({
          name,
          path: source,
          line: node.loc?.start?.line || 0,
        });
        result.entities.push({
          id: this.generateEntityId(name, node.loc?.start?.line || 0),
          entityType: 'import',
          name,
          filePath: this.filePath,
          lineStart: node.loc?.start?.line || 0,
        });
      }
    }
  }

  private handleExportDeclaration(
    path: NodePath<ExportDeclaration>,
    result: ParseResult
  ): void {
    const node = path.node;

    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
        result.exports.push({
          name: node.declaration.id.name,
          type: 'function',
          line: node.loc?.start?.line || 0,
        });
      } else if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
        result.exports.push({
          name: node.declaration.id.name,
          type: 'class',
          line: node.loc?.start?.line || 0,
        });
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      result.exports.push({
        name: 'default',
        type: 'default',
        line: node.loc?.start?.line || 0,
      });
    }
  }

  private handleCallExpression(
    path: NodePath<CallExpression>,
    result: ParseResult
  ): void {
    const node = path.node;
    const callee = node.callee;

    let calleeName = '';
    if (callee.type === 'Identifier') {
      calleeName = callee.name;
    } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
      calleeName = callee.property.name;
    }

    if (calleeName) {
      // 获取调用者名称
      let callerName = '';
      const funcPath = path.getFunctionParent();
      if (funcPath) {
        const funcNode = funcPath.node;
        if (funcPath.isFunctionDeclaration() && funcNode.id) {
          callerName = funcNode.id.name;
        } else if (funcPath.isClassMethod() && funcNode.key.type === 'Identifier') {
          callerName = funcNode.key.name;
        } else if (funcPath.isArrowFunctionExpression() || funcPath.isFunctionExpression()) {
          // 尝试获取变量名
          const parent = funcPath.parent;
          if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
            callerName = parent.id.name;
          }
        }
      }

      result.calls.push({
        caller: callerName,
        callee: calleeName,
        line: node.loc?.start?.line || 0,
      });
    }
  }

  private getNodeCode(node: any): string | undefined {
    // 返回节点代码片段（简化版）
    return undefined;
  }

  private getLeadingComment(path: NodePath): string | undefined {
    const comments = path.node.leadingComments;
    if (!comments || comments.length === 0) return undefined;

    const comment = comments[comments.length - 1];
    if (comment.type === 'CommentBlock') {
      return comment.value.trim();
    }
    return undefined;
  }
}
```

- [ ] **Step 2: 安装 Babel 依赖**

```bash
cd D:/claude-web-platform && npm install @babel/parser @babel/traverse @babel/types --save
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/code-analyzer/js-parser.ts package.json package-lock.json
git commit -m "feat(code-analyzer): add JavaScript/TypeScript parser with Babel"
```

---

## Task 4: 创建项目结构构建器

**Files:**
- Create: `src/lib/code-analyzer/structure-builder.ts`

- [ ] **Step 1: 创建项目结构构建器**

```typescript
// src/lib/code-analyzer/structure-builder.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectStructure, FileStructureNode, SupportedLanguage, LANGUAGE_MAP } from './types';

/**
 * 项目结构构建器
 */
export class StructureBuilder {
  private projectPath: string;
  private projectId: string;

  constructor(projectPath: string, projectId: string) {
    this.projectPath = projectPath;
    this.projectId = projectId;
  }

  /**
   * 构建项目结构
   */
  async build(): Promise<ProjectStructure> {
    const root: FileStructureNode = {
      name: path.basename(this.projectPath),
      path: '',
      type: 'directory',
      children: [],
    };

    let fileCount = 0;
    let codeCount = 0;
    const languageStats: Record<string, number> = {};

    try {
      await this.buildDirectory(root, this.projectPath, '', {
        fileCount: 0,
        codeCount: 0,
        languageStats,
      });

      // 统计文件数量
      const stats = await this.countFiles(this.projectPath);
      fileCount = stats.fileCount;
      codeCount = stats.codeCount;
      Object.assign(languageStats, stats.languageStats);

    } catch (error) {
      console.error('[StructureBuilder] 构建结构失败:', error);
    }

    return {
      root,
      fileCount,
      codeCount,
      languageStats,
    };
  }

  /**
   * 递归构建目录结构
   */
  private async buildDirectory(
    node: FileStructureNode,
    dirPath: string,
    relativePath: string,
    stats: { fileCount: number; codeCount: number; languageStats: Record<string, number> }
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过隐藏文件和常见忽略目录
      if (entry.name.startsWith('.') || this.shouldIgnore(entry.name, entry.isDirectory())) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        const childNode: FileStructureNode = {
          name: entry.name,
          path: relPath,
          type: 'directory',
          children: [],
        };

        await this.buildDirectory(childNode, fullPath, relPath, stats);

        if (childNode.children && childNode.children.length > 0) {
          node.children = node.children || [];
          node.children.push(childNode);
        }
      } else if (entry.isFile()) {
        const ext = entry.name.split('.').pop()?.toLowerCase() || '';
        const language = LANGUAGE_MAP[ext];

        // 只包含代码文件
        if (language) {
          stats.codeCount++;
          stats.languageStats[language] = (stats.languageStats[language] || 0) + 1;

          try {
            const stat = await fs.stat(fullPath);
            const childNode: FileStructureNode = {
              name: entry.name,
              path: relPath,
              type: 'file',
              language,
              size: stat.size,
            };

            node.children = node.children || [];
            node.children.push(childNode);
          } catch {
            // 忽略无法访问的文件
          }
        }
      }
    }
  }

  /**
   * 统计文件数量
   */
  private async countFiles(dirPath: string): Promise<{
    fileCount: number;
    codeCount: number;
    languageStats: Record<string, number>;
  }> {
    const result = {
      fileCount: 0,
      codeCount: 0,
      languageStats: {} as Record<string, number>,
    };

    const countRecursive = async (currentPath: string): Promise<void> => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || this.shouldIgnore(entry.name, entry.isDirectory())) {
          continue;
        }

        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await countRecursive(fullPath);
        } else if (entry.isFile()) {
          result.fileCount++;

          const ext = entry.name.split('.').pop()?.toLowerCase() || '';
          const language = LANGUAGE_MAP[ext];

          if (language) {
            result.codeCount++;
            result.languageStats[language] = (result.languageStats[language] || 0) + 1;
          }
        }
      }
    };

    try {
      await countRecursive(dirPath);
    } catch (error) {
      console.error('[StructureBuilder] 统计文件失败:', error);
    }

    return result;
  }

  /**
   * 判断是否应该忽略
   */
  private shouldIgnore(name: string, isDirectory: boolean): boolean {
    const ignoreDirs = [
      'node_modules',
      'dist',
      'build',
      'out',
      '.next',
      '.git',
      '__pycache__',
      'venv',
      '.venv',
      'env',
      '.env',
    ];

    const ignoreFiles = [
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
    ];

    if (isDirectory) {
      return ignoreDirs.includes(name);
    }

    return ignoreFiles.includes(name);
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/code-analyzer/structure-builder.ts
git commit -m "feat(code-analyzer): add project structure builder"
```

---

## Task 5: 创建实体提取器和调用分析器

**Files:**
- Create: `src/lib/code-analyzer/entity-extractor.ts`
- Create: `src/lib/code-analyzer/call-analyzer.ts`

- [ ] **Step 1: 创建实体提取器**

```typescript
// src/lib/code-analyzer/entity-extractor.ts

import { prisma } from '@/lib/prisma';
import { CodeEntity, ParseResult, SupportedLanguage } from './types';
import { ParserFactory } from './base-parser';

/**
 * 实体提取器
 * 从代码文件中提取代码实体并存储到数据库
 */
export class EntityExtractor {
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /**
   * 从文件内容提取实体
   */
  async extractFromFile(
    filePath: string,
    code: string
  ): Promise<CodeEntity[]> {
    const language = ParserFactory.getSupportedLanguage(filePath);
    if (!language) {
      return [];
    }

    const parser = ParserFactory.getParser(language, filePath);
    if (!parser) {
      return [];
    }

    try {
      const result = await parser.parse(code);
      return result.entities;
    } catch (error) {
      console.error(`[EntityExtractor] 解析失败: ${filePath}`, error);
      return [];
    }
  }

  /**
   * 批量提取实体
   */
  async extractFromFiles(
    files: Array<{ path: string; content: string }>
  ): Promise<CodeEntity[]> {
    const allEntities: CodeEntity[] = [];

    for (const file of files) {
      const entities = await this.extractFromFile(file.path, file.content);
      allEntities.push(...entities);
    }

    return allEntities;
  }

  /**
   * 保存实体到数据库
   */
  async saveToDatabase(entities: CodeEntity[]): Promise<number> {
    if (entities.length === 0) return 0;

    let savedCount = 0;

    for (const entity of entities) {
      try {
        // 建立调用关系
        const existing = await prisma.codeKnowledge.findFirst({
          where: {
            projectId: this.projectId,
            name: entity.name,
            filePath: entity.filePath,
            lineStart: entity.lineStart,
          },
        });

        if (existing) {
          // 更新现有实体
          await prisma.codeKnowledge.update({
            where: { id: existing.id },
            data: {
              entityType: entity.entityType,
              lineEnd: entity.lineEnd,
              parentId: entity.parentId,
              signature: entity.signature,
              docstring: entity.docstring,
              code: entity.code,
              calls: entity.calls ? JSON.stringify(entity.calls) : null,
              calledBy: entity.calledBy ? JSON.stringify(entity.calledBy) : null,
            },
          });
        } else {
          // 创建新实体
          await prisma.codeKnowledge.create({
            data: {
              projectId: this.projectId,
              entityType: entity.entityType,
              name: entity.name,
              filePath: entity.filePath,
              lineStart: entity.lineStart,
              lineEnd: entity.lineEnd,
              parentId: entity.parentId,
              signature: entity.signature,
              docstring: entity.docstring,
              code: entity.code,
              calls: entity.calls ? JSON.stringify(entity.calls) : null,
              calledBy: entity.calledBy ? JSON.stringify(entity.calledBy) : null,
            },
          });
        }

        savedCount++;
      } catch (error) {
        console.error(`[EntityExtractor] 保存实体失败: ${entity.name}`, error);
      }
    }

    return savedCount;
  }

  /**
   * 构建调用关系
   */
  async buildCallRelations(entities: CodeEntity[]): Promise<void> {
    // 构建名称到实体的映射
    const nameToEntity = new Map<string, CodeEntity[]>();
    for (const entity of entities) {
      const existing = nameToEntity.get(entity.name) || [];
      existing.push(entity);
      nameToEntity.set(entity.name, existing);
    }

    // 更新被调用关系
    for (const entity of entities) {
      if (!entity.calls || entity.calls.length === 0) continue;

      const calledBy = entity.calls.filter(callee => nameToEntity.has(callee));
      
      // 更新被调用者的 calledBy
      for (const calleeName of calledBy) {
        const callees = nameToEntity.get(calleeName);
        if (callees) {
          for (const callee of callees) {
            callee.calledBy = callee.calledBy || [];
            if (!callee.calledBy.includes(entity.name)) {
              callee.calledBy.push(entity.name);
            }
          }
        }
      }
    }
  }

  /**
   * 清除项目的所有实体
   */
  async clearProjectEntities(): Promise<void> {
    await prisma.codeKnowledge.deleteMany({
      where: { projectId: this.projectId },
    });
  }
}
```

- [ ] **Step 2: 创建调用分析器**

```typescript
// src/lib/code-analyzer/call-analyzer.ts

import { prisma } from '@/lib/prisma';
import { CallRelation, CodeEntity } from './types';

/**
 * 调用关系分析器
 */
export class CallAnalyzer {
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /**
   * 从实体中提取调用关系
   */
  extractCallRelations(entities: CodeEntity[]): CallRelation[] {
    const relations: CallRelation[] = [];
    const entityMap = new Map<string, CodeEntity>();

    // 建立实体映射
    for (const entity of entities) {
      entityMap.set(entity.id, entity);
    }

    // 提取调用关系
    for (const entity of entities) {
      if (!entity.calls) continue;

      for (const calleeName of entity.calls) {
        // 查找被调用实体
        const callees = entities.filter(e => e.name === calleeName);
        
        for (const callee of callees) {
          relations.push({
            callerId: entity.id,
            callerName: entity.name,
            calleeId: callee.id,
            calleeName: callee.name,
            filePath: entity.filePath,
            line: entity.lineStart,
          });
        }
      }
    }

    return relations;
  }

  /**
   * 构建调用图
   */
  buildCallGraph(relations: CallRelation[]): {
    nodes: Array<{ id: string; name: string; type: string }>;
    edges: Array<{ source: string; target: string }>;
  } {
    const nodes: Array<{ id: string; name: string; type: string }> = [];
    const edges: Array<{ source: string; target: string }> = [];
    const nodeSet = new Set<string>();

    for (const relation of relations) {
      if (!nodeSet.has(relation.callerId)) {
        nodes.push({
          id: relation.callerId,
          name: relation.callerName,
          type: 'function',
        });
        nodeSet.add(relation.callerId);
      }

      if (!nodeSet.has(relation.calleeId)) {
        nodes.push({
          id: relation.calleeId,
          name: relation.calleeName,
          type: 'function',
        });
        nodeSet.add(relation.calleeId);
      }

      edges.push({
        source: relation.callerId,
        target: relation.calleeId,
      });
    }

    return { nodes, edges };
  }

  /**
   * 保存调用关系到数据库
   */
  async saveCallRelations(relations: CallRelation[]): Promise<void> {
    // 更新实体的 calls 和 calledBy 字段
    const callerMap = new Map<string, string[]>();
    const calleeMap = new Map<string, string[]>();

    for (const relation of relations) {
      // 更新 caller 的 calls
      const calls = callerMap.get(relation.callerId) || [];
      if (!calls.includes(relation.calleeName)) {
        calls.push(relation.calleeName);
      }
      callerMap.set(relation.callerId, calls);

      // 更新 callee 的 calledBy
      const calledBy = calleeMap.get(relation.calleeId) || [];
      if (!calledBy.includes(relation.callerName)) {
        calledBy.push(relation.callerName);
      }
      calleeMap.set(relation.calleeId, calledBy);
    }

    // 批量更新
    for (const [id, calls] of callerMap) {
      try {
        await prisma.codeKnowledge.update({
          where: { id },
          data: { calls: JSON.stringify(calls) },
        });
      } catch (error) {
        // 忽略不存在的实体
      }
    }

    for (const [id, calledBy] of calleeMap) {
      try {
        await prisma.codeKnowledge.update({
          where: { id },
          data: { calledBy: JSON.stringify(calledBy) },
        });
      } catch (error) {
        // 忽略不存在的实体
      }
    }
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/code-analyzer/entity-extractor.ts src/lib/code-analyzer/call-analyzer.ts
git commit -m "feat(code-analyzer): add entity extractor and call analyzer"
```

---

## Task 6: 创建数据流分析器和协调器

**Files:**
- Create: `src/lib/code-analyzer/dataflow-analyzer.ts`
- Create: `src/lib/code-analyzer/index.ts`

- [ ] **Step 1: 创建数据流分析器**

```typescript
// src/lib/code-analyzer/dataflow-analyzer.ts

import { prisma } from '@/lib/prisma';
import { DataFlowInfo, CodeEntity } from './types';

/**
 * 数据流分析器
 * 分析数据从输入到敏感操作的流向
 */
export class DataFlowAnalyzer {
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /**
   * 分析数据流
   */
  async analyze(entities: CodeEntity[]): Promise<DataFlowInfo[]> {
    const dataFlows: DataFlowInfo[] = [];

    // 定义用户输入源
    const userInputPatterns = [
      'req.body',
      'req.query',
      'req.params',
      'request.body',
      'input',
      'userInput',
      'form',
      'FormData',
    ];

    // 定义敏感操作
    const sensitivePatterns = [
      'executeQuery',
      'exec',
      'query',
      'eval',
      'innerHTML',
      'dangerouslySetInnerHTML',
      'write',
      'send',
      'response.send',
      'res.send',
      'res.write',
    ];

    // 查找用户输入实体
    const userInputEntities = entities.filter(e => 
      this.matchesPatterns(e.name, userInputPatterns) ||
      this.matchesPatterns(e.signature || '', userInputPatterns)
    );

    // 查找敏感操作实体
    const sensitiveEntities = entities.filter(e =>
      this.matchesPatterns(e.name, sensitivePatterns) ||
      this.matchesPatterns(e.signature || '', sensitivePatterns)
    );

    // 构建调用图
    const entityMap = new Map<string, CodeEntity>();
    for (const entity of entities) {
      entityMap.set(entity.name.toLowerCase(), entity);
    }

    // 追踪从用户输入到敏感操作的数据流
    for (const source of userInputEntities) {
      const visited = new Set<string>();
      const paths = this.traceDataFlow(
        source.name,
        sensitiveEntities.map(e => e.name),
        entityMap,
        visited,
        [source.name]
      );

      for (const path of paths) {
        const sinkName = path[path.length - 1];
        const sink = entities.find(e => e.name === sinkName);

        if (sink) {
          dataFlows.push({
            sourceId: source.id,
            sourceName: source.name,
            sinkId: sink.id,
            sinkName: sink.name,
            path,
            isUserInput: true,
            isSensitive: true,
          });
        }
      }
    }

    return dataFlows;
  }

  /**
   * 追踪数据流
   */
  private traceDataFlow(
    current: string,
    sensitiveNames: string[],
    entityMap: Map<string, CodeEntity>,
    visited: Set<string>,
    path: string[]
  ): string[][] {
    const results: string[][] = [];
    const currentLower = current.toLowerCase();

    if (visited.has(currentLower)) {
      return results;
    }

    visited.add(currentLower);

    // 检查是否到达敏感操作
    if (sensitiveNames.some(s => s.toLowerCase() === currentLower)) {
      results.push([...path]);
      return results;
    }

    // 获取当前实体的调用
    const entity = entityMap.get(currentLower);
    if (!entity || !entity.calls) {
      return results;
    }

    // 递归追踪
    for (const callee of entity.calls) {
      const subPaths = this.traceDataFlow(
        callee,
        sensitiveNames,
        entityMap,
        new Set(visited),
        [...path, callee]
      );
      results.push(...subPaths);
    }

    return results;
  }

  /**
   * 匹配模式
   */
  private matchesPatterns(text: string, patterns: string[]): boolean {
    const lowerText = text.toLowerCase();
    return patterns.some(pattern => lowerText.includes(pattern.toLowerCase()));
  }

  /**
   * 保存数据流到数据库
   */
  async saveDataFlows(dataFlows: DataFlowInfo[]): Promise<number> {
    if (dataFlows.length === 0) return 0;

    let savedCount = 0;

    for (const flow of dataFlows) {
      try {
        await prisma.dataFlow.create({
          data: {
            projectId: this.projectId,
            sourceId: flow.sourceId,
            sinkId: flow.sinkId,
            sourceName: flow.sourceName,
            sinkName: flow.sinkName,
            path: JSON.stringify(flow.path),
            isUserInput: flow.isUserInput,
            isSensitive: flow.isSensitive,
          },
        });
        savedCount++;
      } catch (error) {
        console.error('[DataFlowAnalyzer] 保存数据流失败:', error);
      }
    }

    return savedCount;
  }

  /**
   * 清除项目的所有数据流
   */
  async clearProjectDataFlows(): Promise<void> {
    await prisma.dataFlow.deleteMany({
      where: { projectId: this.projectId },
    });
  }
}
```

- [ ] **Step 2: 创建协调器**

```typescript
// src/lib/code-analyzer/index.ts

import { prisma } from '@/lib/prisma';
import { ParserFactory } from './base-parser';
import { JavaScriptParser } from './js-parser';
import { StructureBuilder } from './structure-builder';
import { EntityExtractor } from './entity-extractor';
import { CallAnalyzer } from './call-analyzer';
import { DataFlowAnalyzer } from './dataflow-analyzer';
import { AnalysisResult, ProjectStructure, CodeEntity, CallRelation, DataFlowInfo } from './types';

// 注册解析器
ParserFactory.register('javascript', JavaScriptParser);
ParserFactory.register('typescript', JavaScriptParser);

export {
  ParserFactory,
  JavaScriptParser,
  StructureBuilder,
  EntityExtractor,
  CallAnalyzer,
  DataFlowAnalyzer,
};

export type {
  EntityType,
  CodeEntity,
  FileStructureNode,
  ProjectStructure,
  CallRelation,
  DataFlowInfo,
  AnalysisResult,
  ParseResult,
  SupportedLanguage,
};

/**
 * 代码分析器
 * 协调所有分析组件
 */
export class CodeAnalyzer {
  private projectId: string;
  private projectPath: string;

  constructor(projectId: string, projectPath: string) {
    this.projectId = projectId;
    this.projectPath = projectPath;
  }

  /**
   * 执行完整分析
   */
  async analyze(progressCallback?: (status: string, progress: number) => void): Promise<AnalysisResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      // 1. 构建项目结构
      progressCallback?.('正在分析项目结构', 10);
      const structureBuilder = new StructureBuilder(this.projectPath, this.projectId);
      const structure = await structureBuilder.build();

      // 保存结构到数据库
      await this.saveStructure(structure);

      // 2. 提取代码实体
      progressCallback?.('正在提取代码实体', 30);
      const entityExtractor = new EntityExtractor(this.projectId);
      await entityExtractor.clearProjectEntities();

      // 获取项目文件
      const projectFiles = await this.getProjectFiles();
      const allEntities: CodeEntity[] = [];

      for (let i = 0; i < projectFiles.length; i++) {
        const file = projectFiles[i];
        const progress = 30 + (i / projectFiles.length) * 30;
        progressCallback?.(`正在分析文件 ${i + 1}/${projectFiles.length}`, progress);

        const entities = await entityExtractor.extractFromFile(file.path, file.content);
        allEntities.push(...entities);
      }

      // 构建调用关系
      await entityExtractor.buildCallRelations(allEntities);
      await entityExtractor.saveToDatabase(allEntities);

      // 3. 分析调用关系
      progressCallback?.('正在分析调用关系', 70);
      const callAnalyzer = new CallAnalyzer(this.projectId);
      const relations = callAnalyzer.extractCallRelations(allEntities);
      await callAnalyzer.saveCallRelations(relations);

      // 4. 分析数据流
      progressCallback?.('正在分析数据流', 85);
      const dataFlowAnalyzer = new DataFlowAnalyzer(this.projectId);
      await dataFlowAnalyzer.clearProjectDataFlows();
      const dataFlows = await dataFlowAnalyzer.analyze(allEntities);
      await dataFlowAnalyzer.saveDataFlows(dataFlows);

      // 5. 更新分析状态
      progressCallback?.('正在保存结果', 95);
      await this.updateStructureStatus('completed');

      progressCallback?.('分析完成', 100);

      return {
        projectId: this.projectId,
        structure,
        entities: allEntities,
        callRelations: relations,
        dataFlows,
        duration: Date.now() - startTime,
        errors,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '未知错误');
      await this.updateStructureStatus('failed');
      throw error;
    }
  }

  /**
   * 获取项目文件
   */
  private async getProjectFiles(): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];

    // 从数据库获取项目文件
    const projectFiles = await prisma.projectFile.findMany({
      where: { projectId: this.projectId },
    });

    for (const file of projectFiles) {
      // 只处理代码文件
      const ext = file.fileName.split('.').pop()?.toLowerCase();
      if (['js', 'jsx', 'ts', 'tsx', 'py'].includes(ext || '')) {
        files.push({
          path: file.fileName,
          content: file.content || '',
        });
      }
    }

    return files;
  }

  /**
   * 保存结构到数据库
   */
  private async saveStructure(structure: ProjectStructure): Promise<void> {
    await prisma.projectStructure.upsert({
      where: { projectId: this.projectId },
      update: {
        structure: JSON.stringify(structure.root),
        fileCount: structure.fileCount,
        codeCount: structure.codeCount,
        languageStats: JSON.stringify(structure.languageStats),
        status: 'analyzing',
        analyzedAt: new Date(),
      },
      create: {
        projectId: this.projectId,
        structure: JSON.stringify(structure.root),
        fileCount: structure.fileCount,
        codeCount: structure.codeCount,
        languageStats: JSON.stringify(structure.languageStats),
        status: 'analyzing',
      },
    });
  }

  /**
   * 更新结构状态
   */
  private async updateStructureStatus(status: string): Promise<void> {
    await prisma.projectStructure.updateMany({
      where: { projectId: this.projectId },
      data: {
        status,
        analyzedAt: status === 'completed' ? new Date() : undefined,
      },
    });
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/code-analyzer/dataflow-analyzer.ts src/lib/code-analyzer/index.ts
git commit -m "feat(code-analyzer): add dataflow analyzer and coordinator"
```

---

## Task 7: 更新代码分析 API

**Files:**
- Modify: `src/app/api/code/analyze/route.ts`
- Modify: `src/app/api/code/[projectId]/structure/route.ts`

- [ ] **Step 1: 更新分析 API**

```typescript
// src/app/api/code/analyze/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { CodeAnalyzer } from '@/lib/code-analyzer';

// POST /api/code/analyze - 分析项目代码
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { files: true },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 检查项目路径
    if (!project.projectPath) {
      return NextResponse.json({ error: '项目路径未配置' }, { status: 400 });
    }

    // 创建 SSE 流用于进度更新
    const stream = new ReadableStream({
      async start(controller) {
        const sendProgress = (status: string, progress: number) => {
          const data = JSON.stringify({ status, progress });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
        };

        try {
          const analyzer = new CodeAnalyzer(projectId, project.projectPath!);
          const result = await analyzer.analyze(sendProgress);

          const data = JSON.stringify({
            type: 'complete',
            result: {
              projectId: result.projectId,
              fileCount: result.structure.fileCount,
              codeCount: result.structure.codeCount,
              entityCount: result.entities.length,
              callRelationCount: result.callRelations.length,
              dataFlowCount: result.dataFlows.length,
              duration: result.duration,
              errors: result.errors,
            },
          });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          controller.close();
        } catch (error) {
          const data = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : '分析失败',
          });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('分析项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 更新结构 API**

```typescript
// src/app/api/code/[projectId]/structure/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/structure - 获取项目结构
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { projectId } = await params;

    const structure = await prisma.projectStructure.findUnique({
      where: { projectId },
    });

    if (!structure) {
      return NextResponse.json({ 
        error: '项目结构不存在，请先分析项目',
        structure: null 
      }, { status: 404 });
    }

    return NextResponse.json({
      structure: {
        id: structure.id,
        projectId: structure.projectId,
        structure: JSON.parse(structure.structure),
        fileCount: structure.fileCount,
        codeCount: structure.codeCount,
        languageStats: JSON.parse(structure.languageStats),
        status: structure.status,
        analyzedAt: structure.analyzedAt,
        createdAt: structure.createdAt,
        updatedAt: structure.updatedAt,
      },
    });
  } catch (error) {
    console.error('获取项目结构错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/app/api/code/analyze/route.ts src/app/api/code/[projectId]/structure/route.ts
git commit -m "feat(api): implement real code analysis with SSE progress"
```

---

## Task 8: 验证和最终提交

- [ ] **Step 1: 运行构建**

```bash
cd D:/claude-web-platform && npm run build
```

Expected: 构建成功

- [ ] **Step 2: 最终提交**

```bash
git add -A
git commit -m "feat(code-analyzer): implement real code analysis engine

- Add type definitions for code entities and analysis results
- Add base parser class and parser factory
- Add JavaScript/TypeScript parser with Babel
- Add project structure builder
- Add entity extractor and call analyzer
- Add dataflow analyzer for tracking user input to sensitive ops
- Add CodeAnalyzer coordinator
- Update code analysis API with real implementation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 完成检查清单

- [ ] 类型定义创建完成
- [ ] 解析器基类创建完成
- [ ] JS/TS 解析器创建完成
- [ ] 项目结构构建器创建完成
- [ ] 实体提取器创建完成
- [ ] 调用分析器创建完成
- [ ] 数据流分析器创建完成
- [ ] 协调器创建完成
- [ ] API 更新完成
- [ ] TypeScript 类型检查通过
- [ ] 构建成功
- [ ] 所有更改已提交

---

## 配置说明

代码分析引擎依赖 Babel 解析器，需要安装：

```bash
npm install @babel/parser @babel/traverse @babel/types --save
```

## 使用说明

1. 项目需要有 `projectPath` 字段指向实际代码目录
2. 或者在 `ProjectFile` 表中有代码文件内容
3. 调用 `POST /api/code/analyze` 开始分析
4. 分析完成后可查询 `/api/code/[projectId]/knowledge`、`/api/code/[projectId]/graph` 等

## 限制

当前实现：
- 支持 JavaScript/TypeScript 解析
- Python 解析器待实现
- 数据流分析基于简单模式匹配
- 复杂的数据流追踪需要进一步的静态分析
