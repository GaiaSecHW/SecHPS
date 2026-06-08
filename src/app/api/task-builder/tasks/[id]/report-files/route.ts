import { NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse, AuthSuccessResult } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.VULNERABILITY_READ });
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await params;
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
    return NextResponse.json({ hasReport: false });
  }

  let files: { name: string }[] = [];
  try {
    const parsed = JSON.parse(filePath);
    if (Array.isArray(parsed)) {
      files = parsed.map((url: string) => ({
        name: url.split('/').pop()?.split('?')[0] || 'report',
      }));
    } else if (typeof parsed === 'string') {
      files = [{ name: parsed.split('/').pop()?.split('?')[0] || 'report' }];
    }
  } catch {
    files = [{ name: filePath.split('/').pop()?.split('?')[0] || 'report' }];
  }

  return NextResponse.json({ hasReport: true, files });
}