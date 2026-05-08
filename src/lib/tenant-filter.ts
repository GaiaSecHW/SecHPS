import type { TenantContext } from '@/lib/tenant';

/**
 * 构建基于租户的 WHERE 条件
 */
export function buildTenantFilter(
  context: TenantContext,
  options?: {
    tenantField?: string;
    visibilityField?: string;
  }
): object {
  const { tenantField = 'tenantId', visibilityField = 'visibility' } = options ?? {};

  // 平台管理员（admin，无租户）：返回空条件（不过滤）
  if (context.isPlatformAdmin) {
    return {};
  }

  // ICSL 租户：返回空条件（可访问所有）
  if (context.isIcsTenant) {
    return {};
  }

  // 无租户普通用户：只能看 public
  if (!context.tenantId) {
    return { [visibilityField]: 'public' };
  }

  // 普通租户用户：看 public 或同租户
  return {
    OR: [
      { [tenantField]: context.tenantId },
      { [visibilityField]: 'public' },
    ],
  };
}

/**
 * 获取创建资源时的 tenantId 值
 */
export function getTenantIdForCreate(
  context: TenantContext,
  isPublic: boolean
): string | null {
  if (isPublic) return null;
  if (context.isPlatformAdmin) return null;
  return context.tenantId;
}

/**
 * 获取 visibility 值
 */
export function getVisibility(isPublic: boolean): string {
  return isPublic ? 'public' : 'private';
}
