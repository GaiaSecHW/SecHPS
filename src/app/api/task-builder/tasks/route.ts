import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { uploadAndExtractArchive, testSftpConnection, uploadFilesToRemote } from '@/lib/sftp-upload';
import { buildTenantFilter, getTenantIdForCreate } from '@/lib/tenant-filter';
import { downloadFilesFromGitea, isGiteaConfigured, GiteaAuthError } from '@/lib/gitea';

export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const formData = await request.formData();
    const name = formData.get('name') as string;
    const agentId = formData.get('agentId') as string;
    const agentName = formData.get('agentName') as string;
    const modelId = formData.get('modelId') as string | null;
    const modelName = formData.get('modelName') as string | null;
    const parameters = formData.get('parameters') as string;
    const notes = formData.get('notes') as string | null;
    const skills = formData.get('skills') as string | null;
    const scripts = formData.get('scripts') as string | null;
    const file = formData.get('file') as File | null;

    if (!name || !agentId) {
      return NextResponse.json({ error: '缺少必填参数：name 和 agentId' }, { status: 400 });
    }

    const taskId = randomUUID();
    let filePath: string | null = null;
    let projectPath: string | null = null;

    const agentApp = await prisma.agentApp.findUnique({
      where: { id: agentId },
      select: {
        engine: true,
        name: true,
        agentHarnessPath: true,
      },
    });

    // 1. 先拉取 Gitea AgentApp 文件，直接放到 taskId 目录下
    if (agentApp?.agentHarnessPath && isGiteaConfigured()) {
      try {
        console.log(`[Task] 开始下载 AgentApp 文件: ${agentId}`);
        const giteaFiles = await downloadFilesFromGitea(agentId);
        
        if (giteaFiles.length > 0) {
          const uploadResult = await uploadFilesToRemote(taskId, giteaFiles);
          projectPath = uploadResult.remoteDirPath;
          console.log(`[Task] AgentApp 文件上传完成: ${projectPath}`);
        }
      } catch (giteaError) {
        console.error('[Task] 下载/上传 AgentApp 文件失败:', giteaError);
        
        if (giteaError instanceof GiteaAuthError || (giteaError as any)?.name === 'GiteaAuthError') {
          return NextResponse.json({ 
            error: 'Gitea 认证失败', 
            details: 'GITEA_TOKEN 无效或权限不足，无法下载 AgentApp 文件。请检查 Gitea 配置。'
          }, { status: 401 });
        }
      }
    }

    // 2. 后上传用户文件到 Gitea 文件目录内
    if (file && file.size > 0) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 如果有 projectPath（Gitea 文件目录），用户文件上传到其中
        // 否则创建新的 taskId 目录
        const targetDir = projectPath || undefined;
        const result = await uploadAndExtractArchive(taskId, file.name, buffer, targetDir);
        
        if (!projectPath) {
          if (result.extracted) {
            projectPath = result.remoteDirPath;
            filePath = null;
          } else {
            filePath = result.remoteFilePath;
            projectPath = result.remoteDirPath;
          }
        }
        
        console.log(`[Task] 用户文件上传完成: ${result.extracted ? '已解压' : '未解压'}，目录: ${projectPath}`);
      } catch (uploadError) {
        console.error('文件上传/解压失败:', uploadError);
        const errorMessage = uploadError instanceof Error ? uploadError.message : '文件上传失败';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
      }
    }

    const task = await prisma.taskInstance.create({
      data: {
        id: taskId,
        userId: payload.userId,
        tenantId: tenant.tenantId,
        isPublic: tenant.isIcsTenant,
        name,
        agentId,
        agentName,
        modelId: modelId || null,
        modelName: modelName || null,
        parameters: parameters || '{}',
        filePath,
        projectPath,
        skills,
        scripts,
        notes,
        status: 'pending',
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ task });
  } catch (error) {
    console.error('创建任务失败:', error);
    return NextResponse.json({ error: '创建任务失败' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const skip = (page - 1) * limit;

  try {
    // 构建租户过滤条件
    let where: any = {};

    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      // 管理员/ICSL 可见所有
    } else {
      // 普通用户：自己的 + 公开的 + 同租户的
      const tenantFilter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        isPublicField: 'isPublic',
      });
      where.OR = [
        { userId: payload.userId },
        { ...tenantFilter },
      ];
    }

    const [tasks, total] = await Promise.all([
      prisma.taskInstance.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.taskInstance.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      tasks,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error) {
    console.error('获取任务列表失败:', error);
    return NextResponse.json({ error: '获取任务列表失败' }, { status: 500 });
  }
}

export async function GET_CONNECTION_STATUS(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    const isConnected = await testSftpConnection();
    return NextResponse.json({ connected: isConnected });
  } catch (error) {
    return NextResponse.json({ connected: false, error: 'SFTP连接测试失败' });
  }
}