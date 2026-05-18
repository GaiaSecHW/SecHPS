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

function uploadAuditReportToStorage(taskId: string, projectPath: string): string | null {
  try {
    const auditReportPath = findAuditReportPath(projectPath);

    if (!auditReportPath) {
      console.log(`[VulnParse:${taskId}] AUDIT_REPORT.md 不存在 (根目录和 .opencode/run/ 均未找到)`);
      return null;
    }

    const targetDir = path.join(VULNERABILITY_STORAGE_PATH, taskId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetPath = path.join(targetDir, 'AUDIT_REPORT.md');
    fs.copyFileSync(auditReportPath, targetPath);

    console.log(`[VulnParse:${taskId}] 报告已上传: ${targetPath} (源: ${auditReportPath})`);
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

async function submitVulnerabilitiesDirect(
  report: ParsedVulnerabilityReport,
  filePath: string,
  taskInstanceId: string,
  codeswarmTaskId: string
): Promise<VulnerabilitySubmitResult> {
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
            ${id}, ${taskInstanceId}, NULL,
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
      } catch {
        skippedCount++;
      }
    }

    return { success: true, createdCount, skippedCount };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

const SEVERITY_MAP: Record<string, string> = {
  critical: 'critical', 严重: 'critical', critical_lower: 'critical',
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

async function createParseLog(
  taskInstanceId: string,
  level: 'info' | 'success' | 'error' | 'warn',
  message: string,
  details?: string
) {
  const id = `log-parse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await prisma.taskExecutionLog.create({
    data: {
      id,
      taskId: taskInstanceId,
      level,
      message,
      details: details || null,
      timestamp: new Date(),
    },
  });
  eventBus.emit(`task:${taskInstanceId}`, {
    type: level === 'error' ? 'error' : level === 'success' ? 'success' : 'info',
    level,
    message,
    details: details || null,
    timestamp: new Date().toISOString(),
  });
}

function executeVulnerabilityParseAsync(taskId: string, projectPath: string, taskInstanceId?: string): void {
  (async () => {
    let stdout = '';
    let stderr = '';
    let childProcess: ChildProcess | null = null;
    const startTime = Date.now();
    
    try {
      console.log(`[VulnParse:${taskId}] 开始执行 audit-report-parser`);

      if (taskInstanceId) {
        await createParseLog(taskInstanceId, 'info', '开始解析漏洞报告', '启动 audit-report-parser，读取 AUDIT_REPORT.md 并提取结构化漏洞数据');
      }

      // 读取 SKILL.md 内容注入到 instruction（opencode run 只支持内置 agent，不支持自定义 agent）
      let skillContent = '';
      try {
        const skillPath = path.join(projectPath, '.opencode', 'skills', 'audit-report-parser', 'SKILL.md');
        if (fs.existsSync(skillPath)) {
          const raw = fs.readFileSync(skillPath, 'utf-8');
          // 去掉 frontmatter
          const bodyMatch = raw.replace(/^---[\s\S]*?---\s*/, '');
          skillContent = bodyMatch.trim();
          console.log(`[VulnParse:${taskId}] 加载 SKILL.md 成功, ${skillContent.length} 字符`);
        }
      } catch {}

      // 确定报告文件的实际路径
      const reportPath = findAuditReportPath(projectPath);
      const reportRelPath = reportPath
        ? path.relative(projectPath, reportPath).replace(/\\/g, '/')
        : 'AUDIT_REPORT.md';

      const instruction = skillContent
        ? `${skillContent}\n\n现在请执行上述技能，解析 ${reportRelPath} 文件，输出结构化 JSON。`
        : `读取 ${reportRelPath}，提取所有漏洞信息为 JSON 格式，包含 title, type, description, severity, cwe, location, POC, fixSuggestion 字段。仅输出可解析的 JSON，不要额外说明。`;

      // opencode run CLI 只支持内置 agent（build/explore/general/plan），用 build 即可
      const args: string[] = ['run', '--agent', 'build', '--model', 'alibaba-cn/glm-5', instruction];
      
      const env: Record<string, string> = {
        TERM: 'dumb',
        NO_COLOR: '1',
      };
      if (process.env.NODE_ENV) env.NODE_ENV = process.env.NODE_ENV;
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
      }
      
      // Cross-platform opencode resolution (same approach as ACPClient)
      let cmd: string;
      if (isWindows) {
        const appData = process.env.APPDATA || '';
        const exePath = path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
        cmd = fs.existsSync(exePath) ? exePath : 'opencode';
      } else {
        cmd = 'opencode';
      }

      console.log(`[VulnParse:${taskId}] 执行: ${cmd} ${args.join(' ')}`);

      childProcess = spawn(cmd, args, {
        cwd: projectPath,
        env: env as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
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
        if (taskInstanceId) {
          await createParseLog(taskInstanceId, 'error', 'VulnParse 执行失败', `Exit code: ${exitCode}, 耗时: ${(durationMs / 1000).toFixed(1)}s\n${stderr?.slice(0, 500) || ''}`);
        }
        return;
      }
      
      const filePath = uploadAuditReportToStorage(taskId, projectPath) || path.join(projectPath, 'AUDIT_REPORT.md');


      const report = parseVulnerabilityJson(stdout) || parseVulnerabilityJson(stderr);
      if (!report) {
        console.log(`[VulnParse:${taskId}] 无法解析漏洞 JSON`);
        if (taskInstanceId) {
          await createParseLog(taskInstanceId, 'warn', '漏洞报告解析失败', '无法从 opencode 输出中提取结构化 JSON，请检查 AUDIT_REPORT.md 内容');
        }
        return;
      }
      
      console.log(`[VulnParse:${taskId}] 解析到 ${report.vulnerabilities.length} 条漏洞`);
      
      const effectiveTaskId = taskInstanceId || taskId;
      const result = await submitVulnerabilitiesDirect(report, filePath, effectiveTaskId, taskId);
      
      if (result.success) {
        await prisma.$executeRaw`
          UPDATE "CodeswarmTask"
          SET "reportContent" = ${`漏洞提交成功: 创建 ${result.createdCount} 条, 跳过 ${result.skippedCount} 条`},
              "updatedAt" = NOW()
          WHERE "taskId" = ${taskId}
        `;
        console.log(`[VulnParse:${taskId}] 漏洞提交成功: created=${result.createdCount}, skipped=${result.skippedCount}`);
        if (taskInstanceId) {
          const vulnSummary = report.vulnerabilities.slice(0, 5).map(v => `[${v.severity || 'medium'}] ${v.title}`).join('\n');
          await createParseLog(taskInstanceId, 'success', `漏洞入库完成：创建 ${result.createdCount} 条，跳过 ${result.skippedCount} 条`, vulnSummary);
        }
      } else {
        console.error(`[VulnParse:${taskId}] 漏洞提交失败: ${result.error}`);
        if (taskInstanceId) {
          await createParseLog(taskInstanceId, 'error', '漏洞入库失败', result.error || '未知错误');
        }
      }
      
    } catch (e) {
      console.error(`[VulnParse:${taskId}] 异常:`, e);
      if (taskInstanceId) {
        await createParseLog(taskInstanceId, 'error', 'VulnParse 异常', e instanceof Error ? e.message : String(e));
      }
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
        select: { id: true, projectPath: true },
      });

      if (taskInstanceForParse?.projectPath) {
        await createParseLog(taskInstanceForParse.id, 'info', '收到 Worker 完成回调', `codeswarmTaskId: ${taskId}，即将启动漏洞报告解析`);
        executeVulnerabilityParseAsync(taskId, taskInstanceForParse.projectPath, taskInstanceForParse.id);
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