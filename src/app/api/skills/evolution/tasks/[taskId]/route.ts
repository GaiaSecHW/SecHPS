// src/app/api/skills/evolution/tasks/[taskId]/route.ts
// GET - 获取单个进化任务详情

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { getTaskDetail } from '@/services/skill-evolution/task-manager';
import { compareEvolutionEffect } from '@/services/skill-evolution/effect-comparator';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const { taskId } = await params;

    // 获取任务详情
    const taskDetail = await getTaskDetail(taskId);

    if (!taskDetail) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    const { task, skill, improvement } = taskDetail;

    // 解析 analysisResult JSON
    let analysisResult = null;
    if (task.analysisResult) {
      try {
        analysisResult = JSON.parse(task.analysisResult);
      } catch {
        // ignore parse error
      }
    }

    // 如果任务已完成且有新版本，获取对比数据
    let comparisonResult = null;
    if (task.status === 'completed' && task.newVersionId && improvement) {
      try {
        // 使用旧版本（当前skill）和新版本进行对比
        comparisonResult = await compareEvolutionEffect(
          skill.id, // 旧版本 skill ID
          task.newVersionId // 新版本 skill ID
        );
      } catch (error) {
        console.warn(`[TaskDetailAPI] Failed to compare evolution effect:`, error);
        // 对比失败不影响返回任务详情
      }
    }

    return NextResponse.json({
      task: {
        id: task.id,
        skillId: task.skillId,
        triggerReason: task.triggerReason,
        falsePositiveCount: task.falsePositiveCount,
        confirmedCount: task.confirmedCount,
        precisionBefore: task.precisionBefore,
        precisionAfter: task.precisionAfter,
        recallAfter: task.recallAfter,
        status: task.status,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        newVersionId: task.newVersionId,
        improvementId: task.improvementId,
        analysisResult,
      },
      skill: {
        id: skill.id,
        name: skill.name,
        displayName: skill.displayName,
        content: skill.content,
      },
      improvement: improvement ? {
        id: improvement.id,
        skillId: improvement.skillId,
        taskId: improvement.taskId,
        improvedContent: improvement.improvedContent,
        status: improvement.status,
        createdAt: improvement.createdAt,
      } : null,
      comparison: comparisonResult,
    });
  } catch (error) {
    console.error('[TaskDetailAPI] Error fetching task detail:', error);
    return NextResponse.json(
      { error: 'Failed to fetch task detail' },
      { status: 500 }
    );
  }
}