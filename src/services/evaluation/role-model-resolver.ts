// src/services/evaluation/role-model-resolver.ts
// RoleModels 解析器：根据 roleId 选择对应的模型配置

import { prisma } from '@/lib/prisma';

export interface RoleModelMapping {
  roleId: string;
  modelId: string;
}

export interface ModelResolutionResult {
  modelConfigId: string;
  modelName: string;
  roleId?: string;
  isDefault: boolean;
}

/**
 * RoleModels 解析器
 * 根据 roleId 选择对应的模型配置
 */
export class RoleModelResolver {
  private roleModels: RoleModelMapping[];
  private defaultModelId: string | null;
  private cachedModelConfigs: Map<string, { id: string; name: string }> = new Map();

  constructor(roleModelsJson: string | null, defaultModelId?: string | null) {
    try {
      this.roleModels = roleModelsJson ? JSON.parse(roleModelsJson) : [];
    } catch {
      this.roleModels = [];
    }
    this.defaultModelId = defaultModelId || 
      this.roleModels.find(rm => rm.roleId === 'default')?.modelId || null;
  }

  /**
   * 根据 roleId 解析对应的模型配置
   * @param roleId 角色 ID（如果为 null，使用默认模型）
   * @returns 模型配置信息
   */
  async resolveModel(roleId?: string | null): Promise<ModelResolutionResult | null> {
    // 1. 如果有 roleId，查找对应的 modelId
    let targetModelId: string | null = null;
    let isDefault = false;

    if (roleId) {
      const mapping = this.roleModels.find(rm => rm.roleId === roleId);
      targetModelId = mapping?.modelId || this.defaultModelId;
      isDefault = !mapping;
    } else {
      targetModelId = this.defaultModelId;
      isDefault = true;
    }

    if (!targetModelId) {
      return null;
    }

    // 2. 获取模型配置（使用缓存）
    let modelConfig = this.cachedModelConfigs.get(targetModelId);
    if (!modelConfig) {
      const config = await prisma.modelConfig.findUnique({
        where: { id: targetModelId },
        select: { id: true, name: true },
      });
      if (config) {
        modelConfig = config;
        this.cachedModelConfigs.set(targetModelId, config);
      }
    }

    if (!modelConfig) {
      return null;
    }

    return {
      modelConfigId: modelConfig.id,
      modelName: modelConfig.name,
      roleId: roleId || undefined,
      isDefault,
    };
  }

  /**
   * 预加载所有模型配置（优化性能）
   */
  async preloadModelConfigs(): Promise<void> {
    const modelIds = [
      ...this.roleModels.map(rm => rm.modelId),
      this.defaultModelId,
    ].filter(Boolean) as string[];

    if (modelIds.length === 0) return;

    const configs = await prisma.modelConfig.findMany({
      where: { id: { in: modelIds } },
      select: { id: true, name: true },
    });

    configs.forEach(config => {
      this.cachedModelConfigs.set(config.id, config);
    });
  }

  /**
   * 获取所有角色模型映射（用于展示）
   */
  getAllRoleModelMappings(): { roleId: string; modelId: string; modelName?: string }[] {
    return this.roleModels.map(rm => ({
      roleId: rm.roleId,
      modelId: rm.modelId,
      modelName: this.cachedModelConfigs.get(rm.modelId)?.name,
    }));
  }

  /**
   * 获取默认模型 ID
   */
  getDefaultModelId(): string | null {
    return this.defaultModelId;
  }

  /**
   * 检查是否有角色模型配置
   */
  hasRoleModels(): boolean {
    return this.roleModels.length > 0;
  }
}

/**
 * 创建 RoleModelResolver 实例
 */
export function createRoleModelResolver(
  roleModelsJson: string | null,
  defaultModelId?: string | null
): RoleModelResolver {
  return new RoleModelResolver(roleModelsJson, defaultModelId);
}
