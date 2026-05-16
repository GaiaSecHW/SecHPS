import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { buildTenantFilter } from '@/lib/tenant-filter';
import { prisma } from '@/lib/prisma';
import { gitAgentAppSync } from '@/services/git-agent-app-sync';
import AdmZip from 'adm-zip';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    let apps;
    const include = {
      Tenant: {
        select: {
          name: true,
        },
      },
    };

    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      apps = await prisma.agentApp.findMany({
        include,
        orderBy: { createdAt: 'desc' },
      });
    } else {
      const filter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        isPublicField: 'isPublic',
      });
      apps = await prisma.agentApp.findMany({
        where: {
          OR: [{ ...filter }, { userId: payload.userId }],
        },
        include,
        orderBy: { createdAt: 'desc' },
      });
    }

    return NextResponse.json({ apps });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取应用列表失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '获取应用列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const formData = await request.formData();

    const name = formData.get('name') as string;
    const engine = formData.get('engine') as string;
    const defaultAgentName = formData.get('defaultAgentName') as string;
    const startCommand = formData.get('startCommand') as string | null;
    const inputRequirements = formData.get('inputRequirements') as string | null;
    const isPublic = formData.get('isPublic') === 'true';
    const frontendTenantId = formData.get('tenantId') as string | null;
    const fileType = formData.get('agentHarnessFileType') as string | null;
    const agentHarnessFile = formData.get('agentHarnessFile') as File | null;
    const filesJson = formData.get('filesJson') as string | null;

    if (!name || !engine || !defaultAgentName) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    if (!agentHarnessFile) {
      return NextResponse.json({ error: '请上传 AgentHarness 文件' }, { status: 400 });
    }

    if (isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
      return NextResponse.json(
        { error: '只有 ICSL 租户或管理员可以创建公共资源' },
        { status: 403 }
      );
    }

    let tenantId: string | null;
    if (isPublic) {
      tenantId = null;
    } else if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      tenantId = frontendTenantId || null;
      if (!tenantId) {
        return NextResponse.json({ error: '请选择租户或勾选公开' }, { status: 400 });
      }
    } else {
      tenantId = tenant.tenantId;
    }

    const appId = crypto.randomUUID();
    const filesMap = new Map<string, Buffer>();

    // 处理上传的文件
    if (fileType === 'archive' && agentHarnessFile && agentHarnessFile.size > 0) {
      const fileBuffer = Buffer.from(await agentHarnessFile.arrayBuffer());
      const zip = new AdmZip(fileBuffer);
      const zipEntries = zip.getEntries();
      
      for (const entry of zipEntries) {
        if (!entry.isDirectory) {
          filesMap.set(entry.entryName, entry.getData());
        }
      }
    } else if (fileType === 'folder' && filesJson) {
      const filesInfo: { key: string; relativePath: string }[] = JSON.parse(filesJson);
      
      for (const info of filesInfo) {
        const file = formData.get(info.key) as File;
        if (file) {
          const fileBuffer = Buffer.from(await file.arrayBuffer());
          const relativePath = info.relativePath.replace(/^[^\/]+\//, '');
          filesMap.set(relativePath, fileBuffer);
        }
      }
    }

    // Git 方式上传
    const gitResult = await gitAgentAppSync.uploadAgentApp(appId, filesMap);
    
    if (!gitResult.success) {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, 'Git 上传 AgentApp 失败', appId, { 
        details: { appId, errors: gitResult.errors } 
      });
      return NextResponse.json({ 
        error: 'Git 上传失败', 
        details: gitResult.message 
      }, { status: 500 });
    }

    const agentHarnessPath = `${appId}/`;

    const app = await prisma.agentApp.create({
      data: {
        id: appId,
        userId: payload.userId,
        name,
        engine,
        agentHarnessPath,
        defaultAgentName,
        startCommand: startCommand || null,
        inputRequirements: inputRequirements || null,
        status: 'active',
        tenantId,
        isPublic,
        updatedAt: new Date(),
      },
    });

    logger.info(LOG_MODULES.SKILL, 'AgentApp 创建成功', { appId, name, gitUpload: gitResult.success });

    return NextResponse.json({ app, gitUploaded: gitResult.success });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '创建应用失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '创建应用失败' }, { status: 500 });
  }
}