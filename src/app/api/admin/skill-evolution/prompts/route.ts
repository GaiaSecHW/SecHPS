// src/app/api/admin/skill-evolution/prompts/route.ts
// GET - 获取所有提示词
// PUT - 更新提示词

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { 
  getAllEvolutionPrompts, 
  updateEvolutionPrompt, 
  seedEvolutionPrompts,
  type PromptKey 
} from '@/services/skill-evolution/prompt-manager';
import { hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

/**
 * GET - 获取所有 Skill 进化提示词
 */
export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  // 检查权限
  if (!hasPermission(auth.payload.permissions, PERMISSIONS.SKILL_READ)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const prompts = await getAllEvolutionPrompts();

    return NextResponse.json({
      success: true,
      prompts,
      total: prompts.length,
    });
  } catch (error) {
    console.error('[API] 获取提示词失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
      { status: 500 }
    );
  }
}

/**
 * PUT - 更新提示词
 */
export async function PUT(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  // 检查权限（需要管理员权限）
  if (!hasPermission(auth.payload.permissions, PERMISSIONS.SKILL_UPDATE)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { promptKey, content, isActive } = body;

    if (!promptKey) {
      return NextResponse.json(
        { error: '缺少 promptKey 参数' },
        { status: 400 }
      );
    }

    if (!content) {
      return NextResponse.json(
        { error: '缺少 content 参数' },
        { status: 400 }
      );
    }

    const updated = await updateEvolutionPrompt(
      promptKey as PromptKey,
      content,
      isActive ?? true
    );

    return NextResponse.json({
      success: true,
      prompt: updated,
      message: '提示词已更新',
    });
  } catch (error) {
    console.error('[API] 更新提示词失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '更新失败' },
      { status: 500 }
    );
  }
}

/**
 * POST - 初始化默认提示词（seed）
 */
export async function POST(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

// 检查权限（需要管理员权限）
    if (!hasPermission(auth.payload.permissions, PERMISSIONS.SKILL_GOVERNANCE_UPDATE)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

  try {
    const result = await seedEvolutionPrompts();

    return NextResponse.json({
      success: true,
      created: result.created,
      skipped: result.skipped,
      message: `已创建 ${result.created} 个提示词，跳过 ${result.skipped} 个已存在的`,
    });
  } catch (error) {
    console.error('[API] Seed 提示词失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Seed 失败' },
      { status: 500 }
    );
  }
}