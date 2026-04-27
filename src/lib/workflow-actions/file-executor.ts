// src/lib/workflow-actions/file-executor.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, FileOperationConfig, replaceVariables } from './index';

// 允许的基础路径（安全限制）
const ALLOWED_BASE_PATHS = [
  process.cwd(),
  path.join(process.cwd(), 'uploads'),
  path.join(process.cwd(), 'temp'),
  path.join(process.cwd(), 'data'),
];

/**
 * 执行文件操作
 */
export async function executeFileOperation(
  config: FileOperationConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    // 替换路径中的变量
    const filePath = replaceVariables(config.path, context.variables);
    logs.push(`[File] Operation: ${config.operation}`);
    logs.push(`[File] Path: ${filePath}`);

    // 安全检查：确保路径在允许范围内
    const resolvedPath = path.resolve(filePath);
    const isAllowed = ALLOWED_BASE_PATHS.some(basePath =>
      resolvedPath.startsWith(path.resolve(basePath))
    );

    // 对于写操作，需要更严格的权限检查
    const writeOperations = ['write', 'append', 'delete', 'mkdir', 'rmdir'];
    const needsWritePermission = writeOperations.includes(config.operation);

    if (needsWritePermission && !isAllowed) {
      return {
        success: false,
        output: null,
        error: `文件路径不在允许范围内: ${resolvedPath}`,
        duration: Date.now() - startTime,
        logs,
      };
    }

    let output: unknown;

    switch (config.operation) {
      case 'read':
        output = await executeRead(resolvedPath, config.encoding || 'utf-8', logs);
        break;

      case 'write':
        output = await executeWrite(
          resolvedPath,
          config.content || '',
          config.encoding || 'utf-8',
          logs
        );
        break;

      case 'append':
        output = await executeAppend(
          resolvedPath,
          config.content || '',
          config.encoding || 'utf-8',
          logs
        );
        break;

      case 'delete':
        output = await executeDelete(resolvedPath, logs);
        break;

      case 'list':
        output = await executeList(resolvedPath, logs);
        break;

      case 'exists':
        output = await executeExists(resolvedPath, logs);
        break;

      case 'mkdir':
        output = await executeMkdir(resolvedPath, config.recursive || false, logs);
        break;

      case 'rmdir':
        output = await executeRmdir(resolvedPath, config.recursive || false, logs);
        break;

      default:
        return {
          success: false,
          output: null,
          error: `不支持的文件操作: ${config.operation}`,
          duration: Date.now() - startTime,
          logs,
        };
    }

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[File] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.error('[workflow-actions/file-executor] 文件操作失败:', error instanceof Error ? error.message : String(error));
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : '文件操作失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

async function executeRead(
  filePath: string,
  encoding: string,
  logs: string[]
): Promise<unknown> {
  if (encoding === 'json') {
    const content = await fs.readFile(filePath, 'utf-8');
    logs.push(`[File] Read JSON: ${filePath}`);
    return JSON.parse(content);
  } else if (encoding === 'binary') {
    const content = await fs.readFile(filePath);
    logs.push(`[File] Read binary: ${filePath} (${content.length} bytes)`);
    return content.toString('base64');
  } else {
    const content = await fs.readFile(filePath, 'utf-8');
    logs.push(`[File] Read text: ${filePath} (${content.length} chars)`);
    return content;
  }
}

async function executeWrite(
  filePath: string,
  content: string | Buffer,
  encoding: string,
  logs: string[]
): Promise<unknown> {
  // 确保目录存在
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  if (encoding === 'json' && typeof content === 'string') {
    await fs.writeFile(filePath, content, 'utf-8');
    logs.push(`[File] Write JSON: ${filePath}`);
  } else if (encoding === 'binary' && typeof content === 'string') {
    const buffer = Buffer.from(content, 'base64');
    await fs.writeFile(filePath, buffer);
    logs.push(`[File] Write binary: ${filePath} (${buffer.length} bytes)`);
  } else {
    await fs.writeFile(filePath, content, 'utf-8');
    logs.push(`[File] Write text: ${filePath}`);
  }

  return { written: true, path: filePath };
}

async function executeAppend(
  filePath: string,
  content: string | Buffer,
  encoding: string,
  logs: string[]
): Promise<unknown> {
  await fs.appendFile(filePath, content, encoding as BufferEncoding);
  logs.push(`[File] Append: ${filePath}`);
  return { appended: true, path: filePath };
}

async function executeDelete(filePath: string, logs: string[]): Promise<unknown> {
  await fs.unlink(filePath);
  logs.push(`[File] Delete: ${filePath}`);
  return { deleted: true, path: filePath };
}

async function executeList(dirPath: string, logs: string[]): Promise<unknown> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const items = entries.map(entry => ({
    name: entry.name,
    type: entry.isDirectory() ? 'directory' : 'file',
    path: path.join(dirPath, entry.name),
  }));
  logs.push(`[File] List: ${dirPath} (${items.length} items)`);
  return { items, count: items.length };
}

async function executeExists(filePath: string, logs: string[]): Promise<unknown> {
  try {
    await fs.access(filePath);
    logs.push(`[File] Exists: ${filePath}`);
    return { exists: true, path: filePath };
  } catch {
    logs.push(`[File] Not exists: ${filePath}`);
    return { exists: false, path: filePath };
  }
}

async function executeMkdir(
  dirPath: string,
  recursive: boolean,
  logs: string[]
): Promise<unknown> {
  await fs.mkdir(dirPath, { recursive });
  logs.push(`[File] Mkdir: ${dirPath} (recursive: ${recursive})`);
  return { created: true, path: dirPath };
}

async function executeRmdir(
  dirPath: string,
  recursive: boolean,
  logs: string[]
): Promise<unknown> {
  if (recursive) {
    await fs.rm(dirPath, { recursive: true });
  } else {
    await fs.rmdir(dirPath);
  }
  logs.push(`[File] Rmdir: ${dirPath} (recursive: ${recursive})`);
  return { removed: true, path: dirPath };
}

/**
 * 验证文件操作配置
 */
export function validateFileOperationConfig(config: FileOperationConfig): boolean {
  if (!config.path) return false;
  if (!['read', 'write', 'append', 'delete', 'list', 'exists', 'mkdir', 'rmdir'].includes(config.operation)) return false;
  if (['write', 'append'].includes(config.operation) && config.content === undefined) return false;
  return true;
}
