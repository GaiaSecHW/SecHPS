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
