import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);
  const { payload } = auth;
  
  try {
    const { id } = await params;
    const existingModel = await prisma.modelConfig.findUnique({ where: { id } });
    if (!existingModel) return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    
    if (!isAdmin(payload) && existingModel.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }
    
    const model = await prisma.modelConfig.update({
      where: { id },
      data: { contextWindow: 0, updatedAt: new Date() },
    });
    
    return NextResponse.json({ model: { id: model.id, name: model.name, contextWindow: model.contextWindow }, message: 'contextWindow 已重置为 0' });
  } catch (error) {
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}