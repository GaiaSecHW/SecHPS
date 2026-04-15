// src/app/api/autonomous-evolution/system-prompt/route.ts
// GET 当前注入的 System Prompt 片段

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { buildExperiencePrompt } from '@/services/autonomous-evolution/system-prompt-builder';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  if (!hasPermission(payload.permissions, PERMISSIONS.AUTONOMOUS_EVOLUTION_READ)) {
    return NextResponse.json({ error: '禁止访问' }, { status: 403 });
  }

  const prompt = await buildExperiencePrompt();
  return NextResponse.json({ prompt });
}
