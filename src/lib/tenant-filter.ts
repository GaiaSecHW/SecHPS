import type { TenantContext } from '@/lib/tenant';

/**
 * 构建基于租户的 WHERE 条件
 */
export function buildTenantFilter(
  context: TenantContext,
  options?: {
    tenantField?: string;
    isPublicField?: string;
  }
): object {
  const { tenantField = 'tenantId', isPublicField = 'isPublic' } = options ?? {};

  // 平台管理员（admin，无租户）：返回空条件（不过滤）
  if (context.isPlatformAdmin) {
    return {};
  }

  // ICSL 租户：返回空条件（可访问所有）
  if (context.isIcsTenant) {
    return {};
  }

  // 无租户普通用户：只能看 isPublic 的
  if (!context.tenantId) {
    return { [isPublicField]: true };
  }

  // 普通租户用户：看 isPublic 或同租户
  return {
    OR: [
      { [tenantField]: context.tenantId },
      { [isPublicField]: true },
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
