import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOrCreateProjectClient, releaseProjectClient } from '@/lib/opencode-manager';

// 启动项目评估
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

    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const project = await prisma.project.findUnique({
      where: { id },
      include: { config: true },
    });

    if (!project || project.userId !== payload.userId) {
      return NextResponse.json({ error: '未找到项目' }, { status: 404 });
    }

    if (!project.projectPath) {
      return NextResponse.json({ error: '项目目录未配置' }, { status: 400 });
    }

    // 获取模型配置
    const modelStr = project.config!.modelPreferences || 'openai/gpt-4';

    // 使用新的 OpenCode 管理器创建实例
    console.log('[Start API] Creating OpenCode instance for project:', id);
    const { client, server } = await getOrCreateProjectClient(id);
    console.log('[Start API] OpenCode instance ready at:', server.url);

    // 创建会话
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN').replace(/\//g, '-').replace(/:/g, '-');
    
    const sessionResult = await client.session.create({
      body: { title: `${project.name} ${timeStr}` }
    });
    
    if (sessionResult.error) {
      releaseProjectClient(id);
      return NextResponse.json({ 
        error: '创建会话失败', 
        details: sessionResult.error 
      }, { status: 500 });
    }
    
    const sessionId = sessionResult.data.id;
    console.log('[Start API] Session created:', sessionId);

    // 创建评估记录（保存端口信息）
    const port = parseInt(server.url.split(':').pop() || '3000');
    const evaluation = await prisma.evaluationSession.create({
      data: {
        projectId: project.id,
        opencodeSessionId: sessionId,
        port: port,
        status: 'running',
      },
    });

    // 发送任务描述
    if (project.config!.taskDescription) {
      const [providerID, modelID] = modelStr.split('/');
      
      const promptResult = await client.session.prompt({
        path: { id: sessionId },
        body: {
          model: { providerID: providerID || 'openai', modelID: modelID || 'gpt-4' },
          parts: [{ type: 'text' as const, text: project.config!.taskDescription }],
        },
      });
      
      if (promptResult.error) {
        releaseProjectClient(id);
        try { await client.session.delete({ path: { id: sessionId } }); } catch {}
        await prisma.evaluationSession.delete({ where: { id: evaluation.id } });
        return NextResponse.json({ error: '发送任务描述失败' }, { status: 500 });
      }
    }

    // 更新项目状态
    await prisma.project.update({
      where: { id },
      data: { status: 'running' },
    });

    return NextResponse.json({
      message: '评估启动成功',
      evaluation: {
        id: evaluation.id,
        opencodeSessionId: sessionId,
        port: port,
        status: evaluation.status,
        startedAt: evaluation.startedAt,
      },
    });
  } catch (error) {
    console.error('Start evaluation error:', error);
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
