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
    return { vulnerabilities: parsed.vulnerabilities };
  } catch { return null; }
}

function parseVulnerabilityFromMarkdown(md: string): ParsedVulnerabilityReport | null {
  try {
    const vulnPattern = /^###\s+[^\s]*\s*\[([^\]]+)\]\s*(.+)$/gm;
    const sections: Array<{ id: string; title: string; start: number }> = [];
    let match;
    while ((match = vulnPattern.exec(md)) !== null) {
      sections.push({ id: match[1], title: match[2].trim(), start: match.index });
    }
    if (sections.length === 0) return null;

    const vulnerabilities = [];
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const body = md.slice(sec.start, i + 1 < sections.length ? sections[i + 1].start : md.length);
      const severityMatch = body.match(/\*\*严重度\*\*:\s*(CRITICAL|HIGH|MEDIUM|LOW|INFO|严重|高危|中危|低危|信息)/i);
      const cweMatch = body.match(/\*\*CWE\*\*:\s*(CWE-\d+)/i);
      const descMatch = body.match(/####\s*漏洞概述\s*\n([\s\S]*?)(?=\n####|\n---|$)/);
      vulnerabilities.push({
        title: sec.title,
        type: cweMatch?.[1] || sec.id,
        description: descMatch?.[1]?.trim() || sec.title,
        severity: severityMatch?.[1] || 'medium',
        cwe: cweMatch?.[1]?.replace('CWE-', '') || undefined,
      });
    }
    return vulnerabilities.length > 0 ? { vulnerabilities } : null;
  } catch { return null; }
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
        instruction: '解析漏洞报告',
        status: 'queued',
      },
    });

    executeTaskAsync(taskId, workspacePath, timeoutSec || 600);

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
  timeoutSec: number
): void {
  (async () => {
    let childProcess: ChildProcess | null = null;
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

      // Phase 1: 直接解析 AUDIT_REPORT.md（快速路径，秒级完成）
      const reportPath = findAuditReportPath(workspacePath);
      const filePath = uploadAuditReport(taskId, workspacePath) || reportPath || path.join(workspacePath, 'AUDIT_REPORT.md');
      let report: ParsedVulnerabilityReport | null = null;

      if (reportPath && fs.existsSync(reportPath)) {
        addLog('info', `找到报告: ${path.relative(workspacePath, reportPath).replace(/\\/g, '/')}`);
        const mdContent = fs.readFileSync(reportPath, 'utf-8');
        report = parseVulnerabilityFromMarkdown(mdContent);
        if (report) {
          addLog('success', `Markdown 直接解析成功，提取 ${report.vulnerabilities.length} 条漏洞`);
        } else {
          addLog('info', 'Markdown 直接解析未命中，启动 AI 解析');
        }
      } else {
        addLog('info', '未找到 AUDIT_REPORT.md，启动 opencode 生成报告');
      }

      // Phase 2: Fallback — opencode 子进程
      if (!report) {
        const instruction = '执行审计分析，生成 AUDIT_REPORT.md，包含所有发现的漏洞。输出结构化 JSON，包含 title, type, description, severity, cwe, location, POC, fixSuggestion 字段。';
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

        addLog('info', `执行: opencode run --agent build`);

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

        if (exitCode !== 0) {
          addLog('error', `opencode 执行失败 (exit=${exitCode}): ${(stderr || '').slice(0, 300)}`);
          await updateRecord({
            status: 'failed',
            result: buildResult(),
            error: `Exit code: ${exitCode}`,
            completedAt: new Date(),
            durationMs: Date.now() - startTime,
          });
          return;
        }

        addLog('success', `opencode 执行完成，耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

        report = parseVulnerabilityJson(stdout) || parseVulnerabilityJson(stderr);

        if (!report) {
          addLog('info', 'JSON 解析失败，尝试解析 AUDIT_REPORT.md');
          const freshReportPath = findAuditReportPath(workspacePath);
          if (freshReportPath && fs.existsSync(freshReportPath)) {
            const mdContent = fs.readFileSync(freshReportPath, 'utf-8');
            report = parseVulnerabilityFromMarkdown(mdContent);
            if (report) {
              addLog('success', `Markdown 解析成功: ${report.vulnerabilities.length} 条漏洞`);
            }
          }
        }
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
      const result = await submitVulnerabilitiesDirect(report, filePath, taskId);

      if (result.success) {
        const vulnSummary = report.vulnerabilities.slice(0, 5).map(v => `[${v.severity || 'medium'}] ${v.title}`).join(', ');
        addLog('success', `漏洞入库完成: 创建 ${result.createdCount} 条, 跳过 ${result.skippedCount} 条 — ${vulnSummary}`);
      } else {
        addLog('error', `漏洞入库失败: ${result.error}`);
      }

      await updateRecord({
        status: 'completed',
        result: buildResult(),
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
    } finally {
      if (childProcess && childProcess.exitCode === null) {
        childProcess.kill('SIGTERM');
      }
    }
  })();
}
