import { NextRequest, NextResponse } from 'next/server';
import { badRequest, notFound, internalError } from '@/lib/api-errors';
import { prisma } from '@/lib/prisma';
import { normalizeSeverity, generateVulnerabilityId } from '@/lib/vulnerability/parser';
import { logger, LOG_MODULES } from '@/lib/logger';

const MAX_VULNERABILITIES_PER_REQUEST = 100;

export async function POST(request: NextRequest) {
  // 1. 解析请求体（认证由外部防火墙处理）
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { taskId, evaluationId, skillExecutionId, filePath, vulnerabilities } =
    body as Record<string, unknown>;

  // 2. 基本校验
  if (!taskId || typeof taskId !== 'string') return badRequest('taskId is required');
  if (!filePath || typeof filePath !== 'string') return badRequest('filePath is required');
  if (!Array.isArray(vulnerabilities) || vulnerabilities.length === 0) {
    return badRequest('vulnerabilities must be a non-empty array');
  }
  if (vulnerabilities.length > MAX_VULNERABILITIES_PER_REQUEST) {
    return badRequest(`vulnerabilities array exceeds maximum of ${MAX_VULNERABILITIES_PER_REQUEST}`);
  }

  // 3. 验证每条漏洞必填字段
  for (let i = 0; i < vulnerabilities.length; i++) {
    const v = vulnerabilities[i] as Record<string, unknown>;
    if (!v.title || !v.type) {
      return badRequest(`vulnerabilities[${i}]: title and type are required`);
    }
  }

  try {
    // 4. 验证任务存在
    const task = await prisma.taskInstance.findUnique({
      where: { id: taskId },
      select: { id: true },
    });
    if (!task) return notFound('Task not found');

    // 5. 验证 evaluationId 归属（必须属于当前 taskId 关联的 project）
    if (evaluationId && typeof evaluationId === 'string' && evaluationId.trim()) {
      const evalSession = await prisma.evaluationSession.findUnique({
        where: { id: evaluationId },
        select: { projectId: true },
      });
      if (!evalSession) return badRequest('evaluationId not found');
    }

    // 6. 验证 skillExecutionId 存在
    if (skillExecutionId && typeof skillExecutionId === 'string' && skillExecutionId.trim()) {
      const skillExec = await prisma.skillExecution.findUnique({
        where: { id: skillExecutionId },
        select: { id: true },
      });
      if (!skillExec) return badRequest('skillExecutionId not found');
    }

    // 7. 请求内自去重，构建 batchData
    const created: Array<{ id: string; title: string; type: string; severity: string }> = [];
    const skipped: Array<{ title: string; type: string; reason: string }> = [];
    const batchData: Array<{
      id: string;
      taskId: string;
      projectId: string | null;
      evaluationId: string | null;
      skillExecutionId: string | null;
      title: string;
      description: string;
      type: string;
      cwe: string | null;
      severity: string;
      skill: string | null;
      location: string | null;
      POC: string | null;
      vulnerable: boolean;
      fixSuggestion: string | null;
      rawReport: string | null;
      filePath: string | null;
      status: string;
      updatedAt: Date;
    }> = [];
    const seenInBatch = new Set<string>();

    for (const item of vulnerabilities) {
      const vuln = item as Record<string, unknown>;
      const title = vuln.title as string;
      const type = vuln.type as string;
      const key = `${title}||${type}`;

      if (seenInBatch.has(key)) {
        skipped.push({ title, type, reason: 'duplicate_in_batch' });
        continue;
      }
      seenInBatch.add(key);

      const id = generateVulnerabilityId();
      const severity = normalizeSeverity(vuln.severity as string | undefined);
      batchData.push({
        id,
        taskId: taskId as string,
        projectId: (body as Record<string, unknown>).projectId as string || null,
        evaluationId: (evaluationId as string) || null,
        skillExecutionId: (skillExecutionId as string) || null,
        title,
        description: (vuln.description as string) || '',
        type,
        cwe: (vuln.cwe as string) || null,
        severity,
        skill: (vuln.skill as string) || null,
        location: (vuln.location as string) || null,
        POC: (vuln.POC as string) || null,
        vulnerable: (vuln.vulnerable as boolean) ?? true,
        fixSuggestion: (vuln.fixSuggestion as string) || null,
        rawReport: (vuln.rawReport as string) || null,
        filePath: (filePath as string) || null,
        status: 'new',
        updatedAt: new Date(),
      });
      created.push({ id, title, type, severity });
    }

    // 8. 原子批量写入，skipDuplicates 由数据库唯一约束兜底并发场景
    let writeCount = 0;
    if (batchData.length > 0) {
      const result = await prisma.vulnerability.createMany({
        data: batchData,
        skipDuplicates: true,
      });
      writeCount = result.count;
      if (writeCount < batchData.length) {
        const dbSkipped = batchData.length - writeCount;
        const dbSkippedItems = created.splice(created.length - dbSkipped, dbSkipped);
        for (const item of dbSkippedItems) {
          skipped.push({ title: item.title, type: item.type, reason: 'duplicate' });
        }
      }
    }

    // 9. 返回结果
    return NextResponse.json({
      created,
      skipped,
      summary: {
        total: vulnerabilities.length,
        created: created.length,
        skipped: skipped.length,
      },
    }, { status: 201 });

  } catch (error) {
    logger.error(LOG_MODULES.CODE, 'Vulnerability batch creation failed', { details: { error: error instanceof Error ? error.message : String(error) } });
    return internalError('Vulnerability batch creation failed');
  }
}
