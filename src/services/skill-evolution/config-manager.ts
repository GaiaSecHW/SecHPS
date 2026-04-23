// src/services/skill-evolution/config-manager.ts
/**
 * Skill 进化配置管理器
 * 
 * 功能：
 * 1. 获取/更新 SkillEvolutionConfig
 * 2. 验证阈值值
 * 3. 重置为默认配置
 */

import { prisma } from '@/lib/prisma';
import { DEFAULT_EVOLUTION_CONFIG } from './evolution-scheduler';
import type { SkillEvolutionConfig } from '@prisma/client';

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 获取当前进化配置
 * 
 * @returns 进化配置
 */
export async function getConfig(): Promise<SkillEvolutionConfig> {
  const config = await prisma.skillEvolutionConfig.findUnique({
    where: { id: 'default' },
  });

  if (config) {
    return config;
  }

  // 如果数据库中没有配置，创建默认配置
  const defaultConfig = await prisma.skillEvolutionConfig.create({
    data: {
      id: 'default',
      precisionThreshold: DEFAULT_EVOLUTION_CONFIG.PRECISION_THRESHOLD,
      minFalsePositives: DEFAULT_EVOLUTION_CONFIG.MIN_FALSE_POSITIVES,
      minConfirmed: DEFAULT_EVOLUTION_CONFIG.MIN_CONFIRMED,
      falsePositiveLimit: DEFAULT_EVOLUTION_CONFIG.FALSE_POSITIVE_LIMIT,
      confirmedLimit: DEFAULT_EVOLUTION_CONFIG.CONFIRMED_LIMIT,
      scheduleCron: '0 3 * * *',
      maxDailyTasks: DEFAULT_EVOLUTION_CONFIG.MAX_DAILY_TASKS,
      maxDescriptionLength: 200,
      codeSnippetLines: 6,
      isActive: true,
      updatedAt: new Date(),
    },
  });

  return defaultConfig;
}

/**
 * 更新进化配置
 * 
 * @param updates 部分配置更新
 * @returns 更新后的配置
 */
export async function updateConfig(
  updates: Partial<SkillEvolutionConfig>
): Promise<SkillEvolutionConfig> {
  // 验证更新值
  const validation = validateThresholds(updates);
  if (!validation.valid) {
    throw new Error(`Invalid config values: ${validation.errors.join(', ')}`);
  }

  // 过滤掉不允许更新的字段
  const allowedUpdates: Partial<SkillEvolutionConfig> = {};
  const allowedFields = [
    'precisionThreshold',
    'minFalsePositives',
    'minConfirmed',
    'falsePositiveLimit',
    'confirmedLimit',
    'scheduleCron',
    'maxDailyTasks',
    'maxDescriptionLength',
    'codeSnippetLines',
    'isActive',
  ];

  for (const field of allowedFields) {
    if (field in updates) {
      (allowedUpdates as Record<string, unknown>)[field] = updates[field as keyof SkillEvolutionConfig];
    }
  }

  // 确保配置存在
  const existingConfig = await prisma.skillEvolutionConfig.findUnique({
    where: { id: 'default' },
  });

  if (!existingConfig) {
    // 先创建默认配置，再更新
    await getConfig();
  }

  // 执行更新
  const updatedConfig = await prisma.skillEvolutionConfig.update({
    where: { id: 'default' },
    data: allowedUpdates,
  });

  return updatedConfig;
}

/**
 * 重置为默认配置
 * 
 * @returns 重置后的配置
 */
export async function resetToDefaults(): Promise<SkillEvolutionConfig> {
  const defaultValues = {
    precisionThreshold: DEFAULT_EVOLUTION_CONFIG.PRECISION_THRESHOLD,
    minFalsePositives: DEFAULT_EVOLUTION_CONFIG.MIN_FALSE_POSITIVES,
    minConfirmed: DEFAULT_EVOLUTION_CONFIG.MIN_CONFIRMED,
    falsePositiveLimit: DEFAULT_EVOLUTION_CONFIG.FALSE_POSITIVE_LIMIT,
    confirmedLimit: DEFAULT_EVOLUTION_CONFIG.CONFIRMED_LIMIT,
    scheduleCron: '0 3 * * *',
    maxDailyTasks: DEFAULT_EVOLUTION_CONFIG.MAX_DAILY_TASKS,
    maxDescriptionLength: 200,
    codeSnippetLines: 6,
    isActive: true,
  };

  // 确保配置存在
  const existingConfig = await prisma.skillEvolutionConfig.findUnique({
    where: { id: 'default' },
  });

  if (!existingConfig) {
    // 创建默认配置
    return getConfig();
  }

  // 更新为默认值
  const resetConfig = await prisma.skillEvolutionConfig.update({
    where: { id: 'default' },
    data: defaultValues,
  });

  return resetConfig;
}

