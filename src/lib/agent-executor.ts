import { prisma } from '@/lib/prisma';
import { ClaudeAgentService, createClaudeAgentService } from '@/services/ai';
import { ToolExecutor } from '@/lib/tool-executor';
import { parseAIResponse, ParsedVulnerability, ParsedToolCall } from '@/lib/result-parser';

export interface AgentExecutionContext {
  skillId: string;
  projectId: string;
  scanTaskId?: string;
  modelConfig: {
    providerType: string;
    apiKey: string;
    apiBaseUrl: string;
    model: string;
    maxTokens?: number;      // 最大输出 token 数
    temperature?: number;    // 温度参数
  };
  maxToolCalls?: number;
  maxIterations?: number;
  testMode?: boolean; // 测试模式，不保存数据库记录
  cwd?: string; // 工作目录
}

export interface AgentExecutionCallbacks {
  onChunk: (text: string) => void;
  onToolCall: (tool: string, parameters: Record<string, unknown>) => void;
  onVulnerability: (vulnerability: ParsedVulnerability) => void;
  onComplete: (result: AgentExecutionResult) => void;
  onError: (error: Error) => void;
}

export interface AgentExecutionResult {
  executionId: string;
  skillId: string;
  projectId: string;
  status: 'completed' | 'failed' | 'cancelled';
  summary: string;
  vulnerabilities: ParsedVulnerability[];
  toolCalls: Array<{ tool: string; parameters: Record<string, unknown>; result: unknown }>;
  duration: number;
  error?: string;
}

/**
 * Agent 执行引擎
 * 负责执行 Skill 并处理 AI 调用、工具执行、结果解析
 * 使用 Claude Agent SDK
 */
export class AgentExecutor {
  private context: AgentExecutionContext;
  private callbacks: AgentExecutionCallbacks;
  private agentService: ClaudeAgentService;
  private toolExecutor: ToolExecutor;
  private cancelled: boolean = false;
  private toolCallCount: number = 0;
  private iterationCount: number = 0;
  private executionId: string = '';
  private skillName: string = '';  // 当前执行的 Skill 名称

  constructor(context: AgentExecutionContext, callbacks: AgentExecutionCallbacks) {
    this.context = context;
    this.callbacks = callbacks;

    // 创建 Claude Agent Service（使用 ModelConfig 中的 maxTokens 和 temperature）
    this.agentService = createClaudeAgentService({
      apiKey: context.modelConfig.apiKey,
      model: context.modelConfig.model,
      maxTokens: context.modelConfig.maxTokens ?? 32000,
      temperature: context.modelConfig.temperature ?? 0.3,
      cwd: context.cwd,
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash', 'Skill'],
    });

    // 创建工具执行器
    this.toolExecutor = new ToolExecutor({
      projectId: context.projectId,
      timeout: 600000, // 10 分钟
    });
  }

  /**
   * 设置工作目录
   */
  setWorkingDirectory(dir: string): void {
    this.agentService.setWorkingDirectory(dir);
  }

