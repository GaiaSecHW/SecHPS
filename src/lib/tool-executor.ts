// src/lib/tool-executor.ts

import { prisma } from '@/lib/prisma';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  duration: number;
}

export interface ToolExecutionContext {
  projectId: string;
  workingDirectory?: string;
  timeout?: number;
}

/**
 * 内置工具执行器映射
 */
const BUILTIN_TOOLS: Record<string, (params: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>> = {
  // 读取文件
  'read_file': async (params, context) => {
    const startTime = Date.now();
    try {
      const filePath = params.path as string;
      if (!filePath) {
        return { success: false, output: null, error: '缺少文件路径参数', duration: Date.now() - startTime };
      }

      const content = await fs.readFile(filePath, 'utf-8');
      return {
        success: true,
        output: { content, path: filePath },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : '读取文件失败',
        duration: Date.now() - startTime,
      };
    }
  },

  // 搜索文件内容
  'search_pattern': async (params, context) => {
    const startTime = Date.now();
    try {
      const pattern = params.pattern as string;
      const directory = params.directory as string;

      if (!pattern) {
        return { success: false, output: null, error: '缺少搜索模式参数', duration: Date.now() - startTime };
      }

      // 使用 grep 搜索（Windows 使用 findstr）
      const isWindows = process.platform === 'win32';
      const cmd = isWindows
        ? `findstr /s /i /n "${pattern}" ${directory || '.'}`
        : `grep -r -n "${pattern}" ${directory || '.'}`;

      const { stdout } = await execAsync(cmd, {
        timeout: context.timeout || 30000,
      });

      const matches = stdout.split('\n').filter(Boolean).slice(0, 100);

      return {
        success: true,
        output: { matches, count: matches.length },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: true,
        output: { matches: [], count: 0, message: '未找到匹配项' },
        duration: Date.now() - startTime,
      };
    }
  },

  // 列出目录
  'list_directory': async (params, context) => {
    const startTime = Date.now();
    try {
      const directory = params.directory as string || '.';

      const entries = await fs.readdir(directory, { withFileTypes: true });
      const items = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));

      return {
        success: true,
        output: { items, count: items.length },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : '列出目录失败',
        duration: Date.now() - startTime,
      };
    }
  },

  // 执行命令
  'execute_command': async (params, context) => {
    const startTime = Date.now();
    try {
      const command = params.command as string;

      if (!command) {
        return { success: false, output: null, error: '缺少命令参数', duration: Date.now() - startTime };
      }

      // 安全检查：禁止危险命令
      const dangerousCommands = ['rm -rf', 'del /', 'format', 'fdisk', 'shutdown'];
      if (dangerousCommands.some(cmd => command.toLowerCase().includes(cmd))) {
        return { success: false, output: null, error: '禁止执行危险命令', duration: Date.now() - startTime };
      }

      const { stdout, stderr } = await execAsync(command, {
        timeout: context.timeout || 30000,
        cwd: context.workingDirectory,
      });

      return {
        success: true,
        output: { stdout, stderr },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: { stdout: '', stderr: error instanceof Error ? error.message : '执行失败' },
        error: error instanceof Error ? error.message : '执行命令失败',
        duration: Date.now() - startTime,
      };
    }
  },
};

/**
 * 工具执行器
 */
export class ToolExecutor {
  private context: ToolExecutionContext;

  constructor(context: ToolExecutionContext) {
    this.context = context;
  }

  /**
   * 执行工具
   */
  async execute(toolIdOrName: string, params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now();

    // 尝试按名称查找工具
    let tool = await prisma.tool.findFirst({
      where: {
        name: toolIdOrName,
        isActive: true,
      },
    });

    // 如果找不到，按 ID 查找
    if (!tool) {
      tool = await prisma.tool.findUnique({
        where: { id: toolIdOrName },
      });
    }

    if (!tool) {
      return { success: false, output: null, error: `工具不存在: ${toolIdOrName}`, duration: Date.now() - startTime };
    }

    if (!tool.isActive) {
      return { success: false, output: null, error: '工具未启用', duration: Date.now() - startTime };
    }

    // 检查是否为内置工具
    if (tool.isBuiltin && BUILTIN_TOOLS[tool.name]) {
      return BUILTIN_TOOLS[tool.name](params, this.context);
    }

    // 外部工具执行（根据 executor 类型）
    switch (tool.executor) {
      case 'builtin':
        if (BUILTIN_TOOLS[tool.name]) {
          return BUILTIN_TOOLS[tool.name](params, this.context);
        }
        return { success: false, output: null, error: '未知的内置工具', duration: Date.now() - startTime };

      case 'script':
        return this.executeScript(tool.executorConfig as string, params);

      case 'http':
        return this.executeHttp(tool.executorConfig as string, params);

      default:
        return { success: false, output: null, error: `不支持的执行器类型: ${tool.executor}`, duration: Date.now() - startTime };
    }
  }

  /**
   * 执行脚本
   */
  private async executeScript(config: string, params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const configObj = JSON.parse(config);
      const scriptPath = configObj.path as string;

      if (!scriptPath) {
        return { success: false, output: null, error: '缺少脚本路径', duration: Date.now() - startTime };
      }

      // 构建命令
      const args = Object.entries(params)
        .map(([k, v]) => `--${k}="${v}"`)
        .join(' ');
      const command = `${scriptPath} ${args}`;

      const { stdout, stderr } = await execAsync(command, {
        timeout: this.context.timeout || 30000,
        cwd: this.context.workingDirectory,
      });

      return {
        success: true,
        output: { stdout, stderr },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : '脚本执行失败',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 执行 HTTP 请求
   */
  private async executeHttp(config: string, params: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const configObj = JSON.parse(config);
      const url = configObj.url as string;
      const method = (configObj.method as string) || 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: method !== 'GET' ? JSON.stringify(params) : undefined,
      });

      const output = await response.json();

      return {
        success: response.ok,
        output,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : 'HTTP 请求失败',
        duration: Date.now() - startTime,
      };
    }
  }
}