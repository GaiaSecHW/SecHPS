import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    const where = auth.payload.roles?.includes('admin') 
      ? {} 
      : { userId: auth.payload.userId };

    const apps = await prisma.agentApp.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ apps });
  } catch (error) {
    console.error('获取应用列表失败:', error);
    return NextResponse.json({ error: '获取应用列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    const formData = await request.formData();
    
    const name = formData.get('name') as string;
    const engine = formData.get('engine') as string;
    const startCommand = formData.get('startCommand') as string;
    const notes = formData.get('notes') as string | null;

    if (!name || !engine || !startCommand) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const app = await prisma.agentApp.create({
      data: {
        id: crypto.randomUUID(),
        userId: auth.payload.userId,
        name,
        engine,
        skillPath: `/agent-apps/${crypto.randomUUID()}/skill`,
        startCommand,
        notes: notes || null,
        status: 'active',
      },
    });

    return NextResponse.json({ app });
  } catch (error) {
    console.error('创建应用失败:', error);
    return NextResponse.json({ error: '创建应用失败' }, { status: 500 });
  }
}