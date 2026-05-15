import { NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '@/lib/prisma';

interface LocalTestRequest {
  workspacePath: string;
  timeoutSec?: number;
}

const DEFAULT_INSTRUCTION = '执行 audit-report-parser skill，解析审计报告';

export async function POST(request: Request) {
  try {
    const body: LocalTestRequest = await request.json();
    const { workspacePath, timeoutSec } = body;

    if (!workspacePath) {
      return NextResponse.json({ error: 'workspacePath is required' }, { status: 400 });
    }

    if (!fs.existsSync(workspacePath)) {
      return NextResponse.json({ error: `工作区不存在: ${workspacePath}` }, { status: 400 });
    }

    const taskId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await prisma.localTestRecord.create({
      data: {
        taskId,
        workspace: workspacePath,
        instruction: DEFAULT_INSTRUCTION,
        status: 'queued',
      },
    });

    executeTaskAsync(taskId, workspacePath, DEFAULT_INSTRUCTION, timeoutSec || 600);

    return NextResponse.json({
      taskId,
      status: 'queued',
      message: '任务已提交，后台执行中',
    });
  } catch (error) {
    console.error('[LocalTest] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      const records = await prisma.localTestRecord.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      return NextResponse.json({ records });
    }

    const record = await prisma.localTestRecord.findUnique({
      where: { taskId },
    });

    if (!record) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    }

    return NextResponse.json({ record });
  } catch (error) {
    console.error('[LocalTest] GET Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function executeTaskAsync(
  taskId: string,
  workspacePath: string,
  instruction: string,
  timeoutSec: number
): void {
  (async () => {
    let stdout = '';
    let stderr = '';
    let childProcess: ChildProcess | null = null;
    const startTime = Date.now();

    try {
      await prisma.localTestRecord.update({
        where: { taskId },
        data: { status: 'running', startedAt: new Date() },
      });

      const args: string[] = ['run', '--agent', 'build', '--print-logs', instruction];

      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
      }

      let cmd: string;
      let finalArgs: string[];

      if (process.platform === 'win32') {
        const opencodePath = process.env.APPDATA
          ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode')
          : null;

        if (opencodePath && fs.existsSync(opencodePath)) {
          cmd = process.execPath;
          finalArgs = [opencodePath, ...args];
        } else {
          cmd = 'opencode';
          finalArgs = args;
        }
      } else {
        cmd = 'opencode';
        finalArgs = args;
      }

      console.log(`[LocalTest:${taskId}] Starting: ${cmd} ${finalArgs.join(' ')}`);

      childProcess = spawn(cmd, finalArgs, {
        cwd: workspacePath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      } as any);

      childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const exitCode = await new Promise<number | null>((resolve) => {
        childProcess?.on('exit', (code) => resolve(code ?? 1));
        childProcess?.on('error', () => resolve(1));

        setTimeout(() => {
          if (childProcess && childProcess.exitCode === null) {
            childProcess.kill('SIGTERM');
            resolve(124);
          }
        }, timeoutSec * 1000);
      });

      const durationMs = Date.now() - startTime;
      const success = exitCode === 0;

      await prisma.localTestRecord.update({
        where: { taskId },
        data: {
          status: success ? 'completed' : 'failed',
          result: stdout,
          error: exitCode !== 0 ? stderr || `Exit code: ${exitCode}` : null,
          completedAt: new Date(),
          durationMs,
        },
      });

      console.log(`[LocalTest:${taskId}] Completed: exitCode=${exitCode}, stdoutLen=${stdout.length}`);
    } catch (error) {
      console.error(`[LocalTest:${taskId}] Error:`, error);

      await prisma.localTestRecord.update({
        where: { taskId },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        },
      });
    } finally {
      if (childProcess && childProcess.exitCode === null) {
        childProcess.kill('SIGTERM');
      }
    }
  })();
}