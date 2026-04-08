/**
 * 新建项目 API
 * 
 * POST: 添加现有项目到 Claude 会话管理
 * 将项目路径添加到 ~/.claude/project-config.json
 * 
 * Request Body:
 * - path: string - 项目路径 (必需)
 * - displayName?: string - 可选显示名称
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { ClaudeCodeProject } from '@/types/claude-code';

// 禁止使用的系统关键路径
const FORBIDDEN_PATHS = [
  // Unix
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/dev',
  '/proc',
  '/sys',
  '/var',
  '/boot',
  '/root',
  '/lib',
  '/lib64',
  '/opt',
  '/tmp',
  '/run',
  // Windows
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\$Recycle.Bin',
];

/**
 * 验证工作区路径安全性
 */
async function validateWorkspacePath(requestedPath: string): Promise<{
  valid: boolean;
  resolvedPath?: string;
  error?: string;
}> {
  try {
    // 解析为绝对路径
    let absolutePath = path.resolve(requestedPath);

    // 检查是否为禁止的系统目录
    const normalizedPath = path.normalize(absolutePath);
    if (FORBIDDEN_PATHS.includes(normalizedPath) || normalizedPath === '/') {
      return {
        valid: false,
        error: '不能使用系统关键目录作为工作区',
      };
    }

    // 检查路径是否在禁止目录下
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalizedPath === forbidden || normalizedPath.startsWith(forbidden + path.sep)) {
        return {
          valid: false,
          error: `不能在系统目录下创建工作区: ${forbidden}`,
        };
      }
    }

    // 检查路径是否存在
    try {
      await fs.access(absolutePath);
      const stats = await fs.stat(absolutePath);

      if (!stats.isDirectory()) {
        return {
          valid: false,
          error: '路径存在但不是目录',
        };
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          valid: false,
          error: '项目路径不存在',
        };
      }
      throw error;
    }

    return {
      valid: true,
      resolvedPath: absolutePath,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: `路径验证失败: ${error.message}`,
    };
  }
}

/**
 * 加载项目配置
 */
async function loadProjectConfig(): Promise<Record<string, any>> {
  const configPath = path.join(os.homedir(), '.claude', 'project-config.json');
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch {
    return {};
  }
}

/**
 * 保存项目配置
 */
async function saveProjectConfig(config: Record<string, any>): Promise<void> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const configPath = path.join(claudeDir, 'project-config.json');

  // 确保 .claude 目录存在
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * 从 package.json 生成显示名称
 */
async function generateDisplayName(projectPath: string): Promise<string> {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);

    if (packageJson.name) {
      return packageJson.name;
    }
  } catch {
    // package.json 不存在或无法读取
  }

  // 从路径提取最后部分
  const parts = projectPath.split(path.sep).filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { path: projectPath, displayName } = body;

    // 验证必需参数
    if (!projectPath || typeof projectPath !== 'string') {
      return NextResponse.json(
        { error: '项目路径是必需的' },
        { status: 400 }
      );
    }

    // 验证路径安全性
    const validation = await validateWorkspacePath(projectPath);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const absolutePath = validation.resolvedPath!;

    // 生成项目名称（路径编码）
    const projectName = absolutePath.replace(/[\\/:\s~_]/g, '-');

    // 加载现有配置
    const config = await loadProjectConfig();

    // 检查是否已存在
    if (config[projectName]) {
      return NextResponse.json(
        { error: '该项目路径已配置' },
        { status: 409 }
      );
    }

    // 添加到配置
    config[projectName] = {
      manuallyAdded: true,
      originalPath: absolutePath,
    };

    if (displayName) {
      config[projectName].displayName = displayName;
    }

    // 保存配置
    await saveProjectConfig(config);

    // 生成显示名称
    const finalDisplayName = displayName || await generateDisplayName(absolutePath);

    const project: ClaudeCodeProject = {
      name: projectName,
      path: absolutePath,
      displayName: finalDisplayName,
      config: {
        manuallyAdded: true,
        originalPath: absolutePath,
        displayName: finalDisplayName,
      },
    };

    return NextResponse.json({
      success: true,
      project,
    });
  } catch (error) {
    console.error('添加项目错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
