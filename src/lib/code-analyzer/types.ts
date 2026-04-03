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
