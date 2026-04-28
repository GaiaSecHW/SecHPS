// src/app/api/skills/[id]/cases/route.ts
// GET - 获取技能评估案例

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { getCompactCases, type GetCompactCasesOptions } from '@/services/skill-evolution/case-extractor';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  const { id } = await params;

  // 解析查询参数
  const url = new URL(request.url);
  const falsePositiveLimit = url.searchParams.get('falsePositiveLimit');
  const confirmedLimit = url.searchParams.get('confirmedLimit');
  const maxDescriptionLength = url.searchParams.get('maxDescriptionLength');
  const codeSnippetLines = url.searchParams.get('codeSnippetLines');

  const options: GetCompactCasesOptions = {};
  if (falsePositiveLimit) options.falsePositiveLimit = parseInt(falsePositiveLimit, 10);
  if (confirmedLimit) options.confirmedLimit = parseInt(confirmedLimit, 10);
  if (maxDescriptionLength) options.maxDescriptionLength = parseInt(maxDescriptionLength, 10);
  if (codeSnippetLines) options.codeSnippetLines = parseInt(codeSnippetLines, 10);

  try {
    const result = await getCompactCases(id, options);

    return NextResponse.json({
      skillId: id,
      falsePositives: result.falsePositives.map(fp => ({
        vulnerabilityId: fp.vulnerabilityId,
        title: fp.title,
        description: fp.description,
        location: fp.location,
        sourceCodePreview: fp.sourceCodePreview,
        status: fp.status,
        markedAt: fp.markedAt.toISOString(),
      })),
      confirmedCases: result.confirmedCases.map(cc => ({
        vulnerabilityId: cc.vulnerabilityId,
        title: cc.title,
        description: cc.description,
        location: cc.location,
        sourceCodePreview: cc.sourceCodePreview,
        status: cc.status,
        markedAt: cc.markedAt.toISOString(),
      })),
      totalFalsePositives: result.totalFalsePositives,
      totalConfirmed: result.totalConfirmed,
      lastExtracted: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] 获取 Skill 案例失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取案例失败' },
      { status: 500 }
    );
  }
}
