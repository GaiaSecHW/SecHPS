// Ralph Loop Agent 启动端点 - 兼容层
// 内部转发到统一 executeRalphLoop 逻辑

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { executeRalphLoop, getRalphModelConfig } from '@/lib/ralph-executor';
import type { RalphLoopAgentConfig } from '@/services/evaluation';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });

    const payload = verifyToken(authHeader.replace('Bearer ', ''));
    if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

    const { id } = await params;
    const userIsAdmin = isAdmin(payload);

    const evaluation = await prisma.evaluationSession.findFirst({
      where: { id },
      include: { Project: { include: { OpencodeConfig: true, ProjectFile: true } } },
    });

    if (!evaluation) return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    if (!userIsAdmin && evaluation.Project.userId !== payload.userId) return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    if (evaluation.status === 'running') return NextResponse.json({ error: '评估会话已在运行中' }, { status: 400 });

    const modelConfig = await getRalphModelConfig();
    if (!modelConfig) return NextResponse.json({ error: '未找到激活的模型配置' }, { status: 404 });

    const body = await request.json();
    const { maxIterations = 15, maxTokens = 100000, maxCost = 5.00, verifyCompletionConfig } = body;

    let verifyCompletion: RalphLoopAgentConfig['verifyCompletion'] | undefined;
    if (verifyCompletionConfig?.type === 'tool-call') {
      const { toolName } = verifyCompletionConfig as { toolName: string };
      verifyCompletion = async ({ result }) => result.text.includes(toolName)
        ? { complete: true, reason: `检测到工具调用: ${toolName}` }
        : { complete: false, reason: `未检测到工具调用: ${toolName}` };
    } else if (verifyCompletionConfig?.type === 'keyword') {
      const { keywords } = verifyCompletionConfig as { keywords: string[] };
      verifyCompletion = async ({ result }) => {
        const text = result.text.toLowerCase();
        for (const kw of keywords) if (text.includes(kw.toLowerCase())) return { complete: true, reason: `检测到关键词: ${kw}` };
        return { complete: false, reason: `未检测到关键词: ${keywords.join(', ')}` };
      };
    } else if (verifyCompletionConfig?.type === 'custom') {
      return NextResponse.json({ error: '自定义验证类型暂未实现' }, { status: 501 });
    }

    const result = await executeRalphLoop({
      evaluationId: id,
      projectId: evaluation.projectId,
      projectPath: evaluation.Project.projectPath || undefined,
      projectName: evaluation.Project.name,
      projectDescription: evaluation.Project.description || undefined,
      environmentUrl: evaluation.Project.environmentUrl || undefined,
      files: evaluation.Project.ProjectFile.map(f => ({ name: f.fileName, type: f.fileType, size: f.fileSize })),
      taskDescription: evaluation.Project.OpencodeConfig?.taskDescription || undefined,
      modelConfig,
      ralphConfig: { maxIterations, maxTokens, maxCost, verifyCompletion },
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, 'Ralph 启动错误:', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}