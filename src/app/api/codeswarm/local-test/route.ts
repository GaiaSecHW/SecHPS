import { NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '@/lib/prisma';

interface LocalTestRequest {
  workspacePath: string;
  timeoutSec?: number;
}

interface ParsedVulnerabilityReport {
  projectId: string;
  evaluationId?: string;
  skillExecutionId?: string;
  vulnerabilities: Array<{
    title: string;
    type: string;
    description?: string;
    severity?: string;
    cwe?: string;
    skill?: string;
    location?: string;
    POC?: string;
    vulnerable?: boolean;
    fixSuggestion?: string;
    rawReport?: string;
  }>;
}

interface VulnerabilityApiResult {
  success: boolean;
  createdCount?: number;
  skippedCount?: number;
  error?: string;
}

const DEFAULT_INSTRUCTION = '执行 audit-report-parser skill，解析审计报告';
const VULNERABILITY_STORAGE_PATH = process.env.VULNERABILITY_STORAGE_PATH || 'Z:\\Vulnerability';

function uploadAuditReport(taskId: string, workspacePath: string): string | null {
  try {
    const auditReportPath = path.join(workspacePath, 'AUDIT_REPORT.md');
    
    if (!fs.existsSync(auditReportPath)) {
      console.log(`[LocalTest:${taskId}] No AUDIT_REPORT.md found in workspace`);
      return null;
    }
    
    const targetDir = path.join(VULNERABILITY_STORAGE_PATH, taskId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    const targetPath = path.join(targetDir, 'AUDIT_REPORT.md');
    fs.copyFileSync(auditReportPath, targetPath);
    
    console.log(`[LocalTest:${taskId}] Uploaded AUDIT_REPORT.md to ${targetPath}`);
    return targetPath;
  } catch (error) {
    console.error(`[LocalTest:${taskId}] Upload error:`, error);
    return null;
  }
}

function parseVulnerabilityReport(stdout: string): ParsedVulnerabilityReport | null {
  try {
    let jsonStr = stdout.trim();
    
    if (jsonStr.includes('```json')) {
      const match = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        jsonStr = match[1].trim();
      }
    } else if (jsonStr.includes('```')) {
      const match = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        jsonStr = match[1].trim();
      }
    }
    
    const parsed = JSON.parse(jsonStr);
    
    if (!parsed.projectId || !Array.isArray(parsed.vulnerabilities) || parsed.vulnerabilities.length === 0) {
      console.log('[LocalTest] Parsed JSON missing required fields');
      return null;
    }
    
    for (const v of parsed.vulnerabilities) {
      if (!v.title || !v.type) {
        console.log('[LocalTest] Vulnerability missing title or type');
        return null;
      }
    }
    
    return parsed as ParsedVulnerabilityReport;
  } catch (error) {
    console.error('[LocalTest] JSON parse error:', error);
    return null;
  }
}

const TEST_PROJECT_ID = 'cmnyocwar00023p518yye84cp';

async function submitVulnerabilities(
  report: ParsedVulnerabilityReport,
  filePath: string
): Promise<VulnerabilityApiResult> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    
    const requestBody = {
      projectId: TEST_PROJECT_ID,
      evaluationId: report.evaluationId || undefined,
      skillExecutionId: report.skillExecutionId || undefined,
      filePath,
      vulnerabilities: report.vulnerabilities.map(v => ({
        title: v.title,
        type: v.type,
        description: v.description || '',
        severity: v.severity || 'medium',
        cwe: v.cwe || null,
        skill: v.skill || null,
        location: v.location || null,
        POC: v.POC || null,
        vulnerable: v.vulnerable ?? true,
        fixSuggestion: v.fixSuggestion || null,
        rawReport: v.rawReport || null,
      })),
    };
    
    const response = await fetch(`${baseUrl}/api/v1/vulnerabilities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        error: errorData.error || `HTTP ${response.status}`,
      };
    }
    
    const result = await response.json();
    return {
      success: true,
      createdCount: result.summary?.created || 0,
      skippedCount: result.summary?.skipped || 0,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

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

      let uploadedFilePath: string | null = null;
      let vulnSubmitResult: VulnerabilityApiResult | null = null;
      let finalResult = stdout;

      if (success) {
        uploadedFilePath = uploadAuditReport(taskId, workspacePath);
        
        if (uploadedFilePath) {
          const report = parseVulnerabilityReport(stdout);
          
          if (report) {
            console.log(`[LocalTest:${taskId}] Parsed report: projectId=${report.projectId}, vulnCount=${report.vulnerabilities.length}`);
            
            vulnSubmitResult = await submitVulnerabilities(report, uploadedFilePath);
            
            if (vulnSubmitResult.success) {
              console.log(`[LocalTest:${taskId}] Vulnerabilities submitted: created=${vulnSubmitResult.createdCount}, skipped=${vulnSubmitResult.skippedCount}`);
              finalResult += `\n\n---\n漏洞提交成功: 创建 ${vulnSubmitResult.createdCount} 条, 跳过 ${vulnSubmitResult.skippedCount} 条`;
            } else {
              console.error(`[LocalTest:${taskId}] Vulnerabilities submit failed: ${vulnSubmitResult.error}`);
              finalResult += `\n\n---\n漏洞提交失败: ${vulnSubmitResult.error}`;
            }
          } else {
            console.log(`[LocalTest:${taskId}] Could not parse stdout as vulnerability report`);
            finalResult += '\n\n---\n警告: 无法解析漏洞报告JSON';
          }
        } else {
          console.log(`[LocalTest:${taskId}] No file uploaded, skipping vulnerability submit`);
        }
      }

      await prisma.localTestRecord.update({
        where: { taskId },
        data: {
          status: success ? 'completed' : 'failed',
          result: finalResult,
          error: exitCode !== 0 ? stderr || `Exit code: ${exitCode}` : null,
          completedAt: new Date(),
          durationMs,
          uploadedFilePath,
        },
      });

      console.log(`[LocalTest:${taskId}] Completed: exitCode=${exitCode}, stdoutLen=${stdout.length}, uploaded=${uploadedFilePath ? 'yes' : 'no'}, vulnSubmit=${vulnSubmitResult ? (vulnSubmitResult.success ? 'success' : 'failed') : 'skipped'}`);
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