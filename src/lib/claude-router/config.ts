import { prisma } from '@/lib/prisma';

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
 * 从数据库加载路由配置
 */
async function loadRouterConfigs() {
  const routerConfigs = await prisma.routerConfig.findMany();

  return routerConfigs;
}

/**
 * 将数据库配置转换为 CCR 格式
 */
function transformToCcrConfig(
  modelConfigs: any[],
  routerConfigs: any[]
): CcrConfig {
  // 转换提供商配置
  const providers: CcrProviderConfig[] = modelConfigs.map((modelConfig) => {
    return {
      name: modelConfig.name,
      providerType: modelConfig.providerType || 'openai',
      api_base_url: modelConfig.apiBaseUrl,
      api_key: modelConfig.apiKey,
      models: JSON.parse(modelConfig.models),
      transformer: modelConfig.transformer
        ? JSON.parse(modelConfig.transformer)
        : undefined
    };
  });

  // 创建路由配置映射
  const routerMap = new Map<string, string>();
  routerConfigs.forEach((routerConfig) => {
    // 查找对应的模型配置
    const modelConfig = modelConfigs.find(
      (m) => m.id === routerConfig.modelId
    );
    if (modelConfig) {
      // 解析模型列表，取第一个作为默认模型
      const models = JSON.parse(modelConfig.models);
      const firstModel = models[0];
      routerMap.set(
(routerConfig.routeType),
        `${modelConfig.name},${firstModel}`
      );
    }
  });

  // 构建路由配置
  const router: CcrRouterConfig = {
    default: routerMap.get('default') || '',
    background: routerMap.get('background'),
    think: routerMap.get('think'),
    longContext: routerMap.get('longContext'),
    webSearch: routerMap.get('webSearch'),
    longContextThreshold: 60000 // 默认阈值
  };

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
  const [modelConfigs, routerConfigs] = await Promise.all([
    loadModelConfigs(),
    loadRouterConfigs()
  ]);

  // 转换为 CCR 格式
  const config = transformToCcrConfig(modelConfigs, routerConfigs);

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
