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