/**
 * 验证阈值值
 * 
 * @param config 部分配置
 * @returns 验证结果
 */
export function validateThresholds(config: Partial<SkillEvolutionConfig>): ValidationResult {
  const errors: string[] = [];

  // precisionThreshold: 0-1 (0% to 100%)
  if (config.precisionThreshold !== undefined) {
    if (config.precisionThreshold < 0 || config.precisionThreshold > 1) {
      errors.push(`precisionThreshold must be between 0 and 1 (got ${config.precisionThreshold})`);
    }
  }

  // minFalsePositives: >= 0
  if (config.minFalsePositives !== undefined) {
    if (config.minFalsePositives < 0) {
      errors.push(`minFalsePositives must be >= 0 (got ${config.minFalsePositives})`);
    }
  }

  // minConfirmed: >= 0
  if (config.minConfirmed !== undefined) {
    if (config.minConfirmed < 0) {
      errors.push(`minConfirmed must be >= 0 (got ${config.minConfirmed})`);
    }
  }

  // maxDailyTasks: >= 1
  if (config.maxDailyTasks !== undefined) {
    if (config.maxDailyTasks < 1) {
      errors.push(`maxDailyTasks must be >= 1 (got ${config.maxDailyTasks})`);
    }
  }

  // falsePositiveLimit: >= 1
  if (config.falsePositiveLimit !== undefined) {
    if (config.falsePositiveLimit < 1) {
      errors.push(`falsePositiveLimit must be >= 1 (got ${config.falsePositiveLimit})`);
    }
  }

  // confirmedLimit: >= 1
  if (config.confirmedLimit !== undefined) {
    if (config.confirmedLimit < 1) {
      errors.push(`confirmedLimit must be >= 1 (got ${config.confirmedLimit})`);
    }
  }

  // maxDescriptionLength: >= 50 (reasonable minimum)
  if (config.maxDescriptionLength !== undefined) {
    if (config.maxDescriptionLength < 50) {
      errors.push(`maxDescriptionLength must be >= 50 (got ${config.maxDescriptionLength})`);
    }
  }

  // codeSnippetLines: >= 1
  if (config.codeSnippetLines !== undefined) {
    if (config.codeSnippetLines < 1) {
      errors.push(`codeSnippetLines must be >= 1 (got ${config.codeSnippetLines})`);
    }
  }

  // scheduleCron: basic validation (non-empty string)
  if (config.scheduleCron !== undefined) {
    if (!config.scheduleCron || config.scheduleCron.trim() === '') {
      errors.push('scheduleCron must be a non-empty string');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 获取配置变更历史
 * 
 * 注意：SkillEvolutionConfig 模型有 updatedAt 字段，
 * 但没有专门的变更历史表。此函数返回当前配置和最后更新时间。
 * 
 * @returns 配置信息和最后更新时间
 */
export async function getConfigInfo(): Promise<{
  config: SkillEvolutionConfig;
  lastUpdated: Date;
}> {
  const config = await getConfig();
  
  return {
    config,
    lastUpdated: config.updatedAt,
  };
}

/**
 * 检查配置是否激活
 * 
 * @returns 配置是否激活
 */
export async function isConfigActive(): Promise<boolean> {
  const config = await getConfig();
  return config.isActive;
}

/**
 * 设置配置激活状态
 * 
 * @param isActive 是否激活
 * @returns 更新后的配置
 */
export async function setConfigActive(isActive: boolean): Promise<SkillEvolutionConfig> {
  return updateConfig({ isActive });
}