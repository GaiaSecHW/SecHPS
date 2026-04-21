// src/app/api/autonomous-evolution/extract/route.ts
// POST 触发提取（SSE 流式进度）

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { extractSequences } from '@/services/autonomous-evolution/log-parser';
import { isAlreadyProcessed, markProcessed, clearAllRecords } from '@/services/autonomous-evolution/log-hash-tracker';
import { generateExperience, saveExperience } from '@/services/autonomous-evolution/experience-generator';
import { recordLastAutoExtract } from '@/services/autonomous-evolution/idle-trigger';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import os from 'os';

const CLAUDE_PROJECTS_DIR = join(os.homedir(), '.claude', 'projects');

async function* findAllJsonlFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    // 目录不存在或无法读取，静默返回
    console.debug('[Extract] Cannot read directory:', dir, e);
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* findAllJsonlFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      yield fullPath;
    }
  }
}

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AUTONOMOUS_EVOLUTION_EXTRACT });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  const body = await request.json() as { mode?: 'incremental' | 'full'; maxSequences?: number };
  const mode = body.mode || 'incremental';
  const maxSequences = body.maxSequences || 20;

  if (mode === 'full') {
    await clearAllRecords();
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };

      // 创建运行记录
      const runLog = await prisma.autonomousEvolutionRunLog.create({
        data: {
          id: generateId('runlog'),
          mode,
          trigger: 'manual',
          status: 'running',
        },
      });

      try {
        send({ type: 'start', mode, runLogId: runLog.id, message: `开始${mode === 'full' ? '全量' : '增量'}提取` });

        // Collect all .jsonl files
        const allFiles: string[] = [];
        for await (const f of findAllJsonlFiles(CLAUDE_PROJECTS_DIR)) {
          allFiles.push(f);
        }

        send({ type: 'progress', scanned: 0, total: allFiles.length, skipped: 0, newFiles: 0, sequences: 0 });

        let scanned = 0;
        let skipped = 0;
        let newFiles = 0;
        let totalSequences = 0;
        let created = 0;
        let merged = 0;
        let processedSequences = 0;

        for (const filePath of allFiles) {
          scanned++;

          // Hash check
          if (mode === 'incremental' && await isAlreadyProcessed(filePath)) {
            skipped++;
            const ts = new Date().toISOString().slice(11, 19);
            send({ type: 'log', message: `[${ts}] 跳过（已处理）: ${filePath.split(/[\\/]/).slice(-2).join('/')}` });
            send({ type: 'progress', scanned, total: allFiles.length, skipped, newFiles, sequences: totalSequences });
            continue;
          }

          newFiles++;
          const ts = new Date().toISOString().slice(11, 19);
          send({ type: 'log', message: `[${ts}] 扫描: ${filePath.split(/[\\/]/).slice(-2).join('/')}` });

          let sequences;
          try {
            sequences = await extractSequences(filePath);
          } catch (err) {
            send({ type: 'log', message: `[${ts}] 解析失败: ${String(err).slice(0, 100)}` });
            continue;
          }

          if (sequences.length === 0) {
            await markProcessed(filePath, 0);
            send({ type: 'progress', scanned, total: allFiles.length, skipped, newFiles, sequences: totalSequences });
            continue;
          }

          totalSequences += sequences.length;
          send({ type: 'log', message: `[${ts}] 发现 ${sequences.length} 条失败序列` });
          send({ type: 'progress', scanned, total: allFiles.length, skipped, newFiles, sequences: totalSequences });

          for (const seq of sequences) {
            if (processedSequences >= maxSequences) break;
            processedSequences++;

            const ts2 = new Date().toISOString().slice(11, 19);
            send({ type: 'log', message: `[${ts2}] 调用大模型生成经验 (${seq.failures.length}次失败 → ${seq.success.toolName})` });

            try {
              const exp = await generateExperience(seq);
              const result = await saveExperience(exp, seq);
              if (result.action === 'created') {
                created++;
                send({ type: 'log', message: `[${ts2}] 新增经验: ${exp.title}` });
              } else {
                merged++;
                send({ type: 'log', message: `[${ts2}] 合并经验: ${exp.title} (hitCount +1)` });
              }
            } catch (err) {
              send({ type: 'log', message: `[${ts2}] 生成失败: ${String(err).slice(0, 100)}` });
            }
          }

          await markProcessed(filePath, sequences.length);

          if (processedSequences >= maxSequences) {
            send({ type: 'log', message: `已达到本次最大处理数量 (${maxSequences})，停止` });
            break;
          }
        }

        await recordLastAutoExtract();

        await prisma.autonomousEvolutionRunLog.update({
          where: { id: runLog.id },
          data: { status: 'done', scanned, skipped, newFiles, sequences: totalSequences, created, merged, finishedAt: new Date() },
        });

        send({
          type: 'done',
          scanned,
          skipped,
          newFiles,
          sequences: totalSequences,
          created,
          merged,
          message: `提取完成：新增 ${created} 条，合并 ${merged} 条`,
        });
      } catch (err) {
        await prisma.autonomousEvolutionRunLog.update({
          where: { id: runLog.id },
          data: { status: 'error', errorMessage: String(err).slice(0, 500), finishedAt: new Date() },
        }).catch((updateErr) => console.error('[Extract] Failed to update run log:', updateErr));
        send({ type: 'error', message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
