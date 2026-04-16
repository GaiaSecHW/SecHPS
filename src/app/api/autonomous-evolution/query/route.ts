// src/app/api/autonomous-evolution/query/route.ts
// POST 接口 - Claude Tool 调用知识库查询

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import {
  queryRelevantExperiences,
  type ErrorContext,
} from '@/services/autonomous-evolution/experience-query-service';

export async function POST(request: Request) {
  try {
    // 1. 验证认证
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 2. 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.AUTONOMOUS_EVOLUTION_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 3. 解析请求体
    const body = await request.json();
    const { errorMessage, errorCategory, toolName } = body;

    if (!errorMessage || typeof errorMessage !== 'string') {
      return NextResponse.json(
        { error: '缺少必要参数: errorMessage' },
        { status: 400 }
      );
    }

    // 4. 调用查询服务
    const context: ErrorContext = {
      errorMessage,
      errorCategory: errorCategory || undefined,
      toolName: toolName || undefined,
    };

    const matches = await queryRelevantExperiences(context);

    // 5. 格式化返回结果
    const experiences = matches.map((match) => {
      const exp = match.experience;
      let patterns: string[] = [];
      try {
        patterns = JSON.parse(exp.errorPatterns) as string[];
      } catch {
        // ignore
      }

      return {
        id: exp.id,
        title: exp.title,
        errorCategory: exp.errorCategory,
        errorPatterns: patterns,
        directSolution: exp.directSolution,
        lesson: exp.lesson,
        hitCount: exp.hitCount,
        sourceModel: exp.sourceModel,
        relevanceScore: match.relevanceScore,
        matchedPatterns: match.matchedPatterns,
      };
    });

    // 6. 记录查询日志到 ExperienceUsageLog（source='tool_call'）
    if (experiences.length > 0) {
      const experienceIds = experiences.map((e) => e.id);
      await prisma.experienceUsageLog.createMany({
        data: experienceIds.map((expId, index) => ({
          id: `explog-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
          experienceId: expId,
          evaluationId: `tool_call_${Date.now()}`, // 使用特殊标识区分 tool_call 来源
          projectId: null,
        })),
      });

      console.log(
        `[ExperienceQueryAPI] 记录了 ${experienceIds.length} 条查询日志 (source: tool_call)`
      );
    }

    // 7. 返回结果
    return NextResponse.json({
      experiences,
      count: experiences.length,
    });
  } catch (error) {
    console.error('[ExperienceQueryAPI] 查询失败:', error);
    return NextResponse.json(
      { error: '内部服务器错误' },
      { status: 500 }
    );
  }
}