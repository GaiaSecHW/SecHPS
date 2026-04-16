/**
 * 项目发现 API
 * 自动发现 Claude Code 项目并返回列表
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { ProjectDiscovery } from '@/services/session-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

// 发现所有 Claude Code 项目
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // 使用 ProjectDiscovery 发现项目
    const projectDiscovery = new ProjectDiscovery();
    const projects = await projectDiscovery.discoverProjects();

    return NextResponse.json({
      projects,
      count: projects.length,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, '发现项目错误', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// 手动添加项目
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    const body = await request.json();
    const { projectPath, displayName } = body;

    if (!projectPath) {
      return NextResponse.json({ details: { error: '缺少项目路径' } }, { status: 400 });
    }

    // 使用 ProjectDiscovery 手动添加项目
    const projectDiscovery = new ProjectDiscovery();
    const project = await projectDiscovery.addProjectManually(projectPath, { displayName });

    logger.create(LOG_MODULES.PROJECT, payload, projectPath, { displayName });

    return NextResponse.json({
      project,
      message: '项目添加成功',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    logger.errorNoUser(LOG_MODULES.PROJECT, '添加项目错误', { details: { error: errorMessage } });
    return NextResponse.json({ details: { error: errorMessage } }, { status: 500 });
  }
}
