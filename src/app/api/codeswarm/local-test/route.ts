import { NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '@/lib/prisma';
import { findReportFolder, uploadReportFolder, processVulnerabilityRawReports } from '@/lib/minio-vulnerability';

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

const LOCAL_TEST_VULN_TASK_ID = '19190d8a-286c-49a4-ad65-494153ef218b';

async function getTaskContext(taskId: string): Promise<{ productName: string; taskName: string }> {
  const taskInstance = await prisma.taskInstance.findUnique({
    where: { id: taskId },
    select: { name: true, targetProduct: true, codeswarmTaskId: true },
  });

  if (!taskInstance) {
    return { productName: 'default', taskName: 'local-test' };
  }

  let productName = taskInstance.targetProduct;

  if (!productName && taskInstance.codeswarmTaskId) {
    const codeswarmTask = await prisma.codeswarmTask.findUnique({
      where: { taskId: taskInstance.codeswarmTaskId },
      select: { targetProduct: true },
    });
    productName = codeswarmTask?.targetProduct || 'default';
  }

  if (!productName) {
    productName = 'default';
  }

  const taskName = taskInstance.name || 'local-test';

  return { productName, taskName };
}

const isWindows = process.platform === 'win32';

function parseVulnerabilityJson(output: string): ParsedVulnerabilityReport | null {
  try {
    let jsonStr = '';
    if (output.includes('```json')) {
      const matches = output.match(/```json\s*([\s\S]*?)\s*```/g);
      if (matches) {
        for (const match of matches) {
          const inner = match.replace(/```json\s*/, '').replace(/\s*```$/, '').trim();
          if (inner.includes('vulnerabilities')) {
            try { JSON.parse(inner); jsonStr = inner; break; } catch { continue; }
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
    return {
      evaluationId: parsed.evaluationId ?? '',
      skillExecutionId: parsed.skillExecutionId ?? '',
      vulnerabilities: parsed.vulnerabilities,
    };
  } catch { return null; }
}

const INSTRUCTION_PHASE1 = '执行 audit-report-parser skill 解析漏洞报告';
const INSTRUCTION_PHASE2 = '读取 Report 文件夹内的报告文件，提取所有漏洞信息为 JSON 格式，包含 title, type, description, severity, cwe, location, POC, fixSuggestion 字段。仅输出可解析的 JSON，不要额外说明。';

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

      const { productName, taskName } = await getTaskContext(LOCAL_TEST_VULN_TASK_ID);
      addLog('info', `获取任务上下文: productName=${productName}, taskName=${taskName}`);

      const reportFolder = findReportFolder(workspacePath);
      let filePath: string = '';
      let report: ParsedVulnerabilityReport | null = null;

      if (reportFolder) {
        addLog('info', `找到 Report 文件夹: ${path.relative(workspacePath, reportFolder).replace(/\\/g, '/')}`);
        
        addLog('info', `上传 Report 文件到 MinIO (${productName}/${taskName}/report)...`);
        const uploadResult = await uploadReportFolder(LOCAL_TEST_VULN_TASK_ID, reportFolder, productName, taskName);
        
        if (uploadResult.success) {
          filePath = JSON.stringify(uploadResult.urls);
          addLog('success', `MinIO 上传成功: ${uploadResult.files.length} 个文件`);
          for (const file of uploadResult.files) {
            addLog('info', `  - ${file}`);
          }
        } else {
          addLog('error', `MinIO 上传失败: ${uploadResult.error}`);
          filePath = reportFolder;
        }
      } else {
        addLog('warn', '未找到 Report 文件夹');
        filePath = workspacePath;
      }

      addLog('info', 'Phase 1: 启动 audit-report-parser skill');
      report = await runOpencodeParse(taskId, workspacePath, timeoutSec, addLog, INSTRUCTION_PHASE1);

      if (!report) {
        addLog('info', 'Phase 2: Skill 解析失败，启动通用 AI Fallback');
        report = await runOpencodeParse(taskId, workspacePath, timeoutSec, addLog, INSTRUCTION_PHASE2);
      }

      if (!report) {
        addLog('warn', '所有解析方式均失败，无法提取漏洞数据');
        await updateRecord({
          status: 'completed',
          result: buildResult(),
          uploadedFilePath: filePath,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        });
        return;
      }

      addLog('info', `上传漏洞原始文件到 MinIO (${productName}/${taskName}/file)...`);
      const vulnsWithRawReports = report.vulnerabilities.filter(v => v.rawReport && v.rawReport.trim());
      if (vulnsWithRawReports.length > 0) {
        report.vulnerabilities = await processVulnerabilityRawReports(LOCAL_TEST_VULN_TASK_ID, report.vulnerabilities, productName, taskName);
        const uploadedCount = report.vulnerabilities.filter(v => v.rawReport && v.rawReport.includes('http')).length;
        addLog('success', `漏洞原始文件上传完成: ${uploadedCount} 个文件已上传`);
      } else {
        addLog('info', '无漏洞原始文件需要上传');
      }

      addLog('info', `调用 /api/v1/vulnerabilities 入库: ${report.vulnerabilities.length} 条漏洞`);
      
      const vulnRequestBody = {
        taskId: LOCAL_TEST_VULN_TASK_ID,
        filePath,
        vulnerabilities: report.vulnerabilities,
      };

      const vulnRes = await fetch(`http://localhost:${process.env.PORT || 8090}/api/v1/vulnerabilities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vulnRequestBody),
      });

      const vulnResult = await vulnRes.json();

      if (vulnRes.ok && vulnResult.summary) {
        const vulnSummary = report.vulnerabilities.slice(0, 5).map(v => `[${v.severity || 'medium'}] ${v.title}`).join(', ');
        addLog('success', `漏洞入库完成: 创建 ${vulnResult.summary.created} 条, 跳过 ${vulnResult.summary.skipped} 条 — ${vulnSummary}`);
      } else {
        addLog('error', `漏洞入库失败: ${vulnResult.error || '未知错误'}`);
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