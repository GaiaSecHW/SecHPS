import { prisma } from '@/lib/prisma';
import { AnthropicTransformer } from './llms/transformer/anthropic.transformer';

/**
 * CCR 提供商配置接口
 */
export interface CcrProviderConfig {
  name: string;
  providerType: 'claude' | 'openai';  // 代理类型
  api_base_url: string;
  api_key: string;
  models: string[];
  transformer?: { use: string[] };
}

/**
 * CCR 路由配置接口
 */
export interface CcrRouterConfig {
  default: string;  // "providerName,modelName"
  background?: string;
  think?: string;
  longContext?: string;
  webSearch?: string;
  longContextThreshold?: number;
}

/**
 * CCR 完整配置接口
 */
export interface CcrConfig {
  providers: CcrProviderConfig[];
  router: CcrRouterConfig;
}

/**
 * 配置缓存
 */
interface ConfigCache {
  config: CcrConfig | null;
  timestamp: number;
}

// 缓存配置，5分钟过期
const CACHE_TTL = 5 * 60 * 1000;
let configCache: ConfigCache = {
  config: null,
  timestamp: 0
};

/**
 * 从数据库加载模型配置
 */
async function loadModelConfigs() {
  const modelConfigs = await prisma.modelConfig.findMany({
    where: {
      isActive: true
    },
    orderBy: {
      isDefault: 'desc'
    }
  });

  return modelConfigs;
}

/**
 * 解析模型字段（支持 JSON 数组或单个字符串）
 */
function parseModelsField(modelsData: string): string[] {
  if (!modelsData) return ['default'];
  try {
    const parsed = JSON.parse(modelsData);
    if (Array.isArray(parsed)) {
      return parsed.length > 0 ? parsed : ['default'];
    }
    // 如果是字符串，转为数组
    return [parsed];
  } catch {
    // 如果解析失败，直接作为模型名称
    return [modelsData];
  }
}

/**
 * 将数据库配置转换为 CCR 格式
 * 所有配置都来自 ModelConfig 表
 */
function transformToCcrConfig(modelConfigs: any[]): CcrConfig {
  // 转换提供商配置
  const providers: CcrProviderConfig[] = modelConfigs.map((modelConfig) => {
    const models = parseModelsField(modelConfig.models);
    return {
      name: modelConfig.name,
      providerType: modelConfig.providerType || 'openai',
      api_base_url: modelConfig.apiBaseUrl,
      api_key: modelConfig.apiKey,
      models,
    };
  });

  // 从 ModelConfig 的 routeType 字段构建路由配置
  const router: CcrRouterConfig = {
    default: '',
    background: undefined,
    think: undefined,
    longContext: undefined,
    webSearch: undefined,
    longContextThreshold: 60000
  };

  // 默认路由使用 isDefault=true 的模型，或第一个激活的模型
  const defaultModel = modelConfigs.find(m => m.isDefault) || modelConfigs[0];
  if (defaultModel) {
    const models = parseModelsField(defaultModel.models);
    const firstModel = models[0] || 'default';
    router.default = `${defaultModel.name},${firstModel}`;
  }

  // 根据每个模型的 routeType 字段设置路由
  modelConfigs.forEach(modelConfig => {
    if (!modelConfig.routeType) return;

    const models = parseModelsField(modelConfig.models);
    const firstModel = models[0] || 'default';
    const routeValue = `${modelConfig.name},${firstModel}`;

    switch (modelConfig.routeType) {
      case 'think':
        router.think = routeValue;
        break;
      case 'background':
        router.background = routeValue;
        break;
      case 'longContext':
        router.longContext = routeValue;
        break;
      case 'webSearch':
        router.webSearch = routeValue;
        break;
    }
  });

  return {
    providers,
    router
  };
}

/**
 * 获取 CCR 配置（带缓存）
 */
export async function getCcrConfig(): Promise<CcrConfig> {
  const now = Date.now();

  // 检查缓存是否有效
  if (
    configCache.config &&
    configCache.timestamp &&
    now - configCache.timestamp < CACHE_TTL
  ) {
    return configCache.config;
  }

  // 从数据库加载配置
  const modelConfigs = await loadModelConfigs();

  // 转换为 CCR 格式
  const config = transformToCcrConfig(modelConfigs);

  // 更新缓存
  configCache = {
    config,
    timestamp: now
  };

  return config;
}

/**
 * 清除配置缓存
 */
export function clearConfigCache(): void {
  configCache = {
    config: null,
    timestamp: 0
  };
}

/**
 * 强制重新加载配置
 */
export async function reloadConfig(): Promise<CcrConfig> {
  clearConfigCache();
  return getCcrConfig();
}
