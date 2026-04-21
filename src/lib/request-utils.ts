// src/lib/request-utils.ts
/**
 * 请求参数解析工具
 * 
 * 统一的请求参数解析逻辑，减少 API 路由中的重复代码
 */

import { getOffsetPagination, DEFAULT_PAGE_SIZE } from './pagination';

/**
 * URL 查询参数解析器
 */
export interface QueryParamsParser {
  /** 获取字符串参数 */
  get: (key: string, defaultValue?: string) => string | undefined;
  /** 获取字符串参数（必须存在） */
  getRequired: (key: string) => string;
  /** 获取整数参数 */
  getInt: (key: string, defaultValue?: number) => number;
  /** 获取布尔参数 */
  getBoolean: (key: string, defaultValue?: boolean) => boolean;
  /** 获取 JSON 参数 */
  getJson: <T = unknown>(key: string, defaultValue?: T) => T | undefined;
  /** 获取数组参数（逗号分隔） */
  getArray: (key: string, defaultValue?: string[]) => string[];
  /** 获取枚举参数 */
  getEnum: <T extends string>(key: string, allowedValues: T[], defaultValue?: T) => T | undefined;
  /** 原始 searchParams */
  raw: URLSearchParams;
}

/**
 * 解析请求的查询参数
 * 
 * @param request - Next.js Request 对象
 * @returns 查询参数解析器
 * 
 * @example
 * const params = parseQueryParams(request);
 * const page = params.getInt('page', 1);
 * const limit = params.getInt('limit', 20);
 * const status = params.get('status');
 * const tags = params.getArray('tags');
 */
export function parseQueryParams(request: Request): QueryParamsParser {
  const { searchParams } = new URL(request.url);

  const parser: QueryParamsParser = {
    get: (key: string, defaultValue?: string) => {
      const value = searchParams.get(key);
      return value !== null ? value : defaultValue;
    },

    getRequired: (key: string) => {
      const value = searchParams.get(key);
      if (value === null) {
        throw new Error(`缺少必需的查询参数: ${key}`);
      }
      return value;
    },

    getInt: (key: string, defaultValue: number = 0) => {
      const value = searchParams.get(key);
      if (value === null) return defaultValue;
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? defaultValue : parsed;
    },

    getBoolean: (key: string, defaultValue: boolean = false) => {
      const value = searchParams.get(key);
      if (value === null) return defaultValue;
      return value === 'true' || value === '1' || value === 'yes';
    },

    getJson: <T = unknown>(key: string, defaultValue?: T) => {
      const value = searchParams.get(key);
      if (value === null) return defaultValue;
      try {
        return JSON.parse(value) as T;
      } catch {
        return defaultValue;
      }
    },

    getArray: (key: string, defaultValue: string[] = []) => {
      const value = searchParams.get(key);
      if (value === null) return defaultValue;
      return value.split(',').map(s => s.trim()).filter(Boolean);
    },

    getEnum: <T extends string>(key: string, allowedValues: T[], defaultValue?: T) => {
      const value = searchParams.get(key) as T;
      if (value === null) return defaultValue;
      return allowedValues.includes(value) ? value : defaultValue;
    },

    raw: searchParams,
  };

  return parser;
}

/**
 * 解析分页参数
 * 
 * @param request - Next.js Request 对象
 * @returns 分页参数（skip, take, page, limit）
 * 
 * @example
 * const { skip, take, page, limit } = parsePaginationParams(request);
 * const users = await prisma.user.findMany({ skip, take });
 */
export function parsePaginationParams(request: Request): {
  skip: number;
  take: number;
  page: number;
  limit: number;
} {
  const params = parseQueryParams(request);
  const page = params.getInt('page', 1);
  const limit = params.getInt('limit', params.getInt('pageSize', DEFAULT_PAGE_SIZE));
  
  return getOffsetPagination({ page, limit });
}

/**
 * 解析分页参数并返回完整的分页信息
 * 
 * @param request - Next.js Request 对象
 * @returns 分页参数和解析器
 * 
 * @example
 * const { skip, take, page, limit, params } = parsePaginationWithParams(request);
 * const status = params.get('status');
 * const users = await prisma.user.findMany({ 
 *   skip, 
 *   take,
 *   where: status ? { status } : undefined
 * });
 */
