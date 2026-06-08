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

  const { id } = await params;
  const url = new URL(request.url);
  const fileIndex = parseInt(url.searchParams.get('fileIndex') || '0', 10);
  const authSuccess = auth as AuthSuccessResult;

  // Vulnerability 没有 tenantId/isPublic 字段，需通过 TaskInstance 间接验证权限
  const taskInstance = await prisma.taskInstance.findFirst({
    where: { id, ...authSuccess.tenantFilter },
    select: { id: true, reportFilePath: true },
  });
  if (!taskInstance) {
    return NextResponse.json({ error: '任务不存在或无权限访问' }, { status: 404 });
  }

  const vuln = await prisma.vulnerability.findFirst({
    where: { taskId: id },
    select: { filePath: true },
  });

  let filePath = vuln?.filePath;

  if (!filePath) {
    filePath = taskInstance.reportFilePath;
  }

  if (!filePath) {
    return NextResponse.json({ error: '无报告文件' }, { status: 404 });
  }

  let files: string[] = [];
  try {
    const parsed = JSON.parse(filePath);
    if (Array.isArray(parsed)) {
      files = parsed;
    } else if (typeof parsed === 'string') {
      files = [parsed];
    }
  } catch {
    files = [filePath];
  }

  if (fileIndex < 0 || fileIndex >= files.length) {
    return NextResponse.json({ error: `fileIndex 越界 (0~${files.length - 1})` }, { status: 400 });
  }

  const presignedUrl = files[fileIndex];
  const objectName = extractObjectName(presignedUrl);
  const fileName = presignedUrl.split('/').pop()?.split('?')[0] || 'report';
  logger.info(LOG_MODULES.MINIO, `[DownloadReport:${id}] objectName=${objectName}, fileName=${fileName}`);

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
    return NextResponse.json(
      { error: `下载失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}