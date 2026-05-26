/**
 * beijing-time.ts
 * 北京时间（UTC+8）相关辅助函数
 *
 * 所有时间计算都以北京时间为基准，使用 Intl.DateTimeFormat 实现，
 * 与服务器本地时区完全无关——无论 Node.js 进程运行在 UTC 还是 UTC+8，
 * 结果始终一致。
 *
 * ⚠️ 重要区分：
 *   - getBeijingNow() 返回的 Date 是"伪 UTC Date"，仅用于提取北京时间组件（小时/日期等）
 *     其 .getTime() 不代表真实 UTC epoch，不可用于 DB 查询或时间差计算
 *   - getBeijingTodayStart() 等函数返回的 Date 是真实 UTC epoch，可用于 Prisma DB 查询
 *   - getBeijingHourMinutes() 直接返回 hour*60+minute，最安全的时间窗口判断方式
 */

const BEIJING_TIMEZONE = 'Asia/Shanghai';
const BEIJING_OFFSET_MS = 8 * 3600000; // UTC+8, 北京无夏令时

/**
 * 获取北京时间的日期/时间组件（时区无关，使用 Intl）
 * 核心工具函数，所有其他函数都依赖此实现
 */
function getBeijingParts(date: Date | number = Date.now()): {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
} {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(d);

  const result: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      result[part.type] = parseInt(part.value, 10);
    }
  }
  // Intl 可能返回 hour=24（表示次日 00:00），需归零
  return {
    year: result.year,
    month: result.month,
    day: result.day,
    hour: result.hour === 24 ? 0 : result.hour,
    minute: result.minute,
    second: result.second,
  };
}

/**
 * 获取当前北京时间的"伪 UTC Date"
 *
 * 返回的 Date 对象：getFullYear()/getMonth()/getDate()/getHours()/getMinutes()
 * 返回北京时间的值，无论服务器在哪个时区。
 *
 * ⚠️ 此 Date 仅用于提取北京时间组件，不要用于 DB 查询或时间差计算。
 *    其 .getTime() 不代表真实 UTC epoch。
 */
export function getBeijingNow(): Date {
  const parts = getBeijingParts();
  // 构造 UTC epoch 表示"北京时间 Y/M/D H:M:S 当作 UTC"
  const beijingAsUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // 加上本地时区偏移，使 getHours() 等本地方法返回北京时间的值
  const localOffsetMs = new Date().getTimezoneOffset() * 60000;
  return new Date(beijingAsUtcMs + localOffsetMs);
}

/**
 * 获取北京时间的小时×60+分钟（用于时间窗口判断）
 * 返回值如 22:00 → 1320, 06:00 → 360
 *
 * 这是时间窗口判断最安全的用法，无需构造伪 Date，直接返回数值。
 * ⚠️ 时区无关，始终返回北京时间，无论服务器在哪个时区。
 */
export function getBeijingHourMinutes(date: Date | number = Date.now()): number {
  const parts = getBeijingParts(date);
  return parts.hour * 60 + parts.minute;
}

/**
 * 获取北京时间的今日起始时间（0点），返回真实 UTC epoch Date
 * 可用于 Prisma DB 查询：where: { createdAt: { gte: getBeijingTodayStart() } }
 *
 * 例：北京时间 2026-01-01 00:00 = UTC 2025-12-31 16:00
 * 返回的 Date.getTime() = 真实的 UTC epoch 值
 */
export function getBeijingTodayStart(): Date {
  const parts = getBeijingParts();
  // 北京时间今日 00:00 对应的 UTC epoch
  // Date.UTC(parts.year, parts.month-1, parts.day, 0,0,0) 是"北京日期当作UTC"的epoch
  // 减去 BEIJING_OFFSET_MS 得到真实的 UTC epoch
  const beijingMidnightUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0) - BEIJING_OFFSET_MS;
  return new Date(beijingMidnightUtcMs);
}

