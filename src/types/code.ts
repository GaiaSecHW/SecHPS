// src/types/code.ts

export type CodeEntityType =
  | 'function'
  | 'class'
  | 'interface'
  | 'variable'
  | 'import'
  | 'call';

export type AnalysisStatus = 'pending' | 'analyzing' | 'completed' | 'failed';

// 项目结构分析结果
export interface ProjectStructureResult {
  structure: FileTreeNode;
  fileCount: number;
  codeCount: number;
  languageStats: Record<string, number>;
}

// 文件树节点
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  language?: string;
  size?: number;
}

// 代码知识查询参数
export interface CodeKnowledgeQueryParams {
  projectId: string;
  entityType?: CodeEntityType;
  name?: string;
  filePath?: string;
}

// 调用图节点
export interface CallGraphNode {
  id: string;
  name: string;
  type: CodeEntityType;
  filePath: string;
  lineStart: number;
  lineEnd?: number;
}

// 调用图边
export interface CallGraphEdge {
  source: string;
  target: string;
  type: 'calls' | 'implements' | 'extends';
}

// 数据流
export interface DataFlowInfo {
  id: string;
  sourceName: string;
  sinkName: string;
  path: string[];
  isUserInput: boolean;
  isSensitive: boolean;
}

// 代码知识响应
export interface CodeKnowledgeResponse {
  id: string;
  projectId: string;
  entityType: CodeEntityType;
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd: number | null;
  parentId: string | null;
  calls: string[] | null;
  calledBy: string[] | null;
  signature: string | null;
  docstring: string | null;
  code: string | null;
  summary: string | null;
  riskScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// 项目结构响应
export interface ProjectStructureResponse {
  id: string;
  projectId: string;
  structure: FileTreeNode;
  fileCount: number;
  codeCount: number;
  languageStats: Record<string, number>;
  status: AnalysisStatus;
  analyzedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// 数据流响应
export interface DataFlowResponse {
  id: string;
  projectId: string;
  sourceId: string;
  sinkId: string;
  sourceName: string;
  sinkName: string;
  path: string[];
  isUserInput: boolean;
  isSensitive: boolean;
  createdAt: Date;
}

// 代码分析请求
export interface CodeAnalyzeRequest {
  projectId: string;
  options?: {
    includeStructure?: boolean;
    includeKnowledge?: boolean;
    includeDataFlow?: boolean;
    languages?: string[];
  };
}

// 代码分析响应
export interface CodeAnalyzeResponse {
  projectId: string;
  structure: ProjectStructureResponse | null;
  knowledgeCount: number;
  dataFlowCount: number;
  status: AnalysisStatus;
}
