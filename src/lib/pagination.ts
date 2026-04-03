// src/lib/pagination.ts

import type { PaginationParams, PaginatedResponse, CursorPaginationParams, CursorPaginatedResponse } from '@/types/pagination';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function getOffsetPagination(params: PaginationParams): { skip: number; take: number; page: number; limit: number } {
  const limit = Math.min(params.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = Math.max(params.page || 1, 1);
  const skip = (page - 1) * limit;

  return { skip, take: limit, page, limit };
}

export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

export function getCursorPagination(params: CursorPaginationParams): { take: number; cursor?: { id: string } } {
  const limit = Math.min(params.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const cursor = params.cursor ? { id: params.cursor } : undefined;

  return { take: limit + 1, cursor };
}

export function createCursorPaginatedResponse<T extends { id: string }>(
  data: T[],
  limit: number
): CursorPaginatedResponse<T> {
  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, -1) : data;
  const nextCursor = items.length > 0 ? items[items.length - 1].id : null;

  return {
    data: items,
    pagination: {
      nextCursor,
      hasMore,
      limit,
    },
  };
}

export function getSortOptions(
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
  defaultSortBy: string = 'createdAt',
  defaultSortOrder: 'asc' | 'desc' = 'desc'
): Record<string, 'asc' | 'desc'> {
  const field = sortBy || defaultSortBy;
  const order = sortOrder || defaultSortOrder;
  return { [field]: order };
}
