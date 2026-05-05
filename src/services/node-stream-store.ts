/**
 * NodeStreamStore - 节点 SSE 流存储服务
 *
 * 架构：一个 SSE 流对应一个文件，保持原始数据不变
 *
 * 目录结构：
 * data/sessions/{projectId}/{evaluationSessionId}/
 * ├── node-{nodeId}/
 * │   ├── stream.jsonl          - 主节点 SSE 流（原始数据）
 * │   └── agents/
 * │       ├── {agentId}.jsonl   - 子Agent SSE 流
 * │       └── ...
 *
 * 写入方式：SSE 事件到达 → 直接追加到文件
 */

import { promises as fs } from 'fs';
import path from 'path';
import AsyncLock from 'async-lock';

const lock = new AsyncLock();

// 数据根目录 - 使用 resolve 避免触发 Next.js 文件追踪分析
const DATA_ROOT = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : path.resolve(process.cwd(), 'data');

export interface StreamEvent {
  event: string;
  data: any;
  timestamp?: string;
  agentId?: string;  // 仅用于 agent 流文件
}

export interface NodeStreamStoreConfig {
  projectId: string;
  evaluationSessionId: string;
}

/**
 * 创建节点流存储实例
 */
export function createNodeStreamStore(projectId: string, evaluationSessionId: string): NodeStreamStore {
  return new NodeStreamStore({ projectId, evaluationSessionId });
}

export class NodeStreamStore {
  private projectId: string;
  private evaluationSessionId: string;
  private basePath: string;

  constructor(config: NodeStreamStoreConfig) {
    this.projectId = config.projectId;
    this.evaluationSessionId = config.evaluationSessionId;
    this.basePath = path.join(DATA_ROOT, 'sessions', this.projectId, this.evaluationSessionId);
  }

  /**
   * 获取会话目录路径
   */
  getSessionDir(): string {
    return this.basePath;
  }

  /**
   * 获取节点目录路径
   */
  getNodeDir(nodeId: string): string {
    return path.join(this.basePath, `node-${nodeId}`);
  }

  /**
   * 获取节点流文件路径
   */
  getStreamFile(nodeId: string): string {
    return path.join(this.getNodeDir(nodeId), 'stream.jsonl');
  }

  /**
   * 获取 agents 目录路径
   */
  getAgentsDir(nodeId: string): string {
    return path.join(this.getNodeDir(nodeId), 'agents');
  }

  /**
   * 获取 agent 流文件路径
   */
  getAgentFile(nodeId: string, agentId: string): string {
    return path.join(this.getAgentsDir(nodeId), `${agentId}.jsonl`);
  }

  /**
   * 初始化节点目录
   */
  async initNodeDir(nodeId: string): Promise<void> {
    const nodeDir = this.getNodeDir(nodeId);
    const agentsDir = this.getAgentsDir(nodeId);

    await fs.mkdir(nodeDir, { recursive: true });
    await fs.mkdir(agentsDir, { recursive: true });
  }

  /**
   * 追加事件到节点流文件
   */
  async appendToStream(nodeId: string, event: StreamEvent): Promise<void> {
    const filePath = this.getStreamFile(nodeId);
    
    await lock.acquire(`stream-${nodeId}`, async () => {
      const line = JSON.stringify({
        ...event,
        timestamp: event.timestamp || new Date().toISOString(),
      }) + '\n';
      
      await fs.appendFile(filePath, line, 'utf-8');
    });
  }

  /**
   * 追加事件到 agent 流文件
   */
  async appendToAgentStream(nodeId: string, agentId: string, event: StreamEvent): Promise<void> {
    const filePath = this.getAgentFile(nodeId, agentId);
    
    // 确保 agents 目录存在
    await fs.mkdir(this.getAgentsDir(nodeId), { recursive: true });
    
    await lock.acquire(`agent-${nodeId}-${agentId}`, async () => {
      const line = JSON.stringify({
        ...event,
        agentId,
        timestamp: event.timestamp || new Date().toISOString(),
      }) + '\n';
      
      await fs.appendFile(filePath, line, 'utf-8');
    });
  }

  /**
   * 读取节点流文件
   */
  async readStream(nodeId: string): Promise<StreamEvent[]> {
    const filePath = this.getStreamFile(nodeId);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line);
      
      return lines.map(line => {
        try {
          return JSON.parse(line) as StreamEvent;
        } catch {
          return { event: 'parse_error', data: line };
        }
      });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return []; // 文件不存在，返回空数组
      }
      throw error;
    }
  }

  /**
   * 读取 agent 流文件
   */
  async readAgentStream(nodeId: string, agentId: string): Promise<StreamEvent[]> {
    const filePath = this.getAgentFile(nodeId, agentId);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line);
      
      return lines.map(line => {
        try {
          return JSON.parse(line) as StreamEvent;
        } catch {
          return { event: 'parse_error', data: line };
        }
      });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * 列出节点的所有 agent 文件
   */
  async listAgents(nodeId: string): Promise<string[]> {
    const agentsDir = this.getAgentsDir(nodeId);
    
    try {
      const files = await fs.readdir(agentsDir);
      // 返回 agentId（去掉 .jsonl 后缀）
      return files
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.replace('.jsonl', ''));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * 检查节点目录是否存在
   */
  async nodeExists(nodeId: string): Promise<boolean> {
    const nodeDir = this.getNodeDir(nodeId);
    
    try {
      await fs.access(nodeDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从流中解析 TodoWrite
   */
  async getTodos(nodeId: string): Promise<any[]> {
    const events = await this.readStream(nodeId);
    
    // 找最近的 TodoWrite
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.event === 'tool_use' && event.data?.name === 'TodoWrite') {
        return event.data?.args?.todos || [];
      }
    }
    
    return [];
  }

  /**
   * 从流中解析所有 Agent/task 调用
   */
  async getAgentCalls(nodeId: string): Promise<any[]> {
    const events = await this.readStream(nodeId);
    
    const agentCalls: any[] = [];
    
    for (const event of events) {
      if (event.event === 'tool_use') {
        const name = event.data?.name;
        if (name === 'Agent' || name === 'task') {
          agentCalls.push({
            toolUseId: event.data?.toolUseId,
            name,
            args: event.data?.args,
            timestamp: event.timestamp,
          });
        }
      }
      
      // 检查 tool_result 是否有 async_launched
      if (event.event === 'tool_result') {
        const result = event.data;
        if (result?.isAsync || result?.status === 'async_launched') {
          // 找对应的 tool_use
          const toolUseId = result.toolUseId;
          const call = agentCalls.find(c => c.toolUseId === toolUseId);
          if (call) {
            call.agentId = result.agentId;
            call.status = 'running';
            call.description = result.description;
          }
        }
      }
    }
    
    return agentCalls;
  }
}