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
  TSInterfaceDeclaration,
  ClassMethod,
  ObjectMethod,
} from '@babel/types';
import { BaseParser } from './base-parser';
import { ParseResult, CodeEntity } from './types';

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

  private getNodeCode(_node: unknown): string | undefined {
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
