// src/lib/path-utils.ts
/**
 * 路径工具函数
 * 处理路径格式化和验证
 */

import * as path from 'path';
import * as os from 'os';

/**
 * 检测是否在 WSL2 环境中运行
 */
export function isWSL2(): boolean {
  try {
    return os.platform() === 'linux' && process.env.WSL_DISTRO_NAME !== undefined;
  } catch {
    return false;
  }
}

/**
 * 清理路径：去除空格，统一为 Linux 格式（正斜杠）
 * 这是最重要的函数，用于在保存路径到数据库前进行格式化
 */
export function sanitizePath(inputPath: string): string {
  if (!inputPath) return inputPath;
  
  // 去除前后空格
  let cleaned = inputPath.trim();
  
  // 如果路径以 \ 开头（如 \mnt\e\temp），转为 /mnt/e/temp
  // 这是常见的输入错误
  if (cleaned.startsWith('\\')) {
    cleaned = cleaned.replace(/\\/g, '/');
  }
  
  // 统一 Windows 路径为 Linux 格式
  // D:\path -> /mnt/d/path
  // D:/path -> /mnt/d/path
  const windowsDriveRegex = /^([A-Za-z]):[\\\/](.+)$/;
  const match = cleaned.match(windowsDriveRegex);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    cleaned = `/mnt/${drive}/${rest}`;
  }
  
  // 将所有反斜杠转为正斜杠（统一格式）
  cleaned = cleaned.replace(/\\/g, '/');
  
  return cleaned;
}

/**
 * 将 Windows 路径转换为 WSL2 路径
 * 例如: D:\claude-web-platform\uploads\projects\123 -> /mnt/d/claude-web-platform/uploads/projects/123
 */
export function windowsToWSLPath(windowsPath: string): string {
  if (!windowsPath) return windowsPath;
  
  // 先清理路径
  const cleaned = sanitizePath(windowsPath);
  
  // 如果已经是 Linux 格式，直接返回
  if (cleaned.startsWith('/')) {
    return cleaned;
  }
  
  return cleaned;
}

/**
 * 将 WSL2 路径转换为 Windows 路径
 * 例如: /mnt/d/claude-web-platform/uploads/projects/123 -> D:\claude-web-platform\uploads\projects\123
 */
export function wslToWindowsPath(wslPath: string): string {
  if (!wslPath) return wslPath;
  
  // 先清理
  const cleaned = sanitizePath(wslPath);
  
  // 检查是否是 WSL 路径格式
  const wslPathRegex = /^\/mnt\/([a-z])\/(.+)$/i;
  const match = cleaned.match(wslPathRegex);
  
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = match[2].replace(/\//g, '\\');
    return `${drive}:\\${rest}`;
  }
  
  return cleaned;
}

/**
 * 根据当前环境自动转换路径
 * - 如果在 WSL2/Linux 中且路径是 Windows 格式，转换为 WSL 格式
 * - 如果在 Windows 中且路径是 WSL 格式，转换为 Windows 格式
 * - 否则返回原路径
 */
export function normalizePath(inputPath: string): string {
  if (!inputPath) return inputPath;
  
  // 先清理
  let cleaned = sanitizePath(inputPath);
  
  const platform = os.platform();
  
  if (platform === 'linux') {
    // 在 Linux/WSL2 中，确保路径是 Linux 格式
    return cleaned;
  } else if (platform === 'win32') {
    // 在 Windows 中，将 /mnt/x/ 路径转换为 Windows 格式
    return wslToWindowsPath(cleaned);
  }
  
  return cleaned;
}

/**
 * 获取适合当前环境的项目路径
 */
export function getProjectPath(baseDir: string, projectId: string): string {
  const normalizedBase = normalizePath(baseDir);
  return path.join(normalizedBase, 'projects', projectId);
}

/**
 * 验证路径是否可访问
 */
export async function isPathAccessible(filePath: string): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 智能路径解析
 * 尝试多种路径格式，找到可访问的路径
 */
export async function resolveAccessiblePath(
  possiblePaths: string[]
): Promise<string | null> {
  for (const p of possiblePaths) {
    const normalized = normalizePath(p);
    if (await isPathAccessible(normalized)) {
      return normalized;
    }
  }
  return null;
}
