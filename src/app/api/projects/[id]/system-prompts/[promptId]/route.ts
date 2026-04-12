import { NextResponse } from 'next/server';

/**
 * 系统提示词 API - 暂未实现
 * SystemPrompt 模型尚未在数据库中定义
 */

// GET /api/projects/:id/system-prompts/:promptId - 获取单个系统提示词
export async function GET() {
  return NextResponse.json(
    { error: 'SystemPrompt feature not implemented yet' },
    { status: 501 }
  );
}

// PUT /api/projects/:id/system-prompts/:promptId - 更新系统提示词
export async function PUT() {
  return NextResponse.json(
    { error: 'SystemPrompt feature not implemented yet' },
    { status: 501 }
  );
}

// DELETE /api/projects/:id/system-prompts/:promptId - 删除系统提示词
export async function DELETE() {
  return NextResponse.json(
    { error: 'SystemPrompt feature not implemented yet' },
    { status: 501 }
  );
}