export function parsePaginationWithParams(request: Request): {
  skip: number;
  take: number;
  page: number;
  limit: number;
  params: QueryParamsParser;
} {
  const pagination = parsePaginationParams(request);
  const params = parseQueryParams(request);
  
  return { ...pagination, params };
}

/**
 * 解析排序参数
 * 
 * @param request - Next.js Request 对象
 * @param defaultField - 默认排序字段
 * @param defaultOrder - 默认排序方向
 * @returns 排序对象
 * 
 * @example
 * const orderBy = parseSortParams(request, 'createdAt', 'desc');
 * const users = await prisma.user.findMany({ orderBy });
 */
export function parseSortParams(
  request: Request,
  defaultField: string = 'createdAt',
  defaultOrder: 'asc' | 'desc' = 'desc'
): Record<string, 'asc' | 'desc'> {
  const params = parseQueryParams(request);
  const sortBy = params.get('sortBy') || params.get('sort') || defaultField;
  const sortOrder = params.getEnum<'asc' | 'desc'>('sortOrder', ['asc', 'desc'], defaultOrder) ?? defaultOrder;
  
  return { [sortBy]: sortOrder };
}

/**
 * 解析日期范围参数
 * 
 * @param request - Next.js Request 对象
 * @returns 日期范围对象
 * 
 * @example
 * const { startDate, endDate } = parseDateRangeParams(request);
 * const logs = await prisma.auditLog.findMany({
 *   where: {
 *     createdAt: {
 *       gte: startDate,
 *       lte: endDate,
 *     }
 *   }
 * });
 */
export function parseDateRangeParams(request: Request): {
  startDate: Date | null;
  endDate: Date | null;
} {
  const params = parseQueryParams(request);
  
  const startDateStr = params.get('startDate') || params.get('from') || params.get('since');
  const endDateStr = params.get('endDate') || params.get('to') || params.get('until');
  
  const startDate = startDateStr ? new Date(startDateStr) : null;
  const endDate = endDateStr ? new Date(endDateStr) : null;
  
  // 验证日期有效性
  return {
    startDate: startDate && !isNaN(startDate.getTime()) ? startDate : null,
    endDate: endDate && !isNaN(endDate.getTime()) ? endDate : null,
  };
}

/**
 * 解析搜索关键词参数
 * 
 * @param request - Next.js Request 对象
 * @returns 搜索关键词
 * 
 * @example
 * const keyword = parseSearchParams(request);
 * const users = await prisma.user.findMany({
 *   where: keyword ? {
 *     OR: [
 *       { name: { contains: keyword } },
 *       { email: { contains: keyword } },
 *     ]
 *   } : undefined
 * });
 */
export function parseSearchParams(request: Request): string | null {
  const params = parseQueryParams(request);
  return params.get('search') || params.get('q') || params.get('keyword') || null;
}

/**
 * 构建通用的列表查询条件
 * 
 * @param request - Next.js Request 对象
 * @param options - 查询选项
 * @returns 查询条件和分页信息
 */
export function buildListQueryOptions(request: Request, options?: {
  defaultSortField?: string;
  defaultSortOrder?: 'asc' | 'desc';
  searchFields?: string[];
}): {
  where: Record<string, unknown>;
  orderBy: Record<string, 'asc' | 'desc'>;
  skip: number;
  take: number;
  page: number;
  limit: number;
  search: string | null;
} {
  const { skip, take, page, limit, params } = parsePaginationWithParams(request);
  const orderBy = parseSortParams(request, options?.defaultSortField, options?.defaultSortOrder);
  const search = parseSearchParams(request);
  
  const where: Record<string, unknown> = {};
  
  // 如果有搜索关键词，构建搜索条件
  if (search && options?.searchFields?.length) {
    where.OR = options.searchFields.map(field => ({
      [field]: { contains: search },
    }));
  }
  
  return {
    where,
    orderBy,
    skip,
    take,
    page,
    limit,
    search,
  };
}
