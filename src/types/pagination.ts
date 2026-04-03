// src/types/pagination.ts

/**
 * 分页参数
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
}

/**
 * 分页信息
 */
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * 分页响应
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}

/**
 * 游标分页参数
 */
export interface CursorPaginationParams {
  cursor?: string;
  limit?: number;
}

/**
 * 游标分页信息
 */
export interface CursorPaginationInfo {
  nextCursor: string | null;
  hasNext: boolean;
}

/**
 * 游标分页响应
 */
export interface CursorPaginatedResponse<T> {
  data: T[];
  pagination: CursorPaginationInfo;
}
