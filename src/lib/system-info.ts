// 系统信息存储
// 用于记录服务启动时间等服务状态信息

// 全局启动时间（在 instrumentation.ts 中设置）
let systemStartTime: Date | null = null;

export function setSystemStartTime(time: Date) {
  systemStartTime = time;
}

export function getSystemStartTime(): Date | null {
  if (systemStartTime) return systemStartTime;
  // 后备方案：通过 process.uptime() 推算启动时间
  if (typeof process !== 'undefined' && process.uptime) {
    return new Date(Date.now() - Math.floor(process.uptime() * 1000));
  }
  return null;
}

// 解析数据库 URL 获取数据库名称
export function parseDatabaseName(databaseUrl: string): string {
  try {
    // PostgreSQL URL 格式: postgresql://user:password@host:port/database_name
    // SQLite URL 格式: file:./dev.db
    if (databaseUrl.startsWith('file:')) {
      // SQLite - 从文件路径提取名称
      const filePath = databaseUrl.replace('file:', '');
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'dev.db';
      return fileName.replace('.db', '');
    }
    
    // PostgreSQL - 从 URL 解析
    const url = new URL(databaseUrl);
    // pathname 格式为 /database_name
    const dbName = url.pathname.replace('/', '');
    return dbName || 'unknown';
  } catch {
    return 'unknown';
  }
}