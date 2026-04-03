// src/app/api/code/analyze/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/code/analyze - 分析项目代码
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, options } = body;

    if (!projectId) {
      return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { files: true },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 检查是否已有结构分析
    let structure = await prisma.projectStructure.findUnique({
      where: { projectId },
    });

    if (!structure) {
      // 创建初始结构记录
      structure = await prisma.projectStructure.create({
        data: {
          projectId,
          structure: '{}',
          fileCount: project.files.length,
          codeCount: project.files.filter(f =>
            ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp'].includes(f.fileType)
          ).length,
          languageStats: '{}',
          status: 'pending',
        },
      });

      // TODO: 实际分析逻辑（后台任务）
      // 这里只更新状态为分析中
      await prisma.projectStructure.update({
        where: { id: structure.id },
        data: { status: 'analyzing' },
      });
    }

    // 统计知识库
    const knowledgeCount = await prisma.codeKnowledge.count({
      where: { projectId },
    });

    // 统计数据流
    const dataFlowCount = await prisma.dataFlow.count({
      where: { projectId },
    });

    return NextResponse.json({
      projectId,
      structure: structure ? {
        id: structure.id,
        projectId: structure.projectId,
        structure: JSON.parse(structure.structure),
        fileCount: structure.fileCount,
        codeCount: structure.codeCount,
        languageStats: JSON.parse(structure.languageStats),
        status: structure.status,
        analyzedAt: structure.analyzedAt,
        createdAt: structure.createdAt,
        updatedAt: structure.updatedAt,
      } : null,
      knowledgeCount,
      dataFlowCount,
      status: structure?.status || 'pending',
    });
  } catch (error) {
    console.error('分析项目错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
