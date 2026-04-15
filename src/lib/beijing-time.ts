/**
 * beijing-time.ts
 * 北京时间（UTC+8）相关辅助函数
 * 
 * 所有时间计算都以北京时间为基准
 */

// 北京时区偏移：UTC+8
const BEIJING_OFFSET_HOURS = 8;

/**
 * 获取当前北京时间
 */
export function getBeijingNow(): Date {
  const now = new Date();
  // 获取 UTC 时间
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  // 加上北京时区偏移
  return new Date(utcTime + BEIJING_OFFSET_HOURS * 3600000);
}

/**
 * 获取北京时间的今日起始时间（0点）
 */
export function getBeijingTodayStart(): Date {
  const beijingNow = getBeijingNow();
  // 北京时间的今日 0:00:00
  const beijingTodayStart = new Date(
    beijingNow.getFullYear(),
    beijingNow.getMonth(),
    beijingNow.getDate(),
    0, 0, 0, 0
  );
  // 转换回 UTC 时间（减去北京时区偏移）
  return new Date(beijingTodayStart.getTime() - BEIJING_OFFSET_HOURS * 3600000);
}

/**
 * 获取北京时间的本周起始时间（周一 0点）
 */
export function getBeijingWeekStart(): Date {
  const beijingNow = getBeijingNow();
  const dayOfWeek = beijingNow.getDay(); // 0=周日, 1=周一, ...
  // 周一为一周起始（如果今天是周日，则减6天；否则减去(dayOfWeek-1)天）
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const beijingWeekStart = new Date(
    beijingNow.getFullYear(),
    beijingNow.getMonth(),
    beijingNow.getDate() - daysToMonday,
    0, 0, 0, 0
  );
  return new Date(beijingWeekStart.getTime() - BEIJING_OFFSET_HOURS * 3600000);
}

/**
 * 获取北京时间的本月起始时间（1日 0点）
 */
export function getBeijingMonthStart(): Date {
  const beijingNow = getBeijingNow();
  const beijingMonthStart = new Date(
    beijingNow.getFullYear(),
    beijingNow.getMonth(),
    1,
    0, 0, 0, 0
  );
  return new Date(beijingMonthStart.getTime() - BEIJING_OFFSET_HOURS * 3600000);
}

/**
 * 获取北京时间的本年起始时间（1月1日 0点）
 */
export function getBeijingYearStart(): Date {
  const beijingNow = getBeijingNow();
  const beijingYearStart = new Date(
    beijingNow.getFullYear(),
    0, 1,
    0, 0, 0, 0
  );
  return new Date(beijingYearStart.getTime() - BEIJING_OFFSET_HOURS * 3600000);
}

/**
 * 根据时间段获取起始时间
 * @param period - 时间段：day, week, month, year
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
 */
export function formatBeijingTime(date: Date | string | null, format: 'full' | 'date' | 'time' | 'short' = 'full'): string {
  if (!date) return '-';
  
  const utcDate = new Date(date);
  // 获取北京时间
  const beijingTime = new Date(utcDate.getTime() + BEIJING_OFFSET_HOURS * 3600000);
  
  const year = beijingTime.getFullYear();
  const month = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getDate()).padStart(2, '0');
  const hour = String(beijingTime.getHours()).padStart(2, '0');
  const minute = String(beijingTime.getMinutes()).padStart(2, '0');
  const second = String(beijingTime.getSeconds()).padStart(2, '0');
  
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
 * 返回 UTC 时间，但代表的是北京时间的那个日期
 */
export function getBeijingDateForQuery(year: number, month: number, day: number): Date {
  // 北京时间的日期
  const beijingDate = new Date(year, month - 1, day, 0, 0, 0, 0);
  // 转换为 UTC（减去 8 小时）
  return new Date(beijingDate.getTime() - BEIJING_OFFSET_HOURS * 3600000);
}