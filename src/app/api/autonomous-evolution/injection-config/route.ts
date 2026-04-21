// src/app/api/autonomous-evolution/injection-config/route.ts

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { getInjectionEnabled, setInjectionEnabled } from '@/services/autonomous-evolution/idle-trigger';

export async function GET(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AUTONOMOUS_EVOLUTION_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  const enabled = await getInjectionEnabled();
  return NextResponse.json({ enabled });
}

export async function PUT(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AUTONOMOUS_EVOLUTION_UPDATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  const { enabled } = await request.json();
  await setInjectionEnabled(Boolean(enabled));
  return NextResponse.json({ enabled: Boolean(enabled) });
}
