import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

export async function GET(request: NextRequest) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all';

    const result: { skills?: any[]; scripts?: string[] } = {};

    if (type === 'all' || type === 'skills') {
      const skills = await prisma.skill.findMany({
        where: {
          isLatest: true,
          isActive: true,
          OR: [
            { userId: null },
            { userId: auth.payload.userId },
            { isPublic: true },
          ],
        },
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
          cwe: true,
        },
        orderBy: { displayName: 'asc' },
      });
      result.skills = skills;
    }

    if (type === 'all' || type === 'scripts') {
      const scriptsDir = path.join(process.cwd(), 'data', 'scripts');
      const scripts: string[] = [];
      
      if (fs.existsSync(scriptsDir)) {
        const files = fs.readdirSync(scriptsDir);
        files.forEach(file => {
          if (file.endsWith('.sh') || file.endsWith('.py') || file.endsWith('.js')) {
            scripts.push(file);
          }
        });
      }
      result.scripts = scripts;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('获取可用资源失败:', error);
    return NextResponse.json({ error: '获取可用资源失败' }, { status: 500 });
  }
}