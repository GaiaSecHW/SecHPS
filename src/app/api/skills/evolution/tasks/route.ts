// src/app/api/skills/evolution/tasks/route.ts
// GET - 获取进化任务列表

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getEvolutionTaskStats } from '@/services/skill-evolution/evolution-scheduler';

export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const skillId = searchParams.get('skillId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const statsOnly = searchParams.get('statsOnly') === 'true';

    // If only stats requested
    if (statsOnly) {
      const stats = await getEvolutionTaskStats();
      return NextResponse.json({ stats });
    }

    // Build where clause
    const where: {
      status?: string;
      skillId?: string;
    } = {};
    
    if (status) {
      where.status = status;
    }
    if (skillId) {
      where.skillId = skillId;
    }

    // Get tasks with pagination
    const [tasks, total] = await Promise.all([
      prisma.skillEvolutionTask.findMany({
        where,
        include: {
          Skill: {
            select: {
              id: true,
              name: true,
              displayName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.skillEvolutionTask.count({ where }),
    ]);

    // Get stats
    const stats = await getEvolutionTaskStats();

    return NextResponse.json({
      tasks,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      stats,
    });
  } catch (error) {
    console.error('[EvolutionTasksAPI] Error fetching tasks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch evolution tasks' },
      { status: 500 }
    );
  }
}