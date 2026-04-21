// src/hooks/index.ts
/**
 * Hooks 统一导出
 * 
 * 使用方式：
 * import { useAuth, useApiFetch, useIsAdmin } from '@/hooks';
 */

// 认证相关
export {
  useAuth,
  useIsAdmin,
  usePermission,
} from './useAuth';

export type { UserInfo, UseAuthReturn } from './useAuth';

// API 请求相关
export {
  useApiFetch,
  useApiPost,
  useApiPut,
  useApiDelete,
  useApiRequest,
  useApiPaginated,
} from './useApiFetch';

export type {
  UseApiFetchOptions,
  UseApiFetchReturn,
} from './useApiFetch';

// 技术栈选项
export {
  useTechStackOptions,
  useTechStackOptionsWithIds,
} from './useTechStackOptions';

export type { TechStackOptionWithId } from './useTechStackOptions';

// 漏洞模式
export { useVulnerabilityPatterns } from './useVulnerabilityPatterns';

// Skill 分类
export { useSkillCategories } from './useSkillCategories';

// Ralph 事件
export { useRalphEvents } from './use-ralph-events';
