// src/lib/code-analyzer/entity-extractor.ts

import { prisma } from '@/lib/prisma';
import { CodeEntity, ParserFactory } from './types';
import { ParserFactory as ParserFactoryClass } from './base-parser';

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
    const language = ParserFactoryClass.getSupportedLanguage(filePath);
    if (!language) {
      return [];
    }

    const parser = ParserFactoryClass.getParser(language, filePath);
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
