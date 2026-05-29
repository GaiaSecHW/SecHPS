import type { TenantContext } from '@/lib/tenant';

/**
 * 构建基于租户的 WHERE 条件
 *
 * 安全策略：
 * - 平台管理员（admin角色 + 无租户）：可访问所有数据（不过滤）
 * - ICSL 租户管理员（ICSL租户 + admin角色）：可访问所有数据（不过滤）
 * - ICSL 租户普通用户：同普通租户用户逻辑（看同租户 + 公共）
 * - 普通租户用户：看 isPublic 或同租户
 * - 无租户普通用户：只能看 isPublic 的
 */
export function buildTenantFilter(
  context: TenantContext,
  options?: {
    tenantField?: string;
    isPublicField?: string;
    icslBypassRoles?: string[];
    userRoles?: string[];
  }
): Record<string, unknown> {
  const { tenantField = 'tenantId', isPublicField = 'isPublic', icslBypassRoles = ['admin'], userRoles = [] } = options ?? {};

  // 平台管理员（admin角色，无租户）：返回空条件（不过滤）
  if (context.isPlatformAdmin) {
    return {};
  }

  // ICSL 租户：只有 admin 等特权角色可以访问所有数据，普通用户仍需租户过滤
  if (context.isIcsTenant) {
    if (userRoles.some(role => icslBypassRoles.includes(role))) {
      return {};
    }
    // ICSL 普通用户：看同租户 + 公共（与普通租户逻辑一致）
    return {
      OR: [
        { [tenantField]: context.tenantId },
        { [isPublicField]: true },
      ],
    };
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

/**
 * 便捷函数：将租户过滤条件合并到现有 Prisma WHERE 条件中
 *
 * 用法示例：
 * ```typescript
 * const auth = authenticateRequestEnhanced(request);
 * if (!auth.success) return authErrorResponse(auth);
 * const { payload, tenant } = auth as AuthSuccessResult;
 *
 * const where = withTenantFilter(tenant, { status: 'active' }, { userRoles: payload.roles });
 * const data = await prisma.skill.findMany({ where });
 * ```
 */
export function withTenantFilter(
  context: TenantContext,
  existingWhere: Record<string, unknown> = {},
  options?: {
    tenantField?: string;
    isPublicField?: string;
    icslBypassRoles?: string[];
    userRoles?: string[];
  }
): Record<string, unknown> {
  const tenantFilter = buildTenantFilter(context, options);

  // 如果租户过滤为空（管理员/ICSL特权），直接返回原有条件
  if (Object.keys(tenantFilter).length === 0) {
    return existingWhere;
  }

  // 合并租户过滤与原有查询条件
  return {
    ...existingWhere,
    ...tenantFilter,
  };
}

/**
 * 便捷函数：为通过 ID 直接访问资源的场景验证租户归属
 *
 * 用法示例：
 * ```typescript
 * const auth = authenticateRequestEnhanced(request);
 * if (!auth.success) return authErrorResponse(auth);
 * const { payload, tenant } = auth as AuthSuccessResult;
 *
 * const resource = await prisma.project.findFirst({
 *   where: { id: projectId, ...validateTenantAccess(tenant, { userRoles: payload.roles }) },
 * });
 * if (!resource) return NextResponse.json({ error: '资源不存在' }, { status: 404 });
 * ```
 */
export function validateTenantAccess(
  context: TenantContext,
  options?: {
    tenantField?: string;
    isPublicField?: string;
    icslBypassRoles?: string[];
    userRoles?: string[];
  }
): Record<string, unknown> {
  const tenantFilter = buildTenantFilter(context, {
    ...options,
    // 对于 ID 直接访问，isPublic 资源也应可见（与列表查询一致）
    isPublicField: options?.isPublicField ?? 'isPublic',
  });

  // 管理员/ICSL特权角色：不添加额外过滤
  if (Object.keys(tenantFilter).length === 0) {
    return {};
  }

  return tenantFilter;
}
