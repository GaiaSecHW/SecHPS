import { NextResponse } from 'next/server';
import { getSystemStartTime, parseDatabaseName } from '@/lib/system-info';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import fs from 'fs';
import path from 'path';

// 读取 package.json 获取版本号
function getVersion(): string {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// GET /api/system/info - 获取系统信息
export async function GET(request: Request) {
  try {
    // 认证检查（允许所有登录用户查看系统信息）
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const startTime = getSystemStartTime();
    const databaseUrl = process.env.DATABASE_URL || '';
    const dbName = parseDatabaseName(databaseUrl);
    const version = getVersion();

    // 计算运行时长
    const uptime = startTime ? Math.floor((Date.now() - startTime.getTime()) / 1000) : 0;
    const uptimeFormatted = formatUptime(uptime);

    logger.debug(LOG_MODULES.CONFIG, '获取系统信息', {
      details: { version, dbName, startTime: startTime?.toISOString(), uptime }
    });

    return NextResponse.json({
      version,
      startTime: startTime ? startTime.toISOString() : null,
      startTimeFormatted: startTime ? startTime.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }) : null,
      database: dbName,
      uptime,
      uptimeFormatted,
    });
  } catch (error) {
    logger.error(LOG_MODULES.CONFIG, '获取系统信息失败', {
      details: { error: String(error) }
    });
    return NextResponse.json(
      { error: '获取系统信息失败' },
      { status: 500 }
    );
  }
}

// 格式化运行时长
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (days > 0) {
    return `${days}天 ${hours}小时 ${minutes}分钟`;
  } else if (hours > 0) {
    return `${hours}小时 ${minutes}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟 ${secs}秒`;
  } else {
    return `${secs}秒`;
  }
}