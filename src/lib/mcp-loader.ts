/**
 * MCP 配置加载器
 * 
 * 从数据库加载项目级和用户级的 MCP 服务器配置
 * 用于传递给 Claude Agent SDK
 */

import { prisma } from '@/lib/prisma';
import type { AppMcpServerConfig } from '@/services/ai';

/**
 * 加载项目关联的 MCP 服务器配置
 * 
 * 优先级：
 * 1. 项目级 MCP（projectId 关联）
 * 2. 用户私有 MCP（userId 关联，isPublic=false）
 * 3. 用户可访问的共享 MCP（isPublic=true）
 * 
 * @param projectId 项目 ID
 * @param userId 用户 ID
 * @returns MCP 服务器配置数组（已转换为 SDK 格式）
 */
export async function loadMcpServersForProject(
  projectId: string,
  userId: string
): Promise<AppMcpServerConfig[]> {
  try {
    // 1. 查询项目级 MCP
    const projectMcps = await prisma.mcpServerConfig.findMany({
      where: {
        projectId,
        isEnabled: true,
      },
    });

    // 2. 查询用户私有 MCP
    const userPrivateMcps = await prisma.mcpServerConfig.findMany({
      where: {
        userId,
        projectId: null,  // 全局级，不属于特定项目
        isPublic: false,
        isEnabled: true,
      },
    });

    // 3. 查询用户可访问的共享 MCP
    const sharedMcps = await prisma.mcpServerConfig.findMany({
      where: {
        isPublic: true,
        isEnabled: true,
        projectId: null,  // 全局级共享
      },
    });

    // 合并并去重（按 name 去重，项目级优先）
    const allMcps = [...projectMcps, ...userPrivateMcps, ...sharedMcps];
    const uniqueMcps = deduplicateMcps(allMcps);

    // 转换为 SDK 格式
    const mcpConfigs: AppMcpServerConfig[] = uniqueMcps.map(mcp => ({
      name: mcp.name,
      type: mcp.type as 'local' | 'sse' | 'http',
      command: mcp.command || undefined,
      args: mcp.args ? parseArgs(mcp.args) : undefined,
      url: mcp.url || undefined,
      env: mcp.env ? parseEnv(mcp.env) : undefined,
      isEnabled: mcp.isEnabled,
      autoStart: mcp.autoStart,
      tools: mcp.tools ? parseTools(mcp.tools) : undefined,
    }));

    console.log(`[McpLoader] 加载 MCP 配置: 项目=${projectId}, 用户=${userId}`);
    console.log(`[McpLoader] 项目级 MCP: ${projectMcps.length} 个`);
    console.log(`[McpLoader] 用户私有 MCP: ${userPrivateMcps.length} 个`);
    console.log(`[McpLoader] 共享 MCP: ${sharedMcps.length} 个`);
    console.log(`[McpLoader] 合计（去重后）: ${mcpConfigs.length} 个`);
    
    if (mcpConfigs.length > 0) {
      console.log(`[McpLoader] MCP 名称列表: ${mcpConfigs.map(m => m.name).join(', ')}`);
    }

    return mcpConfigs;
  } catch (error) {
    console.error('[McpLoader] 加载 MCP 配置失败:', error);
    return [];
  }
}

/**
 * 加载用户级 MCP 服务器配置（无项目上下文）
 * 
 * @param userId 用户 ID
 * @returns MCP 服务器配置数组
 */
export async function loadMcpServersForUser(
  userId: string
): Promise<AppMcpServerConfig[]> {
  try {
    // 查询用户私有 MCP + 共享 MCP
    const mcps = await prisma.mcpServerConfig.findMany({
      where: {
        userId,
        projectId: null,
        isEnabled: true,
      },
    });

    // 添加共享 MCP
    const sharedMcps = await prisma.mcpServerConfig.findMany({
      where: {
        isPublic: true,
        isEnabled: true,
        projectId: null,
      },
    });

    const allMcps = [...mcps, ...sharedMcps];
    const uniqueMcps = deduplicateMcps(allMcps);

    const mcpConfigs: AppMcpServerConfig[] = uniqueMcps.map(mcp => ({
      name: mcp.name,
      type: mcp.type as 'local' | 'sse' | 'http',
      command: mcp.command || undefined,
      args: mcp.args ? parseArgs(mcp.args) : undefined,
      url: mcp.url || undefined,
      env: mcp.env ? parseEnv(mcp.env) : undefined,
      isEnabled: mcp.isEnabled,
      autoStart: mcp.autoStart,
      tools: mcp.tools ? parseTools(mcp.tools) : undefined,
    }));

    console.log(`[McpLoader] 加载用户 MCP 配置: 用户=${userId}, 合计=${mcpConfigs.length} 个`);

    // 日志工具数量
    for (const mcp of mcpConfigs) {
      if (mcp.tools && mcp.tools.length > 0) {
        console.log(`[McpLoader] MCP "${mcp.name}" 有 ${mcp.tools.length} 个工具: ${mcp.tools.map(t => t.name).join(', ')}`);
      }
    }

    return mcpConfigs;
  } catch (error) {
    console.error('[McpLoader] 加载用户 MCP 配置失败:', error);
    return [];
  }
}

/**
 * 按 name 去重 MCP 配置
 * 优先级：项目级 > 用户私有 > 共享
 */
function deduplicateMcps(mcps: any[]): any[] {
  const seen = new Map<string, any>();
  
  for (const mcp of mcps) {
    if (!seen.has(mcp.name)) {
      seen.set(mcp.name, mcp);
    }
  }
  
  return Array.from(seen.values());
}

/**
 * 解析 args 字段（JSON 字符串）
 */
function parseArgs(argsJson: string): string[] | undefined {
  try {
    const parsed = JSON.parse(argsJson);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 解析 env 字段（JSON 字符串）
 */
function parseEnv(envJson: string): Record<string, string> | undefined {
  try {
    const parsed = JSON.parse(envJson);
    return typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 解析 tools 字段（JSON 字符串）
 */
function parseTools(toolsJson: string): Array<{ name: string; description?: string; inputSchema?: any }> | undefined {
  try {
    const parsed = JSON.parse(toolsJson);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * MCP 配置转换为 SDK 格式的 Record
 * 用于直接传递给 Claude Agent SDK
 */
export function convertMcpConfigsToSdkFormat(
  mcpConfigs: AppMcpServerConfig[]
): Record<string, { type: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }> {
  const sdkMcpServers: Record<string, any> = {};
  
  for (const server of mcpConfigs) {
    if (server.isEnabled !== false) {
      if (server.type === 'local' && server.command) {
        sdkMcpServers[server.name] = {
          type: 'stdio',
          command: server.command,
          args: server.args,
          env: server.env,
        };
      } else if (server.type === 'sse' && server.url) {
        sdkMcpServers[server.name] = {
          type: 'sse',
          url: server.url,
        };
      } else if (server.type === 'http' && server.url) {
        sdkMcpServers[server.name] = {
          type: 'http',
          url: server.url,
        };
      }
    }
  }
  
  return sdkMcpServers;
}

/**
 * 获取 MCP 工具权限列表
 * 格式：mcp__<server-name>__* 表示允许该服务器的所有工具
 */
export function getMcpAllowedTools(
  mcpConfigs: AppMcpServerConfig[]
): string[] {
  return mcpConfigs
    .filter(mcp => mcp.isEnabled !== false)
    .map(mcp => `mcp__${mcp.name}__*`);
}