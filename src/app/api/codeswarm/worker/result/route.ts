import { NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';
import eventBus from '@/lib/event-bus';
import { findReportFolder, uploadReportFolder, processVulnerabilityRawReports } from '@/lib/minio-vulnerability';

const PARSE_TIMEOUT_SEC = 3600;

const INSTRUCTION_PHASE1 = '执行 audit-report-parser skill 解析漏洞报告';
const INSTRUCTION_PHASE2 = '读取 Report 文件夹内的报告文件，提取所有漏洞信息为 JSON 格式，包含 title, type, description, severity, cwe, location, POC, fixSuggestion, rawReport 字段。仅输出可解析的 JSON，不要额外说明。';

const isWindows = process.platform === 'win32';

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

function parseVulnerabilityJson(output: string): ParsedVulnerabilityReport | null {
  try {
    let jsonStr = '';
    console.log(`[VulnParse] parseVulnerabilityJson 输出长度: ${output.length}, 前200字符: ${output.substring(0, 200)}`);

    if (output.includes('```json')) {
      const matches = output.match(/```json\s*([\s\S]*?)\s*```/g);
      if (matches) {

        for (const match of matches) {
          const inner = match.replace(/```json\s*/, '').replace(/\s*```$/, '').trim();
          if (inner.includes('vulnerabilities')) {
try {
              JSON.parse(inner);
              jsonStr = inner;

              break;
            } catch {
              continue;
            }
          }
        }
      } else {
// ```json 块正则无匹配
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
        console.log(`[VulnParse] 从 vulnerabilities 关键词提取 JSON, 长度: ${jsonStr.length}, 起始位置: ${startIdx}`);
      }
    }

    if (!jsonStr) {
      console.log(`[VulnParse] 未提取到 JSON 字符串, 输出不含 \`\`\`json 或 "vulnerabilities"`);
      return null;
    }

    // Try direct parse first; if it fails, attempt common JSON repairs
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      // Repair 0: remove trailing commas (most common LLM JSON error)
      if (!parsed) {
        const noTrailingCommas = jsonStr.replace(/,(\s*[}\]])/g, '$1');
        try { parsed = JSON.parse(noTrailingCommas); } catch { /* continue */ }
        if (parsed) { console.log('[VulnParse] JSON repaired by removing trailing commas'); }
      }
      // Repair 1: remove trailing content after last closing brace
      const lastBrace = jsonStr.lastIndexOf('}');
      if (lastBrace > 0 && lastBrace < jsonStr.length - 1) {
        const trimmed = jsonStr.slice(0, lastBrace + 1);
        try { parsed = JSON.parse(trimmed); } catch { /* continue */ }
        if (parsed) { console.log('[VulnParse] JSON repaired by trimming trailing content'); }
      }
      // Repair 2: escape unescaped control characters (newlines, tabs inside string values)
      if (!parsed) {
        const repaired = jsonStr.replace(/[\x00-\x1f]/g, (ch) => {
          if (ch === '\n') return '\\n';
          if (ch === '\r') return '\\r';
          if (ch === '\t') return '\\t';
          return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
        });
        try { parsed = JSON.parse(repaired); } catch { /* continue */ }
        if (parsed) { console.log('[VulnParse] JSON repaired by escaping control characters'); }
      }
      // Repair 3: remove markdown bold/italic markers inside JSON values (**text**)
      if (!parsed) {
        const cleaned = jsonStr.replace(/\*{1,2}(.*?)\*{1,2}/g, '$1');
        try { parsed = JSON.parse(cleaned); } catch { /* final failure */ }
        if (parsed) { console.log('[VulnParse] JSON repaired by removing markdown bold markers'); }
      }
      if (!parsed) {
        console.error('[VulnParse] JSON 解析失败 (all repairs exhausted):', parseErr instanceof Error ? parseErr.message : String(parseErr));
        return null;
      }
    }
    if (!Array.isArray(parsed.vulnerabilities) || parsed.vulnerabilities.length === 0) {
      console.log(`[VulnParse] JSON 解析成功但 vulnerabilities 为空或非数组: ${JSON.stringify(parsed).substring(0, 200)}`);
      return null;
    }

    for (const v of parsed.vulnerabilities) {
      if (!v.title || !v.type) {
        console.log(`[VulnParse] 漏洞条目缺少 title/type: ${JSON.stringify(v).substring(0, 200)}`);
        return null;
      }
    }

    console.log(`[VulnParse] 解析成功: ${parsed.vulnerabilities.length} 条漏洞, evaluationId=${parsed.evaluationId || '无'}`);
    return {
      evaluationId: parsed.evaluationId ?? '',
      skillExecutionId: parsed.skillExecutionId ?? '',
      vulnerabilities: parsed.vulnerabilities,
    };
  } catch (e) {
    console.error('[VulnParse] JSON 解析失败:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function runOpencodeParse(taskId: string, projectPath: string, instruction: string): Promise<ParsedVulnerabilityReport | null> {
  let childProcess: ChildProcess | null = null;

  try {
    const args: string[] = ['run', instruction];

    const env: Record<string, string> = { TERM: 'dumb', NO_COLOR: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1' };
    if (process.env.NODE_ENV) env.NODE_ENV = process.env.NODE_ENV;
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }

    let cmd: string;
    let finalArgs: string[];
    let useShell = false;

    if (isWindows) {
      const appData = process.env.APPDATA || '';
      const exePath = path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
      cmd = fs.existsSync(exePath) ? exePath : 'opencode';
      finalArgs = args;
      useShell = true;
    } else {
      cmd = 'bash';
      finalArgs = ['-c', `opencode run "${instruction}"`];
    }

    console.log(`[VulnParse:${taskId}] 执行: cmd=${cmd}, args=${isWindows ? finalArgs.join(' ') : finalArgs[1]?.substring(0, 80)}`);

    let stdout = '';
    let stderr = '';

    childProcess = spawn(cmd, finalArgs, {
      cwd: projectPath,
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });

    childProcess.on('spawn', () => {
      console.log(`[VulnParse:${taskId}] 进程已启动, pid=${childProcess?.pid}`);
    });

    childProcess.on('error', (err) => {
      console.error(`[VulnParse:${taskId}] 进程启动错误: ${err.message}`);
    });

    childProcess.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    childProcess.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    const exitCode = await new Promise<number | null>((resolve) => {
      childProcess?.on('exit', (code) => {
        console.log(`[VulnParse:${taskId}] 进程退出, code=${code}, stdout长度=${stdout.length}, stderr长度=${stderr.length}`);
        resolve(code ?? 1);
      });
      childProcess?.on('error', () => {
        console.error(`[VulnParse:${taskId}] 进程 error 事件, stderr=${stderr.substring(0, 200)}`);
        resolve(1);
      });

      setTimeout(() => {
        if (childProcess && childProcess.exitCode === null) {
          console.log(`[VulnParse:${taskId}] 执行超时终止 (已收集 stdout=${stdout.length}, stderr=${stderr.length})`);
          childProcess.kill('SIGTERM');
          resolve(124);
        }
      }, PARSE_TIMEOUT_SEC * 1000);
    });

    if (exitCode !== 0) {
      console.error(`[VulnParse:${taskId}] 执行失败: exit=${exitCode}, stderr=${stderr.substring(0, 500)}`);
      return null;
    }

    console.log(`[VulnParse:${taskId}] 执行成功: stdout长度=${stdout.length}, stderr长度=${stderr.length}`);
    console.log(`[VulnParse:${taskId}] stdout预览: ${stdout.substring(0, 300)}`);
    console.log(`[VulnParse:${taskId}] stderr预览: ${stderr.substring(0, 300)}`);

    const report = parseVulnerabilityJson(stdout) || parseVulnerabilityJson(stderr);
    if (report) {
      console.log(`[VulnParse:${taskId}] 解析成功: ${report.vulnerabilities.length} 条漏洞`);
    } else {
      console.log(`[VulnParse:${taskId}] 解析失败: stdout和stderr均未提取到有效漏洞 JSON`);
    }
    return report;
  } finally {
    if (childProcess && childProcess.exitCode === null) {
      childProcess.kill('SIGTERM');
    }
  }
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

interface ParseContext {
  productName: string;
  taskName: string;
}

function executeVulnerabilityParseAsync(
  taskId: string,
  projectPath: string,
  taskInstanceId: string,
  context: ParseContext
): void {
  (async () => {
    const startTime = Date.now();
    const { productName, taskName } = context;

    try {
      console.log(`[VulnParse:${taskId}] 开始解析漏洞报告 (productName=${productName}, taskName=${taskName})`);

      await createParseLog(taskInstanceId, 'info', '开始解析漏洞报告', `产品: ${productName}, 任务: ${taskName}`);

      let filePath: string = projectPath;

      const reportFolder = findReportFolder(projectPath);
      if (reportFolder) {
        console.log(`[VulnParse:${taskId}] 找到 Report 文件夹: ${path.relative(projectPath, reportFolder).replace(/\\/g, '/')}`);

        await createParseLog(taskInstanceId, 'info', '找到 Report 文件夹', `上传报告文件到 MinIO (${productName}/${taskName}/report)`);

        console.log(`[VulnParse:${taskId}] 上传 Report 文件到 MinIO (${productName}/${taskName}/report)...`);
        const uploadResult = await uploadReportFolder(taskId, reportFolder, productName, taskName);

        if (uploadResult.success) {
          filePath = JSON.stringify(uploadResult.urls);
          console.log(`[VulnParse:${taskId}] MinIO 上传成功: ${uploadResult.files.length} 个文件`);
          await createParseLog(taskInstanceId, 'success', `MinIO 上传成功: ${uploadResult.files.length} 个文件`, uploadResult.files.join('\n'));
        } else {
          console.log(`[VulnParse:${taskId}] MinIO 上传失败: ${uploadResult.error}`);
          filePath = reportFolder;
          await createParseLog(taskInstanceId, 'warn', `MinIO 上传失败`, uploadResult.error || '未知错误');
        }
      } else {
        console.log(`[VulnParse:${taskId}] 未找到 Report 文件夹`);
        await createParseLog(taskInstanceId, 'warn', '未找到 Report 文件夹', `工作区路径: ${projectPath}`);
      }

      let report: ParsedVulnerabilityReport | null = null;

      await createParseLog(taskInstanceId, 'info', 'Phase 1: 启动 audit-report-parser skill', `opencode run "${INSTRUCTION_PHASE1}"`);
      console.log(`[VulnParse:${taskId}] Phase 1 开始: instruction="${INSTRUCTION_PHASE1}"`);
      report = await runOpencodeParse(taskId, projectPath, INSTRUCTION_PHASE1);

      if (report) {
        const durationMs = Date.now() - startTime;
        console.log(`[VulnParse:${taskId}] Phase 1 成功: ${report.vulnerabilities.length} 条漏洞, 耗时 ${durationMs}ms`);
        const vulnTitles = report.vulnerabilities.slice(0, 3).map(v => `${v.severity || '?'}: ${v.title}`).join('; ');
        await createParseLog(taskInstanceId, 'success', `Skill 解析成功，提取 ${report.vulnerabilities.length} 条漏洞`, `耗时 ${(durationMs / 1000).toFixed(1)}s, 示例: ${vulnTitles}`);
      } else {
        console.log(`[VulnParse:${taskId}] Phase 1 失败: Skill 未返回有效漏洞数据`);
        await createParseLog(taskInstanceId, 'warn', 'Phase 1 Skill 解析未返回有效数据', '将启动 Phase 2 Fallback');
      }

      if (!report) {
        await createParseLog(taskInstanceId, 'info', 'Phase 2: Skill 解析失败，启动通用 AI Fallback', `opencode run "${INSTRUCTION_PHASE2.substring(0, 80)}..."`);
        console.log(`[VulnParse:${taskId}] Phase 2 开始: instruction="${INSTRUCTION_PHASE2.substring(0, 80)}..."`);
        report = await runOpencodeParse(taskId, projectPath, INSTRUCTION_PHASE2);

        if (report) {
          const durationMs = Date.now() - startTime;
          console.log(`[VulnParse:${taskId}] Phase 2 成功: ${report.vulnerabilities.length} 条漏洞, 耗时 ${durationMs}ms`);
          const vulnTitles = report.vulnerabilities.slice(0, 3).map(v => `${v.severity || '?'}: ${v.title}`).join('; ');
          await createParseLog(taskInstanceId, 'success', `AI Fallback 解析成功，提取 ${report.vulnerabilities.length} 条漏洞`, `耗时 ${(durationMs / 1000).toFixed(1)}s, 示例: ${vulnTitles}`);
        } else {
          console.log(`[VulnParse:${taskId}] Phase 2 失败: AI Fallback 也未返回有效漏洞数据`);
          await createParseLog(taskInstanceId, 'warn', 'Phase 2 AI Fallback 解析未返回有效数据');
        }
      }

      if (!report) {
        console.log(`[VulnParse:${taskId}] 无法解析漏洞（Skill 和 AI 均失败）`);
        await createParseLog(taskInstanceId, 'warn', '漏洞报告解析失败', '无法从 Report 文件夹或 AI 输出中提取漏洞数据');
        return;
      }

      console.log(`[VulnParse:${taskId}] 解析到 ${report.vulnerabilities.length} 条漏洞`);

      console.log(`[VulnParse:${taskId}] 上传漏洞原始文件到 MinIO (${productName}/${taskName}/file)...`);
      const vulnsWithRawReports = report.vulnerabilities.filter(v => v.rawReport && v.rawReport.trim());
      if (vulnsWithRawReports.length > 0) {
        report.vulnerabilities = await processVulnerabilityRawReports(taskId, report.vulnerabilities, productName, taskName);
        const uploadedCount = report.vulnerabilities.filter(v => v.rawReport && v.rawReport.includes('http')).length;
        console.log(`[VulnParse:${taskId}] 漏洞原始文件上传完成: ${uploadedCount} 个文件已上传`);
        await createParseLog(taskInstanceId, 'success', `漏洞原始文件上传完成: ${uploadedCount} 个文件已上传`);
      } else {
        console.log(`[VulnParse:${taskId}] 无漏洞原始文件需要上传`);
      }

      const effectiveTaskId = taskInstanceId;

      console.log(`[VulnParse:${taskId}] 调用 /api/v1/vulnerabilities 入库: ${report.vulnerabilities.length} 条漏洞`);
      await createParseLog(taskInstanceId, 'info', `调用 /api/v1/vulnerabilities 入库`, `${report.vulnerabilities.length} 条漏洞`);

      const vulnRequestBody = {
        taskId: effectiveTaskId,
        filePath,
        vulnerabilities: report.vulnerabilities,
      };

      const vulnRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/v1/vulnerabilities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vulnRequestBody),
      });

      console.log(`[VulnParse:${taskId}] 漏洞入库响应: status=${vulnRes.status}, ok=${vulnRes.ok}`);

      const vulnResult = await vulnRes.json();

      if (vulnRes.ok && vulnResult.summary) {
        const createdCount = vulnResult.summary.created || 0;
        const skippedCount = vulnResult.summary.skipped || 0;

        await prisma.$executeRaw`
          UPDATE "CodeswarmTask"
          SET "reportContent" = ${`漏洞提交成功: 创建 ${createdCount} 条, 跳过 ${skippedCount} 条`},
              "updatedAt" = NOW()
          WHERE "taskId" = ${taskId}
        `;

        console.log(`[VulnParse:${taskId}] 漏洞提交成功: created=${createdCount}, skipped=${skippedCount}`);
        const vulnSummary = report.vulnerabilities.slice(0, 5).map(v => `[${v.severity || 'medium'}] ${v.title}`).join('\n');
        await createParseLog(taskInstanceId, 'success', `漏洞入库完成：创建 ${createdCount} 条，跳过 ${skippedCount} 条`, vulnSummary);
      } else {
        const errorMsg = vulnResult.error || '未知错误';
        console.error(`[VulnParse:${taskId}] 漏洞提交失败: ${errorMsg}`);
        await createParseLog(taskInstanceId, 'error', '漏洞入库失败', errorMsg);
      }

    } catch (e) {
      console.error(`[VulnParse:${taskId}] 异常:`, e);
      await createParseLog(taskInstanceId, 'error', 'VulnParse 异常', e instanceof Error ? e.message : String(e));
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

    // Atomically update CodeswarmTask + TaskInstance in one transaction
    const txResult = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.$executeRaw`
        UPDATE "CodeswarmTask"
        SET state = ${finalState},
            result = ${result || null},
            error = ${error || null},
            "reportContent" = ${reportContent || null},
            "completedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE "taskId" = ${taskId}
          AND (state = 'running' OR state = 'dispatched')
      `;

      if (updateResult === 0) {
        return { alreadyTerminal: true, taskInstance: null };
      }

      const taskInstance = await tx.taskInstance.findFirst({
        where: { codeswarmTaskId: taskId },
        select: { id: true },
      });

      if (taskInstance) {
        await tx.taskInstance.update({
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
      }

      return { alreadyTerminal: false, taskInstance };
    });

    if (txResult.alreadyTerminal) {
      console.warn(`[CodeSwarm] Result for task ${taskId} ignored — task already in terminal state (timeout/cancelled)`);
      if (nodeId) {
        await codeswarmDispatcher.onTaskCompleted(nodeId);
      }
      return NextResponse.json({ success: true, taskId, status: 'ignored', reason: 'task_already_terminal' });
    }

    const taskInstance = txResult.taskInstance;

    if (taskInstance) {
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
        select: { id: true, projectPath: true, name: true, targetProduct: true },
      });

      if (taskInstanceForParse?.projectPath) {
        let productName = taskInstanceForParse.targetProduct;

        if (!productName) {
          const codeswarmTask = await prisma.codeswarmTask.findUnique({
            where: { taskId },
            select: { targetProduct: true },
          });
          productName = codeswarmTask?.targetProduct || 'default';
        }

        const taskName = taskInstanceForParse.name || 'unnamed-task';

        await createParseLog(taskInstanceForParse.id, 'info', '收到 Worker 完成回调', `codeswarmTaskId: ${taskId}, 产品: ${productName}, 任务: ${taskName}`);

        executeVulnerabilityParseAsync(
          taskId,
          taskInstanceForParse.projectPath,
          taskInstanceForParse.id,
          { productName, taskName }
        );
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