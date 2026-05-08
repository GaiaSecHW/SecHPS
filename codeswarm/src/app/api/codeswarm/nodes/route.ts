import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const workers = await prisma.codeswarmWorker.findMany({
      orderBy: { lastHeartbeat: 'desc' },
    });
    return NextResponse.json({ nodes: workers });
  } catch (error) {
    console.error('[CodeSwarm] Get nodes error:', error);
    return NextResponse.json({ error: 'Failed to fetch nodes' }, { status: 500 });
  }
}