  /**
   * 执行 Skill
   */
  async execute(): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    try {
      // 创建执行记录
      this.executionId = await this.createExecutionRecord();

      // 获取 Skill 信息
      const skill = await prisma.skill.findUnique({
        where: { id: this.context.skillId },
      });

      if (!skill) {
        throw new Error('Skill 不存在');
      }

      // 设置 Skill 名称，用于漏洞记录
      this.skillName = skill.name;

      // 获取项目信息
      const project = await prisma.project.findUnique({
        where: { id: this.context.projectId },
        include: { ProjectFile: true },
      });

      if (!project) {
        throw new Error('项目不存在');
      }

      // 设置工作目录
      if (project.projectPath) {
        this.agentService.setWorkingDirectory(project.projectPath);
      }

      // 构建初始提示
      const prompt = this.buildPrompt(skill, project);
      let lastResponse = '';

      // 执行循环
      while (!this.cancelled && this.iterationCount < (this.context.maxIterations || 10)) {
        this.iterationCount++;

        // 调用 AI
        lastResponse = await this.callAgent(prompt);

        // 解析响应
        const parsed = parseAIResponse(lastResponse);

        // 保存漏洞
        if (parsed.vulnerabilities.length > 0) {
          await this.saveVulnerabilities(parsed.vulnerabilities);
          parsed.vulnerabilities.forEach(v => this.callbacks.onVulnerability(v));
        }

        // 检查是否需要工具调用
        if (parsed.needsToolCall && this.toolCallCount < (this.context.maxToolCalls || 20)) {
          const toolResults = await this.executeToolCalls(parsed.toolCalls);

          // 将工具结果添加到下一次提示
          const newPrompt = `${prompt}\n\n---\n\n上一次执行结果:\n${toolResults}\n\n请继续分析。`;
          lastResponse = await this.callAgent(newPrompt);
          continue;
        }

        // 没有更多工具调用，完成执行
        break;
      }

      const duration = Date.now() - startTime;

      // 更新执行记录
      await this.updateExecutionRecord('completed', lastResponse.slice(0, 500), duration);

      const result: AgentExecutionResult = {
        executionId: this.executionId,
        skillId: this.context.skillId,
        projectId: this.context.projectId,
        status: this.cancelled ? 'cancelled' : 'completed',
        summary: parseAIResponse(lastResponse).summary,
        vulnerabilities: [],
        toolCalls: [],
        duration,
      };

      this.callbacks.onComplete(result);
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      // 更新执行记录
      if (this.executionId) {
        await this.updateExecutionRecord('failed', errorMessage, duration);
      }

      const result: AgentExecutionResult = {
        executionId: this.executionId,
        skillId: this.context.skillId,
        projectId: this.context.projectId,
        status: 'failed',
        summary: errorMessage,
        vulnerabilities: [],
        toolCalls: [],
        duration,
        error: errorMessage,
      };

      this.callbacks.onError(error instanceof Error ? error : new Error(errorMessage));
      return result;
    }
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.cancelled = true;
    this.agentService.abort();
  }

  /**
   * 创建执行记录
   */
  private async createExecutionRecord(): Promise<string> {
    // 测试模式下不保存数据库记录
    if (this.context.testMode) {
      return `test-${Date.now()}`;
    }
    const execution = await prisma.skillExecution.create({
      data: {
        id: `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        skillId: this.context.skillId,
        projectId: this.context.projectId,
        scanTaskId: this.context.scanTaskId,
        input: JSON.stringify({}),
        status: 'running',
        startedAt: new Date(),
      },
    });
    return execution.id;
  }

  /**
   * 更新执行记录
   */
  private async updateExecutionRecord(
    status: string,
    output: string,
    duration: number
  ): Promise<void> {
    // 测试模式下不保存数据库记录
    if (this.context.testMode) {
      return;
    }
    await prisma.skillExecution.update({
      where: { id: this.executionId },
      data: {
        status,
        output: JSON.stringify({ summary: output }),
        duration,
        completedAt: new Date(),
      },
    });
  }

  /**
   * 构建提示
   */
  private buildPrompt(
    skill: { content: string; description?: string | null },
    project: { name: string; description: string | null }
  ): string {
    // skill.content 是完整的 Markdown 内容，作为系统提示
    const systemMessage = skill.content || skill.description || '';
    const userMessage = `请分析项目 ${project.name}。${project.description ? `项目描述: ${project.description}` : ''}。`;

    return `System: ${systemMessage}\n\n---\n\nHuman: ${userMessage}`;
  }

  /**
   * 调用 Agent
   */
  private async callAgent(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let fullResponse = '';

      this.agentService.sendPrompt(prompt, {
        onChunk: (text) => {
          fullResponse += text;
          this.callbacks.onChunk(text);
        },
        onComplete: () => {
          resolve(fullResponse);
        },
        onError: (error) => {
          reject(error);
        },
      }).catch(reject);
    });
  }

  /**
   * 执行工具调用
   */
  private async executeToolCalls(
    toolCalls: ParsedToolCall[]
  ): Promise<string> {
    const results: string[] = [];

    for (const toolCall of toolCalls) {
      if (this.cancelled) break;

      this.toolCallCount++;
      this.callbacks.onToolCall(toolCall.tool, toolCall.parameters);

      try {
        const result = await this.toolExecutor.execute(toolCall.tool, toolCall.parameters);
        results.push(`[${toolCall.tool}] 执行成功:\n${JSON.stringify(result, null, 2)}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '执行失败';
        results.push(`[${toolCall.tool}] 执行失败: ${errorMsg}`);
      }
    }

    return results.join('\n\n');
  }

  /**
   * 保存漏洞到数据库
   * 同时更新 Skill.vulnerabilityCount 计数
   */
  private async saveVulnerabilities(vulnerabilities: ParsedVulnerability[]): Promise<void> {
    for (const vuln of vulnerabilities) {
      await prisma.vulnerability.create({
        data: {
          id: `vuln-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          projectId: this.context.projectId,
          skillExecutionId: this.executionId,  // 关联到执行记录
          skill: this.skillName,               // 记录来源 Skill 名称
          title: vuln.title,
          description: vuln.description,
          type: vuln.type || 'unknown',
          severity: vuln.severity,
          status: 'new',
          filePath: vuln.filePath,
          lineStart: vuln.lineStart,
          lineEnd: vuln.lineEnd,
          codeSnippet: vuln.codeSnippet,
          fixSuggestion: vuln.recommendation,
          cwe: vuln.cwe,
          updatedAt: new Date(),
        },
      });
    }

    // 更新 Skill.vulnerabilityCount 计数
    if (vulnerabilities.length > 0) {
      await prisma.skill.update({
        where: { id: this.context.skillId },
        data: { vulnerabilityCount: { increment: vulnerabilities.length } },
      });
    }
  }
}
