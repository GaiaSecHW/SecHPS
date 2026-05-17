import { NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';
import eventBus from '@/lib/event-bus';

const PARSE_TIMEOUT_SEC = 300;

const VULNERABILITY_STORAGE_PATH = process.env.VULNERABILITY_STORAGE_PATH || (
  process.platform === 'win32' ? 'Z:\\Vulnerability' : '/home/icsl/hgh/Vulnerability'
);

const isWindows = process.platform === 'win32';

interface ParsedVulnerabilityReport {
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

interface VulnerabilitySubmitResult {
  success: boolean;
  createdCount?: number;
  skippedCount?: number;
  error?: string;
}

function uploadAuditReportToStorage(taskId: string, projectPath: string): string | null {
  try {
    const auditReportPath = path.join(projectPath, 'AUDIT_REPORT.md');
    
    if (!fs.existsSync(auditReportPath)) {
      console.log(`[VulnParse:${taskId}] AUDIT_REPORT.md 不存在`);
      return null;
    }
    
    const targetDir = path.join(VULNERABILITY_STORAGE_PATH, taskId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    const targetPath = path.join(targetDir, 'AUDIT_REPORT.md');
    fs.copyFileSync(auditReportPath, targetPath);
    
    console.log(`[VulnParse:${taskId}] 报告已上传: ${targetPath}`);
    return targetPath;
  } catch (e) {
    console.error(`[VulnParse:${taskId}] 上传失败:`, e);
    return null;
  }
}

function parseVulnerabilityJson(output: string): ParsedVulnerabilityReport | null {
  try {
    let jsonStr = '';
    
    if (output.includes('```json')) {
      const matches = output.match(/```json\s*([\s\S]*?)\s*```/g);
      if (matches) {
        for (const match of matches) {
          const inner = match.replace(/```json\s*/, '').replace(/\s*```$/, '').trim();
          if (inner.includes('vulnerabilities')) {
            jsonStr = inner;
            break;
          }
        }
      }
    }
    
    if (!jsonStr && output.includes('"vulnerabilities"')) {
      const startIdx = output.indexOf('{');
      if (startIdx !== -1) {
        let braceCount = 0;
        let endIdx = startIdx;
        for (let i = startIdx; i < output.length; i++) {
          if (output[i] === '{') braceCount++;
          if (output[i] === '}') braceCount--;
          if (braceCount === 0) { endIdx = i + 1; break; }
        }
        jsonStr = output.slice(startIdx, endIdx);
      }
    }
    
    if (!jsonStr) return null;
    
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed.vulnerabilities) || parsed.vulnerabilities.length === 0) return null;
    
    for (const v of parsed.vulnerabilities) {
      if (!v.title || !v.type) return null;
    }
    
    return { vulnerabilities: parsed.vulnerabilities };
  } catch (e) {
    console.error('[VulnParse] JSON 解析失败:', e);
    return null;
  }
}

async function submitVulnerabilitiesToApi(
  report: ParsedVulnerabilityReport,
  filePath: string,
  taskId: string
): Promise<VulnerabilitySubmitResult> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/v1/vulnerabilities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        projectId: '',
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
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, error: errorData.error || `HTTP ${response.status}` };
    }
    
    const result = await response.json();
    return {
      success: true,
      createdCount: result.summary?.created || 0,
      skippedCount: result.summary?.skipped || 0,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

function executeVulnerabilityParseAsync(taskId: string, projectPath: string): void {
  (async () => {
    let stdout = '';
    let stderr = '';
    let childProcess: ChildProcess | null = null;
    const startTime = Date.now();
    
    try {
      console.log(`[VulnParse:${taskId}] 开始执行 audit-report-parser skill`);
      
      const instruction = '执行 audit-report-parser skill，解析审计报告';
      const args: string[] = ['run', '--agent', 'build', instruction];
      
      const env: Record<string, string> = {
        TERM: 'dumb',
        NO_COLOR: '1',
      };
      if (process.env.NODE_ENV) env.NODE_ENV = process.env.NODE_ENV;
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
      }
      
      let cmd: string;
      let finalArgs: string[];
      let useShell = false;
      
      if (isWindows) {
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
        useShell = true;
      } else {
        cmd = 'bash';
        finalArgs = ['-c', `opencode run --agent build "${instruction}"`];
      }
      
      console.log(`[VulnParse:${taskId}] 执行: ${cmd} ${finalArgs.join(' ')}`);
      
      childProcess = spawn(cmd, finalArgs, {
        cwd: projectPath,
        env: env as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
      });
      
      childProcess.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      childProcess.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
      
      const exitCode = await new Promise<number | null>((resolve) => {
        childProcess?.on('exit', (code) => resolve(code ?? 1));
        childProcess?.on('error', () => resolve(1));
        
        setTimeout(() => {
          if (childProcess && childProcess.exitCode === null) {
            console.log(`[VulnParse:${taskId}] 超时终止`);
            childProcess.kill('SIGTERM');
            resolve(124);
          }
        }, PARSE_TIMEOUT_SEC * 1000);
      });
      
      const durationMs = Date.now() - startTime;
      const success = exitCode === 0;
      
      console.log(`[VulnParse:${taskId}] 执行完成: exitCode=${exitCode}, duration=${durationMs}ms`);
      
      if (!success) {
        console.error(`[VulnParse:${taskId}] 执行失败: ${stderr || `Exit code: ${exitCode}`}`);
        return;
      }
      
      const filePath = uploadAuditReportToStorage(taskId, projectPath);
      if (!filePath) return;
      
      const report = parseVulnerabilityJson(stdout) || parseVulnerabilityJson(stderr);
      if (!report) {
        console.log(`[VulnParse:${taskId}] 无法解析漏洞 JSON`);
        return;
      }
      
      console.log(`[VulnParse:${taskId}] 解析到 ${report.vulnerabilities.length} 条漏洞`);
      
      const result = await submitVulnerabilitiesToApi(report, filePath, taskId);
      
      if (result.success) {
        await prisma.codeswarmTask.update({
          where: { taskId },
          data: {
            reportContent: `漏洞提交成功: 创建 ${result.createdCount} 条, 跳过 ${result.skippedCount} 条`,
          },
        });
        console.log(`[VulnParse:${taskId}] 漏洞提交成功: created=${result.createdCount}, skipped=${result.skippedCount}`);
      } else {
        console.error(`[VulnParse:${taskId}] 漏洞提交失败: ${result.error}`);
      }
      
    } catch (e) {
      console.error(`[VulnParse:${taskId}] 异常:`, e);
    } finally {
      if (childProcess && childProcess.exitCode === null) {
        childProcess.kill('SIGTERM');
      }
    }
  })();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, nodeId, status, result, error, reportContent } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const finalState = status === 'completed' ? 'completed' : 'failed';

    await prisma.$executeRaw`
      UPDATE "CodeswarmTask"
      SET state = ${finalState},
          result = ${result || null},
          error = ${error || null},
          "reportContent" = ${reportContent || null},
          "completedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE "taskId" = ${taskId}
    `;

    const taskInstance = await prisma.taskInstance.findFirst({
      where: { codeswarmTaskId: taskId },
      select: { id: true },
    });

    if (taskInstance) {
      await prisma.taskInstance.update({
        where: { id: taskInstance.id },
        data: {
          status: finalState,
          completedAt: new Date(),
          updatedAt: new Date(),
          errorMessage: error || null,
          executionResult: result || null,
          reportPath: reportContent || null,
        },
      });

      await prisma.taskExecutionLog.create({
        data: {
          id: `log-${Date.now()}-complete`,
          taskId: taskInstance.id,
          level: finalState === 'completed' ? 'success' : 'error',
          message: finalState === 'completed' ? '任务执行完成' : '任务执行失败',
          details: error || '所有步骤已完成',
          timestamp: new Date(),
        },
      });

      eventBus.emit(`task:${taskInstance.id}`, {
        type: finalState,
        level: finalState === 'completed' ? 'success' : 'error',
        message: finalState === 'completed' ? '任务执行完成' : '任务执行失败',
        details: error || '所有步骤已完成',
        timestamp: new Date().toISOString(),
      });
    }

    // Worker 槽位释放：内存和 DB 同步递减（幂等性检查）
    // onTaskCompleted 内部处理内存递减 + DB 条件更新
    if (nodeId) {
      await codeswarmDispatcher.onTaskCompleted(nodeId);
    }

    await codeswarmDispatcher.publishTaskEvent(taskId, {
      type: 'task_completed',
      status: finalState,
    });

    if (finalState === 'completed') {
      const taskInstanceForParse = await prisma.taskInstance.findFirst({
        where: { codeswarmTaskId: taskId },
        select: { projectPath: true },
      });
      
      if (taskInstanceForParse?.projectPath) {
        executeVulnerabilityParseAsync(taskId, taskInstanceForParse.projectPath);
      }
    }

    return NextResponse.json({ success: true, taskId, status: finalState });
  } catch (error) {
    console.error('[CodeSwarm] Result callback error:', error);
    return NextResponse.json(
      { error: 'Failed to record result' },
      { status: 500 }
    );
  }
}