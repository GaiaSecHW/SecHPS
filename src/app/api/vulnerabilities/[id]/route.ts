import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const { id } = await params;

    const vulnerability = await prisma.vulnerability.findUnique({
      where: { id },
      include: {
        Project: {
          select: {
            id: true,
            name: true,
          },
        },
        TaskInstance: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!vulnerability) {
      return NextResponse.json(
        { error: 'Vulnerability not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ vulnerability });
  } catch (error) {
    logger.error(LOG_MODULES.VULNERABILITY, 'Error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: 'Failed to fetch vulnerability' },
      { status: 500 }
    );
  }
}