import type { JWTPayload } from '@/lib/auth';

export interface TenantContext {
  tenantId: string | null;   // null 表示平台管理员
  isIcsTenant: boolean;      // 是否 ICSL 租户
  isPlatformAdmin: boolean;  // 平台管理员（admin 角色，无租户）
}

/**
 * 从 JWT payload 获取租户上下文
 */
export function getTenantContext(payload: JWTPayload): TenantContext {
  const isSuperAdmin = payload.roles?.includes('admin');

  return {
    tenantId: payload.tenantId ?? null,
    isIcsTenant: payload.isIcsTenant ?? false,
    isPlatformAdmin: isSuperAdmin && !payload.tenantId,
  };
}