/**
 * 获取北京时间的本周起始时间（周一 0点），返回真实 UTC epoch Date
 * 可用于 Prisma DB 查询
 */
export function getBeijingWeekStart(): Date {
  const parts = getBeijingParts();
  // 获取北京时间的星期几（使用 Intl，避免 getDay() 的本地时区依赖）
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIMEZONE,
    weekday: 'short',
  }).format(new Date());
  const dayOfWeekMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayOfWeek = dayOfWeekMap[weekday] ?? 0;
  // 周一为一周起始
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const beijingWeekStartUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day - daysToMonday, 0, 0, 0, 0) - BEIJING_OFFSET_MS;
  return new Date(beijingWeekStartUtcMs);
}

/**
 * 获取北京时间的本月起始时间（1日 0点），返回真实 UTC epoch Date
 * 可用于 Prisma DB 查询
 */
export function getBeijingMonthStart(): Date {
  const parts = getBeijingParts();
  const beijingMonthStartUtcMs = Date.UTC(parts.year, parts.month - 1, 1, 0, 0, 0, 0) - BEIJING_OFFSET_MS;
  return new Date(beijingMonthStartUtcMs);
}

/**
 * 获取北京时间的本年起始时间（1月1日 0点），返回真实 UTC epoch Date
 * 可用于 Prisma DB 查询
 */
export function getBeijingYearStart(): Date {
  const parts = getBeijingParts();
  const beijingYearStartUtcMs = Date.UTC(parts.year, 0, 1, 0, 0, 0, 0) - BEIJING_OFFSET_MS;
  return new Date(beijingYearStartUtcMs);
}

/**
 * 根据时间段获取起始时间
 * @param period - 时间段：day, week, month, year
 * 返回真实 UTC epoch Date，可用于 Prisma DB 查询
 */
export function getBeijingPeriodStart(period: 'day' | 'week' | 'month' | 'year'): Date {
  switch (period) {
    case 'day':
      return getBeijingTodayStart();
    case 'week':
      return getBeijingWeekStart();
    case 'month':
      return getBeijingMonthStart();
    case 'year':
      return getBeijingYearStart();
    default:
      return getBeijingTodayStart();
  }
}

/**
 * 将 UTC 时间转换为北京时间字符串显示
 * @param date - UTC 时间
 * @param format - 格式：'full' | 'date' | 'time' | 'short'
 *
 * 使用 Intl.DateTimeFormat 实现，时区无关
 */
export function formatBeijingTime(date: Date | string | null, format: 'full' | 'date' | 'time' | 'short' = 'full'): string {
  if (!date) return '-';

  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';

  const parts = getBeijingParts(d);

  const year = String(parts.year);
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  const hour = String(parts.hour).padStart(2, '0');
  const minute = String(parts.minute).padStart(2, '0');
  const second = String(parts.second).padStart(2, '0');

  switch (format) {
    case 'date':
      return `${year}-${month}-${day}`;
    case 'time':
      return `${hour}:${minute}:${second}`;
    case 'short':
      return `${month}-${day} ${hour}:${minute}`;
    case 'full':
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    default:
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }
}

/**
 * 获取北京时间日期字符串（YYYY-MM-DD）
 */
export function getBeijingDateString(date: Date | string): string {
  return formatBeijingTime(date, 'date');
}

/**
 * 获取北京时间日期（用于数据库查询）
 * 返回真实 UTC epoch Date，代表的是北京时间的那个日期的 00:00
 *
 * 例：getBeijingDateForQuery(2026, 1, 1) 返回 UTC 2025-12-31 16:00 的 epoch
 * 可用于 Prisma 查询：where: { createdAt: { gte: getBeijingDateForQuery(2026, 1, 1) } }
 */
export function getBeijingDateForQuery(year: number, month: number, day: number): Date {
  const utcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - BEIJING_OFFSET_MS;
  return new Date(utcMs);
}