import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { getTenantIdForCreate } from '@/lib/tenant-filter';
import { prisma } from '@/lib/prisma';
import { uploadFileToGitea, isGiteaConfigured, getGiteaRepoUrl, GiteaAuthError } from '@/lib/gitea';
import { generatePipelinePy, type AgentFlowNode, type AgentFlowEdge } from '@/lib/agentflow-codegen';
import { logger, LOG_MODULES } from '@/lib/logger';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;
  const { id } = await context.params;

  try {
    const pipeline = await prisma.agentFlowPipeline.findUnique({
      where: { id },
      include: {
        AgentApp: true,
      },
    });

    if (!pipeline) {
      return NextResponse.json({ error: 'Pipeline 不存在' }, { status: 404 });
    }

    if (pipeline.userId !== payload.userId) {
      return NextResponse.json({ error: '只有创建者可以发布 Pipeline' }, { status: 403 });
    }

    const nodes = pipeline.nodes as unknown as AgentFlowNode[];
    const edges = pipeline.edges as unknown as AgentFlowEdge[];

    if (!nodes || nodes.length === 0) {
      return NextResponse.json({ error: 'Pipeline 至少需要一个节点' }, { status: 400 });
    }

    const pythonSource = generatePipelinePy(pipeline.name, nodes, edges);

    let agentAppId: string;
    let agentAppName: string;

    if (pipeline.agentAppId) {
      const existingApp = await prisma.agentApp.findUnique({
        where: { id: pipeline.agentAppId },
      });

      if (!existingApp) {
        return NextResponse.json({ error: '关联的 AgentApp 不存在' }, { status: 404 });
      }

      agentAppId = existingApp.id;
      agentAppName = existingApp.name;
    } else {
      const tenantId = getTenantIdForCreate(tenant, false);

      const newApp = await prisma.agentApp.create({
        data: {
          id: crypto.randomUUID(),
          name: pipeline.name,
          engine: 'agentflow',
          startCommand: 'agentflow run pipeline.py',
          agentHarnessPath: '',
          defaultAgentName: 'agentflow',
          userId: payload.userId,
          tenantId,
          isPublic: false,
          status: 'active',
          updatedAt: new Date(),
        },
      });

      agentAppId = newApp.id;
      agentAppName = newApp.name;
    }

    const response: {
      agentAppId: string;
      agentAppName: string;
      giteaUrl?: string;
      giteaWarning?: string;
    } = {
      agentAppId,
      agentAppName,
    };

    if (isGiteaConfigured()) {
      try {
        const result = await uploadFileToGitea(agentAppId, 'pipeline.py', pythonSource);
        if (result) {
          response.giteaUrl = result.url;
        }
      } catch (giteaError) {
        if (giteaError instanceof GiteaAuthError) {
          return NextResponse.json(
            { error: 'Gitea 认证失败', details: giteaError.message },
            { status: 500 }
          );
        }
        response.giteaWarning = giteaError instanceof Error ? giteaError.message : 'Gitea 上传失败';
      }
    }

    await prisma.agentFlowPipeline.update({
      where: { id },
      data: {
        agentAppId,
        status: 'published',
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error(LOG_MODULES.WORKFLOW, '发布 Pipeline 失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: '发布 Pipeline 失败', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
