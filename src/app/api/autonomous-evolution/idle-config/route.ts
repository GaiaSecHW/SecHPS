// src/app/api/autonomous-evolution/idle-config/route.ts

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { getIdleTriggerConfig, saveIdleTriggerConfig } from '@/services/autonomous-evolution/idle-trigger';

export async function GET(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AUTONOMOUS_EVOLUTION_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  const config = await getIdleTriggerConfig();
  return NextResponse.json(config);
}

export async function PUT(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AUTONOMOUS_EVOLUTION_UPDATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  const body = await request.json();
  await saveIdleTriggerConfig(body);
  const updated = await getIdleTriggerConfig();
  return NextResponse.json(updated);
}
