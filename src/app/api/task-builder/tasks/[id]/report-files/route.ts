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

  const vuln = await prisma.vulnerability.findFirst({
    where: { taskId: id, ...authSuccess.tenantFilter },
    select: { filePath: true },
  });

  if (!vuln?.filePath) {
    return NextResponse.json({ error: '无报告文件', hasReport: false }, { status: 200 });
  }

  let files: { name: string }[] = [];
  try {
    const parsed = JSON.parse(vuln.filePath);
    if (Array.isArray(parsed)) {
      files = parsed.map((url: string) => ({
        name: url.split('/').pop()?.split('?')[0] || 'report',
      }));
    } else if (typeof parsed === 'string') {
      files = [{ name: parsed.split('/').pop()?.split('?')[0] || 'report' }];
    }
  } catch {
    files = [{ name: vuln.filePath.split('/').pop()?.split('?')[0] || 'report' }];
  }

  return NextResponse.json({ hasReport: true, files });
}