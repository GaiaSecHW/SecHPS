// src/lib/pagination.ts

import type { PaginatedResponse, PaginationParams } from '@/types/pagination';

/**
 * 获取偏移分页参数
 */
export function getOffsetPagination(params: PaginationParams) {
  const { page = 1, limit = 20 } = params;
  const pageNum = Math.max(1, page);
  const pageLimit = Math.min(Math.max(1, limit), 100); // 最大100条
  const skip = (pageNum - 1) * pageLimit;
  const take = pageLimit;

  return { skip, take, page: pageNum, limit: pageLimit };
}

/**
 * 创建分页响应
 */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext,
      hasPrev,
    },
  };
}

/**
 * 获取游标分页参数
 */
export function getCursorPagination(params: {
  cursor?: string;
  limit?: number;
}) {
  const { cursor, limit = 20 } = params;
  const pageLimit = Math.min(Math.max(1, limit), 100);

  return {
    cursor: cursor || undefined,
    take: pageLimit,
    skip: cursor ? 1 : 0, // 跳过游标本身
  };
}

/**
 * 创建游标分页响应
 */
export function createCursorPaginatedResponse<T extends { id: string }>(
  data: T[],
  limit: number,
  getNextCursor?: (lastItem: T) => string | null
): {
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasNext: boolean;
  };
} {
  const hasNext = data.length === limit;
  const nextCursor = hasNext && data.length > 0
    ? (getNextCursor ? getNextCursor(data[data.length - 1]) : data[data.length - 1].id)
    : null;

  return {
    data,
    pagination: {
      nextCursor,
      hasNext,
    },
  };
}
