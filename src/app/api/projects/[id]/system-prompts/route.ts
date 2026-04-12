import { NextResponse } from 'next/server';

/**
 * 系统提示词 API - 暂未实现
 * SystemPrompt 模型尚未在数据库中定义
 */

// GET /api/projects/:id/system-prompts - 获取项目的系统提示词列表
export async function GET() {
  return NextResponse.json(
    { error: 'SystemPrompt feature not implemented yet' },
    { status: 501 }
  );
}

// POST /api/projects/:id/system-prompts - 创建系统提示词
export async function POST() {
  return NextResponse.json(
    { error: 'SystemPrompt feature not implemented yet' },
    { status: 501 }
  );
}
