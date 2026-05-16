import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { downloadSingleFileFromGitea } from '@/lib/gitea';
import { parsePipelinePy, type PipelineData } from '@/lib/agentflow-parser';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/agent-apps/[id]/pipeline
 *
 * 获取 AgentFlow 应用的 pipeline.py 文件并解析为 DAG 结构。
 *
 * 返回：
 * - 成功: { pipeline: PipelineData }
 * - 解析失败: { error: string, rawSource?: string }
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    console.log('[agent-apps pipeline GET] Auth failed:', auth.error);
    return authErrorResponse(auth);
  }

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const params = await context.params;
    const appId = params.id;

    console.log('[agent-apps pipeline GET] Fetch request:', { appId, userId: payload.userId });

    // 1. 查询 AgentApp
    const app = await prisma.agentApp.findUnique({
      where: { id: appId },
    });

    if (!app) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 });
    }

    // 权限检查：非管理员只能查看自己的或公共应用
    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant) {
      if (app.userId !== payload.userId && !app.isPublic) {
        return NextResponse.json({ error: '无权限访问此应用' }, { status: 403 });
      }
    }

    if (!app) {
      return NextResponse.json({ error: '应用不存在或无权限访问' }, { status: 404 });
    }

    // 2. 检查 engine 是否为 agentflow
    if (app.engine !== 'agentflow') {
      return NextResponse.json(
        { error: `该应用的 engine 类型为 "${app.engine}"，仅支持 agentflow 类型的应用` },
        { status: 400 }
      );
    }

    // 3. 从 startCommand 提取 pipeline 文件名
    let pipelineFileName = 'pipeline.py'; // 默认文件名

    if (app.startCommand) {
      // 匹配 agentflow run (.+\.py) 模式
      const runMatch = app.startCommand.match(/agentflow\s+run\s+(\S+\.py)/);
      if (runMatch && runMatch[1]) {
        pipelineFileName = runMatch[1];
      }
    }

    console.log('[agent-apps pipeline GET] Extracted pipeline file name:', pipelineFileName);

    // 4. 从 Gitea 下载 .py 文件
    const fileContent = await downloadSingleFileFromGitea(appId, pipelineFileName);

    if (!fileContent) {
      return NextResponse.json(
        { error: `pipeline 文件 "${pipelineFileName}" 不存在` },
        { status: 404 }
      );
    }

    const rawSource = fileContent.toString('utf-8');
    console.log('[agent-apps pipeline GET] Downloaded file size:', rawSource.length);

    // 5. 解析 pipeline.py
    const pipeline = parsePipelinePy(rawSource);

    if (!pipeline) {
      return NextResponse.json(
        {
          error: 'pipeline.py 解析失败，无法提取 DAG 结构',
          rawSource,
        },
        { status: 422 } // Unprocessable Entity
      );
    }

    console.log('[agent-apps pipeline GET] Parsed pipeline:', {
      name: pipeline.name,
      nodeCount: pipeline.nodes.length,
      fanoutCount: Object.keys(pipeline.fanouts).length,
    });

    // 6. 返回解析结果
    return NextResponse.json({ pipeline, rawSource });
  } catch (error) {
    console.error('[agent-apps pipeline GET] Error:', error);
    return NextResponse.json(
      {
        error: '获取 pipeline 失败',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
