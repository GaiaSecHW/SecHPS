import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_READ });
  if (!auth.success) return authErrorResponse(auth);

  try {
    const agents = await prisma.agentDefinition.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        category: true,
        model: true,
        skills: true,
        isBuiltin: true,
      },
    });

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('获取 Agent 列表失败:', error);
    return NextResponse.json({ error: '获取 Agent 列表失败' }, { status: 500 });
  }
}