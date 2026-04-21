// src/app/api/autonomous-evolution/system-prompt/route.ts
// GET 当前注入的 System Prompt 片段

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { buildExperiencePrompt } from '@/services/autonomous-evolution/system-prompt-builder';

export async function GET(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AUTONOMOUS_EVOLUTION_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  const prompt = await buildExperiencePrompt();
  return NextResponse.json({ prompt });
}
