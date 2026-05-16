import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import * as minioClient from './minio-client.js';

const CODEDMAP_HOME = process.env.CODEDMAP_HOME || '/opt/codedmap';

export interface CodedmapEventCallback {
  (event: { type: string; content?: string; message?: string; timestamp: string; level?: 'worker' | 'agent'; phase?: string; success?: boolean }): void;
}

export class CodedmapManager {

  /**
   * 确保工作区中存在 targetProduct 对应的 db 文件。
   * 流程: 本地检查 → MinIO下载 → 本地生成并上传
   */
  async ensureDbFile(
    workspacePath: string,
    targetProduct: string,
    onEvent: CodedmapEventCallback,
  ): Promise<string> {
    const dbFileName = `${targetProduct}.db`;
    const dbPath = path.join(workspacePath, dbFileName);
    const objectName = dbFileName;

    // Step 1: 检查本地是否已有 db 文件
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      onEvent({
        type: 'phase_complete',
        phase: 'codedmap',
        success: true,
        message: `工作区已有知识图谱: ${dbFileName} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
      return dbPath;
    }

    onEvent({
      type: 'phase_start',
      phase: 'codedmap',
      message: `工作区无知识图谱 ${dbFileName}，开始获取...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    // Step 2: 确保 MinIO bucket 存在，然后尝试下载
    await minioClient.ensureBucket();

    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] 尝试从 MinIO 下载 ${dbFileName}...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    const downloaded = await minioClient.downloadFile(objectName, dbPath);
    if (downloaded) {
      const stat = fs.statSync(dbPath);
      onEvent({
        type: 'phase_complete',
        phase: 'codedmap',
        success: true,
        message: `从 MinIO 下载知识图谱成功: ${dbFileName} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
      return dbPath;
    }

    // Step 3: MinIO 无文件，本地生成 db
    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] MinIO 上不存在 ${dbFileName}，开始构建知识图谱...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    await this.buildDb(workspacePath, targetProduct, onEvent);

    // Step 4: 上传到 MinIO（异步，不阻塞返回）
    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] 构建完成，上传 ${dbFileName} 到 MinIO...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    const uploaded = await minioClient.uploadFile(objectName, dbPath);
    if (uploaded) {
      onEvent({
        type: 'log_chunk',
        content: `[Codedmap] 上传 ${dbFileName} 到 MinIO 成功`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
    } else {
      onEvent({
        type: 'log_chunk',
        content: `[Codedmap] 上传 MinIO 失败（不影响任务使用）`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
    }

    const dbStat = fs.statSync(dbPath);
    onEvent({
      type: 'phase_complete',
      phase: 'codedmap',
      success: true,
      message: `知识图谱就绪: ${dbFileName} (${(dbStat.size / 1024 / 1024).toFixed(1)}MB)${uploaded ? '' : '（MinIO 上传失败）'}`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    return dbPath;
  }

  /**
   * 执行 build_map.py 生成 db 文件
   */
  private async buildDb(
    workspacePath: string,
    targetProduct: string,
    onEvent: CodedmapEventCallback,
  ): Promise<void> {
    const dbPath = path.join(workspacePath, `${targetProduct}.db`);
    const buildScript = path.join(CODEDMAP_HOME, 'tools', 'build_map.py');

    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] 开始生成知识图谱: python3 ${buildScript} ${workspacePath} --db ${dbPath}`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    if (!fs.existsSync(buildScript)) {
      throw new Error(`codedmap build script not found: ${buildScript} (CODEDMAP_HOME=${CODEDMAP_HOME})`);
    }

    const { stdout, stderr } = await this.runCommand('python3', [
      buildScript,
      workspacePath,
      '--db', dbPath,
    ], workspacePath, 3600_000);

    if (!fs.existsSync(dbPath)) {
      throw new Error(`build_map.py completed but db file not found at ${dbPath}\nstderr: ${stderr}`);
    }

    const stat = fs.statSync(dbPath);
    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] 知识图谱生成完成: ${targetProduct}.db (${(stat.size / 1024 / 1024).toFixed(1)}MB)`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });
  }

  /**
   * 执行命令，带超时
   */
  private runCommand(
    command: string,
    args: string[],
    cwd: string,
    timeout = 300_000,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile(command, args, {
        cwd,
        timeout,
        maxBuffer: 50 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr || error.message}`));
        } else {
          resolve({ stdout: stdout || '', stderr: stderr || '' });
        }
      });
    });
  }
}
