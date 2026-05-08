import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse, isAdmin } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { generateId } from '@/lib/id-generator';
import { PERMISSIONS } from '@/types/permissions';
import { mkdir, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { logger, LOG_MODULES } from '@/lib/logger';
import { buildTenantFilter, getTenantIdForCreate, getVisibility } from '@/lib/tenant-filter';

// 获取项目列表
export async function GET(request: Request) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.PROJECT_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    // 构建租户过滤条件
    let where: any = {};

    if (status) {
      where.status = status;
    }

    // 根据用户角色和租户过滤
    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      // 管理员/ICSL 可见所有
    } else {
      // 普通用户：自己的 + 公开的 + 同租户的
      const tenantFilter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        visibilityField: 'visibility',
      });
      where.OR = [
        { userId: payload.userId },
        { ...tenantFilter },
      ];
    }

    const projects = await prisma.project.findMany({
      where,
      orderBy: {
        createdAt: 'desc',  // 按创建时间降序排列
      },
      include: {
        ProjectFile: {
          orderBy: {
            uploadedAt: 'desc',
          },
        },
        EvaluationSession: {
          orderBy: {
            startedAt: 'desc',
          },
          // 不限制数量，确保能获取到所有运行中的评估
          // 之前 take: 3 可能导致运行中的评估不在返回列表中
        },
        User: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        _count: {
          select: {
            Vulnerability: {
              where: {
                status: { notIn: ['false-positive', 'closed'] }
              }
            }
          }
        }
      },
    });

    // 转换数据格式，添加漏洞数量和运行状态
    const projectsWithVulnCount = projects.map(project => {
      // 计算评估状态（preparing、running、queued 都算活跃状态）
      // queued 状态也应该阻止新的评估启动
      const runningCount = project.EvaluationSession?.filter((e: any) => 
        e.status === 'running' || e.status === 'preparing' || e.status === 'queued'
      ).length || 0;
      const waitingCount = project.EvaluationSession?.filter((e: any) => e.status === 'ready').length || 0;
      const completedCount = project.EvaluationSession?.filter((e: any) => e.status === 'completed').length || 0;
      const failedCount = project.EvaluationSession?.filter((e: any) => e.status === 'failed' || e.status === 'cancelled').length || 0;
      
      // 状态优先级：running > waiting > 最新评估状态
      // 如果有运行中的评估，显示 running
      // 如果有排队的评估，显示 waiting
      // 否则显示最新评估的状态（按 startedAt 排序）
      let evaluationStatus = 'idle';
      
      // 先检查是否有运行中/排队中的评估
      if (runningCount > 0) {
        evaluationStatus = 'running';
      } else if (waitingCount > 0) {
        evaluationStatus = 'waiting';
      } else {
        // 没有运行/排队的，显示最新评估的状态
        const allEvals = project.EvaluationSession || [];
        if (allEvals.length > 0) {
          // 按 startedAt 降序排序，取最新的评估状态
          const latestEval = allEvals.sort((a: any, b: any) => 
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
          )[0];
          evaluationStatus = latestEval.status || 'idle';
        }
      }
      
      return {
        ...project,
        evaluations: project.EvaluationSession || [],
        vulnerabilityCount: project._count?.Vulnerability || 0,
        hasRunningEvaluation: runningCount > 0,
        hasWaitingEvaluation: waitingCount > 0,
        evaluationStatus, // 新增：综合评估状态（与页面显示一致）
        evaluationCounts: { running: runningCount, waiting: waitingCount, completed: completedCount, failed: failedCount },
        userName: project.User?.name || null,
        userUsername: project.User?.username || null,
        User: undefined,
      };
    });

    return NextResponse.json({ projects: projectsWithVulnCount });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, '获取项目列表错误', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// 创建新项目
export async function POST(request: Request) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.PROJECT_CREATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    const formData = await request.formData();
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const techStackStr = formData.get('techStack') as string;
    const isPublic = formData.get('isPublic') === 'true';
    const files = formData.getAll('files') as File[];

    // 解析技术栈（JSON 字符串）
    let techStack: string[] = [];
    if (techStackStr) {
      try {
        techStack = JSON.parse(techStackStr);
      } catch {
        // 解析失败，忽略
      }
    }

    if (!name || !name.trim()) {
      return NextResponse.json({ details: { error: '项目名称是必需的' } }, { status: 400 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ details: { error: '请至少上传一个文件' } }, { status: 400 });
    }

    // 验证：只有 ICSL 或平台管理员可创建 public
    if (isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
      return NextResponse.json({ details: { error: '只有 ICSL 租户可以创建公共资源' } }, { status: 403 });
    }

    // 获取租户 ID 和可见性
    const visibility = getVisibility(isPublic);
    const tenantId = getTenantIdForCreate(tenant, isPublic);

    // 获取系统配置中的项目上传目录
    const config = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
    });

    // 使用配置的目录或默认目录
    const uploadBaseDir = config?.projectUploadDir
      ? config.projectUploadDir
      : join(process.cwd(), 'uploads');

    logger.debug(LOG_MODULES.PROJECT, `上传目录: ${uploadBaseDir}`, { userId: payload.userId });
    
    // 创建项目目录
    const projectDir = join(uploadBaseDir, 'projects', Date.now().toString());
    logger.debug(LOG_MODULES.PROJECT, `项目目录: ${projectDir}`, { userId: payload.userId });
    
    await mkdir(projectDir, { recursive: true });

    // 保存文件
    const savedFiles = [];
    for (const file of files) {
      if (file instanceof File) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = join(projectDir, file.name);
        await writeFile(filePath, buffer);
        savedFiles.push({
          name: file.name,
          size: file.size,
          type: file.type,
          path: filePath,
        });
      }
    }

    // 创建项目记录
    const project = await prisma.project.create({
      data: {
        id: generateId('proj'),
        name: name.trim(),
        description: description || null,
        projectPath: projectDir,
        techStack: techStack.length > 0 ? JSON.stringify(techStack) : null,
        userId: payload.userId,
        tenantId,
        visibility,
        status: 'idle',
        updatedAt: new Date(),
      },
    });

    // 创建文件记录
    for (const file of savedFiles) {
      await prisma.projectFile.create({
        data: {
          id: generateId('file'),
          projectId: project.id,
          fileName: file.name,
          filePath: file.path,
          fileSize: file.size,
          fileType: file.type,
        },
      });
    }

    // 继承全局默认工具权限配置
    if (config?.defaultToolPermissions) {
      try {
        const defaultPermissions = JSON.parse(config.defaultToolPermissions);
        if (Array.isArray(defaultPermissions) && defaultPermissions.length > 0) {
          for (const perm of defaultPermissions) {
            if (perm.toolPattern && perm.permission) {
              await prisma.toolPermission.create({
                data: {
                  id: generateId('toolperm'),
                  projectId: project.id,
                  toolPattern: perm.toolPattern,
                  permission: perm.permission,
                  description: perm.description || `继承全局默认配置`,
                  updatedAt: new Date(),
                },
              });
            }
          }
          logger.debug(LOG_MODULES.PROJECT, `已继承默认工具权限: ${defaultPermissions.length}条`, { userId: payload.userId });
        }
      } catch (err) {
        logger.warn(LOG_MODULES.PROJECT, `继承默认工具权限失败: ${err}`, { userId: payload.userId });
      }
    }

    // 记录创建成功日志
    logger.create(LOG_MODULES.PROJECT, payload, project.id, { name, techStack, files: files.length });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, `创建项目错误: ${error}`);
    return NextResponse.json({ details: { error: '服务器内部错误', details: String(error) } }, { status: 500 });
  }
}
