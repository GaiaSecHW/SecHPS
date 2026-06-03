import { NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse, AuthSuccessResult } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';
import { extractObjectName, getObjectStream } from '@/lib/minio-vulnerability';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.VULNERABILITY_READ });
  if (!auth.success) return authErrorResponse(auth);
  const { payload, tenant } = auth as AuthSuccessResult;

  const { id } = await params;
  const url = new URL(request.url);
  const index = parseInt(url.searchParams.get('index') || '0', 10);

  const vulnerability = await prisma.vulnerability.findUnique({
    where: { id },
    include: {
      Project: { select: { id: true, userId: true, tenantId: true, isPublic: true } },
      TaskInstance: { select: { id: true, userId: true, tenantId: true } },
    },
  });

  if (!vulnerability) {
    return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
  }

  const isPrivileged = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles.includes('admin'));
  if (!isPrivileged) {
    const task = vulnerability.TaskInstance;
    const project = vulnerability.Project;
    const hasTaskAccess = task && (task.userId === payload.userId || task.tenantId === tenant.tenantId);
    const hasProjectAccess = project && (project.userId === payload.userId || project.isPublic || project.tenantId === tenant.tenantId);
    if (!hasTaskAccess && !hasProjectAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  if (!vulnerability.rawReport) {
    return NextResponse.json({ error: '无原始报告' }, { status: 404 });
  }

  const urls = vulnerability.rawReport.split(';').map(p => p.trim()).filter(p => p.startsWith('http://') || p.startsWith('https://'));

  if (index < 0 || index >= urls.length) {
    return NextResponse.json({ error: `index 越界 (0~${urls.length - 1})` }, { status: 400 });
  }

  const presignedUrl = urls[index];
  const objectName = extractObjectName(presignedUrl);
  const fileName = presignedUrl.split('/').pop()?.split('?')[0] || 'raw-report';
  logger.info(LOG_MODULES.MINIO, `[DownloadRawReport:${id}] objectName=${objectName}, fileName=${fileName}`);

  try {
    const nodeStream = await getObjectStream(objectName);

    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer) => controller.enqueue(chunk));
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err: Error) => controller.error(err));
      },
    });

    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      json: 'application/json',
      md: 'text/markdown',
      txt: 'text/plain',
      pdf: 'application/pdf',
      html: 'text/html',
      xml: 'application/xml',
      csv: 'text/csv',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    return new NextResponse(webStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    logger.error(LOG_MODULES.MINIO, `[DownloadRawReport:${id}] 下载失败: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json(
      { error: `下载失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}