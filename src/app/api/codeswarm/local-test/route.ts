import { NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '@/lib/prisma';

interface LocalTestRequest {
  workspacePath: string;
  timeoutSec?: number;
  engine?: 'opencode' | 'claudecode';
}

interface ParsedVulnerabilityReport {
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

const LOCAL_TEST_VULN_TASK_ID = '70b14e3f-1614-407d-800b-ca2a485c5016';

const isWindows = process.platform === 'win32';

const VULNERABILITY_STORAGE_PATH = process.env.VULNERABILITY_STORAGE_PATH || (
  isWindows ? 'Z:\\Vulnerability' : '/home/icsl/hgh/Vulnerability'
);

const SEVERITY_MAP: Record<string, string> = {
  critical: 'critical', 严重: 'critical',
  high: 'high', 高危: 'high',
  medium: 'medium', 中危: 'medium', moderate: 'medium',
  low: 'low', 低危: 'low',
  info: 'info', 信息: 'info', informational: 'info',
};

function normalizeSeverity(s?: string): string {
  if (!s) return 'medium';
  const lower = s.toLowerCase().trim();
  for (const [key, val] of Object.entries(SEVERITY_MAP)) {
    if (lower === key || lower === val) return val;
  }
  return 'medium';
}

function findAuditReportPath(projectPath: string): string | null {
  const candidates = [
    path.join(projectPath, 'AUDIT_REPORT.md'),
    path.join(projectPath, '.opencode', 'run', 'AUDIT_REPORT.md'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function uploadAuditReport(taskId: string, workspacePath: string): string | null {
  try {
    const auditReportPath = findAuditReportPath(workspacePath);
    if (!auditReportPath) return null;

    const targetDir = path.join(VULNERABILITY_STORAGE_PATH, taskId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetPath = path.join(targetDir, 'AUDIT_REPORT.md');
    fs.copyFileSync(auditReportPath, targetPath);
    return targetPath;
  } catch (e) {
    console.error(`[LocalTest:${taskId}] 上传失败:`, e);
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
          if (inner.includes('vulnerabilities')) { jsonStr = inner; break; }
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
    return {
      evaluationId: parsed.evaluationId ?? '',
      skillExecutionId: parsed.skillExecutionId ?? '',
      vulnerabilities: parsed.vulnerabilities,
    };
  } catch { return null; }
}

const INSTRUCTION_PHASE1 = '执行 audit-report-parser skill 解析漏洞报告';
const INSTRUCTION_PHASE2 = '读取 AUDIT_REPORT.md，提取所有漏洞信息为 JSON 格式，包含 title, type, description, severity, cwe, location, POC, fixSuggestion 字段。仅输出可解析的 JSON，不要额外说明。';

function runOpencodeParse(
  taskId: string,
  workspacePath: string,
  timeoutSec: number,
  addLog: (level: string, message: string) => void,
  instruction: string
): Promise<ParsedVulnerabilityReport | null> {
  return new Promise((resolve) => {
    let childProcess: ChildProcess | null = null;
    const args: string[] = ['run', '--agent', 'build', instruction];
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'dumb', NO_COLOR: '1' };

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

    addLog('info', `执行: opencode run --agent build "${instruction.slice(0, 50)}..."`);

    let stdout = '';
    let stderr = '';
    childProcess = spawn(cmd, finalArgs, {
      cwd: workspacePath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });

    childProcess.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    childProcess.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    const timeoutTimer = setTimeout(() => {
      if (childProcess && childProcess.exitCode === null) {
        addLog('warn', 'opencode 执行超时，终止进程');
        childProcess.kill('SIGTERM');
        resolve(null);
      }
    }, timeoutSec * 1000);

    childProcess.on('exit', (code) => {
      clearTimeout(timeoutTimer);
      if (code === 0) {
        const report = parseVulnerabilityJson(stdout) || parseVulnerabilityJson(stderr);
        if (report) {
          addLog('success', `opencode 解析成功: ${report.vulnerabilities.length} 条漏洞`);
        } else {
          addLog('warn', 'opencode 输出 JSON 解析失败');
        }
        resolve(report);
      } else {
        addLog('error', `opencode 执行失败 (exit=${code})`);
        resolve(null);
      }
    });

    childProcess.on('error', (err) => {
      clearTimeout(timeoutTimer);
      addLog('error', `opencode 进程错误: ${err.message}`);
      resolve(null);
    });
  });
}

async function submitVulnerabilitiesDirect(
  report: ParsedVulnerabilityReport,
  filePath: string,
  taskId: string
): Promise<{ success: boolean; createdCount?: number; skippedCount?: number; error?: string }> {
  try {
    let createdCount = 0;
    let skippedCount = 0;
    const seen = new Set<string>();

    for (const v of report.vulnerabilities) {
      const key = `${v.title}||${v.type}`;
      if (seen.has(key)) { skippedCount++; continue; }
      seen.add(key);

      const id = `vuln_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const severity = normalizeSeverity(v.severity);

      try {
        await prisma.$executeRaw`
          INSERT INTO "Vulnerability" (
            id, "taskId", "projectId", title, description, type, cwe, severity,
            skill, location, "POC", vulnerable, "fixSuggestion", "rawReport",
            "filePath", status, "updatedAt"
          ) VALUES (
            ${id}, ${taskId}, NULL,
            ${v.title}, ${v.description || ''}, ${v.type},
            ${v.cwe || null}, ${severity},
            ${v.skill || null}, ${v.location || null},
            ${v.POC || null}, ${v.vulnerable ?? true},
            ${v.fixSuggestion || null}, ${v.rawReport || null},
            ${filePath}, 'new', NOW()
          )
          ON CONFLICT DO NOTHING
        `;
        createdCount++;
      } catch { skippedCount++; }
    }
    return { success: true, createdCount, skippedCount };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function POST(request: Request) {
  try {
    const body: LocalTestRequest = await request.json();
    const { workspacePath, timeoutSec, engine } = body;

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
        instruction: '解析漏洞报告',
        status: 'queued',
      },
    });

    executeTaskAsync(taskId, workspacePath, timeoutSec || 600, engine || 'opencode');

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
  timeoutSec: number,
  engine: 'opencode' | 'claudecode'
): void {
  (async () => {
    const startTime = Date.now();
    const logs: { timestamp: string; level: string; message: string }[] = [];

    const addLog = (level: string, message: string) => {
      logs.push({ timestamp: new Date().toISOString(), level, message });
    };

    const updateRecord = async (updates: Record<string, unknown>) => {
      try {
        await prisma.localTestRecord.update({ where: { taskId }, data: updates });
      } catch {}
    };

    const buildResult = () =>
      logs.map(l => `[${l.timestamp.substring(11, 19)}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');

    try {
      addLog('info', '开始执行本地测试');
      await updateRecord({ status: 'running', startedAt: new Date() });

      const reportPath = findAuditReportPath(workspacePath);
      const filePath = uploadAuditReport(taskId, workspacePath) || reportPath || path.join(workspacePath, 'AUDIT_REPORT.md');
      let report: ParsedVulnerabilityReport | null = null;

      if (reportPath && fs.existsSync(reportPath)) {
        addLog('info', `找到报告: ${path.relative(workspacePath, reportPath).replace(/\\/g, '/')}`);
      } else {
        addLog('info', '未找到 AUDIT_REPORT.md');
      }

      // Phase 1: audit-report-parser skill (通过 agent)
      addLog('info', 'Phase 1: 启动 audit-report-parser skill');
      report = await runOpencodeParse(taskId, workspacePath, timeoutSec, addLog, INSTRUCTION_PHASE1);

      // Phase 2: 通用 AI Fallback
      if (!report) {
        addLog('info', 'Phase 2: Skill 解析失败，启动通用 AI Fallback');
        report = await runOpencodeParse(taskId, workspacePath, timeoutSec, addLog, INSTRUCTION_PHASE2);
      }

      if (!report) {
        addLog('warn', '所有解析方式均失败，无法提取漏洞数据');
        await updateRecord({
          status: 'completed',
          result: buildResult(),
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        });
        return;
      }

      addLog('info', `开始入库: ${report.vulnerabilities.length} 条漏洞`);
      const result = await submitVulnerabilitiesDirect(report, filePath, LOCAL_TEST_VULN_TASK_ID);

      if (result.success) {
        const vulnSummary = report.vulnerabilities.slice(0, 5).map(v => `[${v.severity || 'medium'}] ${v.title}`).join(', ');
        addLog('success', `漏洞入库完成: 创建 ${result.createdCount} 条, 跳过 ${result.skippedCount} 条 — ${vulnSummary}`);
      } else {
        addLog('error', `漏洞入库失败: ${result.error}`);
      }

      await updateRecord({
        status: 'completed',
        result: buildResult(),
        parsedVulnerabilities: JSON.stringify(report),
        uploadedFilePath: filePath,
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      console.error(`[LocalTest:${taskId}] Error:`, error);
      addLog('error', `异常: ${error instanceof Error ? error.message : String(error)}`);
      await updateRecord({
        status: 'failed',
        result: buildResult(),
        error: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
      });
    }
  })();
}
