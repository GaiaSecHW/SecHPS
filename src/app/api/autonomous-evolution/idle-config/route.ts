// src/app/api/autonomous-evolution/idle-config/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getIdleTriggerConfig, saveIdleTriggerConfig } from '@/services/autonomous-evolution/idle-trigger';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  if (!hasPermission(payload.permissions, PERMISSIONS.AUTONOMOUS_EVOLUTION_READ)) {
    return NextResponse.json({ error: '禁止访问' }, { status: 403 });
  }

  const config = await getIdleTriggerConfig();
  return NextResponse.json(config);
}

export async function PUT(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  if (!hasPermission(payload.permissions, PERMISSIONS.AUTONOMOUS_EVOLUTION_UPDATE)) {
    return NextResponse.json({ error: '禁止访问' }, { status: 403 });
  }

  const body = await request.json();
  await saveIdleTriggerConfig(body);
  const updated = await getIdleTriggerConfig();
  return NextResponse.json(updated);
}
