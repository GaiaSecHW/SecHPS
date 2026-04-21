// src/app/api/skills/[id]/test/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { createClaudeAgentService, ClaudeAgentService } from '@/services/ai';
import { trackSystemTokenUsage, calculateSystemCost } from '@/lib/system-token-tracker';
import { logger, LOG_MODULES } from '@/lib/logger';

// 全局 AI Service 用于测试（懒加载）
let globalTestService: ClaudeAgentService | null = null;

// 获取或创建全局测试 Service
async function getTestService(): Promise<ClaudeAgentService | null> {
  if (globalTestService) {
    return globalTestService;
  }

  const modelConfig = await getModelConfig();
  if (!modelConfig) {
    return null;
  }

  globalTestService = createClaudeAgentService({
    apiKey: modelConfig.apiKey,
    model: JSON.parse(modelConfig.models)[0] || 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash'],
  });

  return globalTestService;
}

// POST /api/skills/:id/test - 测试 Skill
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 只有管理员可以测试 Skill
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { mode, projectId, code } = body;

    // 获取 Skill 信息
    const skill = await prisma.skill.findUnique({
      where: { id },
    });

    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    if (!skill.isActive) {
      return NextResponse.json({ error: 'Skill 未启用' }, { status: 400 });
    }

    // 获取全局测试 Service
    const service = await getTestService();
    if (!service) {
      return NextResponse.json(
        { error: '请先在配置中设置模型' },
        { status: 400 }
      );
    }
    
    // 获取模型名称
    const modelConfig = await getModelConfig();
    const modelName = modelConfig ? (JSON.parse(modelConfig.models)[0] as string || 'unknown') : 'unknown';

    // 准备测试上下文
    let projectName: string;
    let projectDescription: string;
    let files: Array<{ name: string; type: string; size: number; content?: string }>;

    if (mode === 'project' && projectId) {
      // 从项目获取上下文
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { ProjectFile: true },
      });

      if (!project) {
        return NextResponse.json({ error: '项目不存在' }, { status: 404 });
      }

      projectName = project.name;
      projectDescription = project.description || '';
      files = project.ProjectFile.map(f => ({
        name: f.fileName,
        type: f.fileType,
        size: f.fileSize,
      }));
    } else if (mode === 'code' && code) {
      // 使用代码片段
      projectName = '测试代码';
      projectDescription = '用户提供的代码片段用于测试 Skill';
      files = [{
        name: 'test-code.txt',
        type: 'text/plain',
        size: code.length,
        content: code,
      }];
    } else {
      return NextResponse.json(
        { error: '请提供测试项目或代码片段' },
        { status: 400 }
      );
    }

    // 构建提示 - 使用 content 字段
    const systemMessage = skill.content;
    const userMessage = skill.content;  // content 包含完整的 Markdown 内容

    const prompt = `System: ${systemMessage}\n\n---\n\nHuman: ${userMessage}`;

    // 执行结果
    let fullResponse = '';
    let tokenUsage = { inputTokens: 0, outputTokens: 0 };
    const startTime = Date.now();

    try {
      // 执行 AI 调用
      await new Promise<void>((resolve, reject) => {
        service.sendPrompt(prompt, {
          onChunk: (text) => {
            fullResponse += text;
          },
          onUsage: (usage) => {
            // 捕获 token 使用量
            tokenUsage = {
              inputTokens: usage.inputTokens || 0,
              outputTokens: usage.outputTokens || 0,
            };
          },
          onComplete: () => {
            resolve();
          },
          onError: (error) => {
            reject(error);
          },
        });
      });

      const duration = Date.now() - startTime;
      
      // 记录系统 Token 使用量（传入用户信息）
      if (tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0) {
        const estimatedCost = calculateSystemCost(tokenUsage.inputTokens, tokenUsage.outputTokens);
        await trackSystemTokenUsage(
          'skill-test',
          modelName,
          tokenUsage.inputTokens,
          tokenUsage.outputTokens,
          estimatedCost,
          `Skill测试: ${skill.name || skill.id}`,
          payload.userId,
          payload.username
        );
      }

      // 简单解析结果（查找潜在的漏洞描述）
      const vulnerabilities = parseVulnerabilities(fullResponse);
      const toolCalls = parseToolCalls(fullResponse);

      return NextResponse.json({
        result: {
          status: 'completed',
          summary: fullResponse.slice(0, 2000),
          vulnerabilities,
          toolCalls,
          duration,
        },
      });
    } catch (execError) {
      const duration = Date.now() - startTime;
      return NextResponse.json({
        result: {
          status: 'failed',
          summary: '',
          vulnerabilities: [],
          toolCalls: [],
          duration,
          error: execError instanceof Error ? execError.message : '执行失败',
        },
      });
    }
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '测试 Skill 错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * 解析响应中的漏洞信息
 */
