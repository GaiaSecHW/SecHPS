// src/types/pagination.ts

/**
 * 分页参数
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
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
  hasMore: boolean;
  limit?: number;
}

/**
 * 游标分页响应
 */
export interface CursorPaginatedResponse<T> {
  data: T[];
  pagination: CursorPaginationInfo;
}

/**
 * 偏移分页选项
 */
export interface OffsetPaginationOptions {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * 游标分页选项
 */
export interface CursorPaginationOptions {
  cursor?: string;
  limit: number;
  cursorField?: string;
}
