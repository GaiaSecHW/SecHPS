// src/app/api/autonomous-evolution/injection-config/route.ts

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getInjectionEnabled, setInjectionEnabled } from '@/services/autonomous-evolution/idle-trigger';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  const enabled = await getInjectionEnabled();
  return NextResponse.json({ enabled });
}

export async function PUT(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  const { enabled } = await request.json();
  await setInjectionEnabled(Boolean(enabled));
  return NextResponse.json({ enabled: Boolean(enabled) });
}