function parseVulnerabilities(response: string): Array<{
  title: string;
  description: string;
  severity: string;
  filePath?: string;
  lineStart?: number;
}> {
  const vulnerabilities: Array<{
    title: string;
    description: string;
    severity: string;
    filePath?: string;
    lineStart?: number;
  }> = [];

  // 尝试解析 JSON 格式的漏洞
  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/g);
  if (jsonMatch) {
    for (const match of jsonMatch) {
      try {
        const jsonStr = match.replace(/```json\s*/, '').replace(/\s*```/, '');
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.title || item.name || item.vulnerability) {
              vulnerabilities.push({
                title: item.title || item.name || item.vulnerability || '未知漏洞',
                description: item.description || item.details || '',
                severity: item.severity || item.level || 'medium',
                filePath: item.file || item.filePath || item.path,
                lineStart: item.line || item.lineStart || item.lineNumber,
              });
            }
          }
        }
      } catch {
        // JSON 解析失败，忽略
      }
    }
  }

  // 尝试解析 Markdown 格式的漏洞
  const vulnPatterns = [
    /(?:漏洞|Vulnerability|Issue)[：:]\s*(.+?)(?:\n|$)/gi,
    /(?:严重程度|Severity)[：:]\s*(critical|high|medium|low)/gi,
    /(?:文件|File)[：:]\s*(.+?)(?:\n|$)/gi,
  ];

  // 简单匹配漏洞标题
  const titleMatches = response.matchAll(/(?:\d+[\.\)、]\s*)?(?:漏洞|Vulnerability|Issue)[：:]\s*(.+?)(?:\n|$)/gi);
  for (const match of titleMatches) {
    if (match[1] && !vulnerabilities.some(v => v.title === match[1].trim())) {
      vulnerabilities.push({
        title: match[1].trim(),
        description: '',
        severity: 'medium',
      });
    }
  }

  return vulnerabilities.slice(0, 20); // 最多返回20个
}

/**
 * 解析响应中的工具调用信息
 */
function parseToolCalls(response: string): Array<{
  tool: string;
  parameters: Record<string, unknown>;
}> {
  const toolCalls: Array<{
    tool: string;
    parameters: Record<string, unknown>;
  }> = [];

  // 匹配工具调用格式
  const toolPattern = /(?:工具|Tool)[调用]*[：:]\s*(\w+)/gi;
  let match;
  while ((match = toolPattern.exec(response)) !== null) {
    toolCalls.push({
      tool: match[1],
      parameters: {},
    });
  }

  // 匹配函数调用格式
  const funcPattern = /(\w+)\s*\([^)]*\)/g;
  while ((match = funcPattern.exec(response)) !== null) {
    const funcName = match[1];
    if (!toolCalls.some(t => t.tool === funcName) &&
        !['if', 'for', 'while', 'function', 'const', 'let', 'var', 'return'].includes(funcName)) {
      toolCalls.push({
        tool: funcName,
        parameters: {},
      });
    }
  }

  return toolCalls.slice(0, 10); // 最多返回10个
}

/**
 * 获取模型配置
 */
async function getModelConfig() {
  // 使用数据库配置
  const defaultModel = await prisma.modelConfig.findFirst({
    where: {
      isActive: true,
      isDefault: true,
    },
  });

  if (!defaultModel) {
    const firstModel = await prisma.modelConfig.findFirst({
      where: { isActive: true },
    });
    return firstModel;
  }

  return defaultModel;
}
