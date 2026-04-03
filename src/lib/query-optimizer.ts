// src/lib/query-optimizer.ts

import { Prisma } from '@prisma/client';

/**
 * Select only specific fields to reduce data transfer
 */
export function selectFields<T extends Record<string, unknown>>(
  fields: (keyof T)[]
): Prisma.SelectSubset<T, T> {
  return fields.reduce((acc, field) => {
    acc[field as string] = true;
    return acc;
  }, {} as Record<string, boolean>) as Prisma.SelectSubset<T, T>;
}

/**
 * Common user select for minimal user data
 */
export const userSelectMinimal = {
  id: true,
  email: true,
  username: true,
  name: true,
  avatar: true,
  isActive: true,
  createdAt: true,
};

/**
 * Common workflow select for list views
 */
export const workflowSelectMinimal = {
  id: true,
  name: true,
  description: true,
  thumbnail: true,
  status: true,
  version: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Common workflow select with user info
 */
export const workflowSelectWithUser = {
  id: true,
  name: true,
  description: true,
  thumbnail: true,
  status: true,
  version: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: userSelectMinimal,
  },
};

/**
 * Common skill select for list views
 */
export const skillSelectMinimal = {
  id: true,
  name: true,
  displayName: true,
  description: true,
  category: true,
  severity: true,
  isActive: true,
  successRate: true,
  execCount: true,
};

/**
 * Common pattern select for list views
 */
export const patternSelectMinimal = {
  id: true,
  name: true,
  displayName: true,
  description: true,
  category: true,
  isActive: true,
  isBuiltin: true,
};

/**
 * Build where clause with optional filters
 */
export function buildWhereClause<T extends Record<string, unknown>>(
  filters: Partial<T>
): Partial<T> {
  const where: Partial<T> = {};

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      (where as Record<string, unknown>)[key] = value;
    }
  }

  return where;
}

/**
 * Build search filter for text fields
 */
export function buildSearchFilter(
  searchFields: string[],
  searchTerm?: string
): Prisma.WhereInput | undefined {
  if (!searchTerm || searchTerm.trim() === '') {
    return undefined;
  }

  const term = searchTerm.trim();

  if (searchFields.length === 1) {
    return { [searchFields[0]]: { contains: term } };
  }

  return {
    OR: searchFields.map((field) => ({
      [field]: { contains: term },
    })),
  };
}

/**
 * Build date range filter
 */
export function buildDateRangeFilter(
  startDate?: Date | string,
  endDate?: Date | string
): { gte?: Date; lte?: Date } | undefined {
  const filter: { gte?: Date; lte?: Date } = {};

  if (startDate) {
    filter.gte = typeof startDate === 'string' ? new Date(startDate) : startDate;
  }

  if (endDate) {
    filter.lte = typeof endDate === 'string' ? new Date(endDate) : endDate;
  }

  if (Object.keys(filter).length === 0) {
    return undefined;
  }

  return filter;
}

/**
 * Build status filter
 */
export function buildStatusFilter(
  statuses?: string[]
): { in: string[] } | undefined {
  if (!statuses || statuses.length === 0) {
    return undefined;
  }

  return { in: statuses };
}

/**
 * Combine multiple where clauses
 */
export function combineWhereClauses(
  ...clauses: (Prisma.WhereInput | undefined)[]
): Prisma.WhereInput {
  const validClauses = clauses.filter((c) => c !== undefined && Object.keys(c).length > 0);

  if (validClauses.length === 0) {
    return {};
  }

  if (validClauses.length === 1) {
    return validClauses[0] as Prisma.WhereInput;
  }

  return { AND: validClauses };
}

/**
 * Count query optimization - use count with where only
 */
export async function optimizedCount<T>(
  model: { count: (args: { where: unknown }) => Promise<number> },
  where: unknown
): Promise<number> {
  return model.count({ where });
}
