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
