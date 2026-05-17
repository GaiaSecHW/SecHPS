import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import * as minioClient from './minio-client.js';

const IS_WIN = os.platform() === 'win32';

// Platform-aware defaults: Windows uses local dev paths, Linux uses /opt/ paths
const CODEDMAP_HOME = process.env.CODEDMAP_HOME || (IS_WIN ? path.resolve(process.cwd(), '..', '..', '..', 'codedmap') : '/opt/codedmap');
const JOERN_HOME = process.env.JOERN_HOME || (IS_WIN ? 'D:\\work\\tools\\joern\\joern-cli' : '/opt/joern/joern-cli');
const JAVA_HOME = process.env.JAVA_HOME || (IS_WIN ? '' : '/usr/lib/jvm/java-19-openjdk');
const PYTHON_CMD = IS_WIN ? 'py' : 'python3';
const PYTHON_PREFIX_ARGS = IS_WIN ? ['-3'] : [];

// 所有生成的 db 文件列表
const DB_FILES = [
  'graph.db',
  'analysis/call_graph.db',
  'analysis/copy.db',
  'analysis/linker.db',
  'analysis/load.db',
  'analysis/pts.db',
  'analysis/store.db',
];

export interface CodedmapEventCallback {
  (event: { type: 'phase_start' | 'phase_complete' | 'log_chunk'; content?: string; message?: string; timestamp: string; level?: 'worker' | 'agent'; phase?: string; success?: boolean }): void;
}

export class CodedmapManager {

  /**
   * 确保工作区中存在 targetProduct 对应的 db 文件。
   * 流程: 本地检查 → MinIO下载 → 本地生成并上传
   * 
   * 存储路径: dbs/{targetProduct}/*.db
   * 
   * 返回 graph.db 的完整路径。
   */
  async ensureDbFile(
    workspacePath: string,
    targetProduct: string,
    onEvent: CodedmapEventCallback,
  ): Promise<string> {
    // 实际输出目录: {workspacePath}/workspace/
    const workspaceDir = path.join(workspacePath, 'workspace');
    const graphDbPath = path.join(workspaceDir, 'graph.db');

    // Step 1: 检查本地是否已有 graph.db 文件
    if (fs.existsSync(graphDbPath)) {
      const stat = fs.statSync(graphDbPath);
      const analysisFiles = this.listExistingAnalysisDbs(workspaceDir);
      onEvent({
        type: 'phase_complete',
        phase: 'codedmap',
        success: true,
        message: `工作区已有知识图谱: graph.db (${(stat.size / 1024 / 1024).toFixed(1)}MB) + ${analysisFiles.length} 分析文件`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
      return graphDbPath;
    }

    onEvent({
      type: 'phase_start',
      phase: 'codedmap',
      message: `工作区无知识图谱，开始获取 dbs/${targetProduct}/...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    // Step 2: 确保 MinIO bucket 存在，然后尝试下载所有 db 文件
    await minioClient.ensureBucket();

    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] 尝试从 MinIO 下载 dbs/${targetProduct}/...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    const downloadResult = await minioClient.downloadDbFiles(targetProduct, workspaceDir, DB_FILES);
    
    if (downloadResult.downloaded > 0 && fs.existsSync(graphDbPath)) {
      const stat = fs.statSync(graphDbPath);
      onEvent({
        type: 'phase_complete',
        phase: 'codedmap',
        success: true,
        message: `从 MinIO 下载知识图谱成功: ${downloadResult.downloaded} 个文件，graph.db (${(stat.size / 1024 / 1024).toFixed(1)}MB)`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
      return graphDbPath;
    }

    // Step 3: MinIO 无文件，本地生成 db
    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] MinIO 上不存在 dbs/${targetProduct}/，开始构建知识图谱...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    await this.buildDb(workspacePath, targetProduct, onEvent);

    // Step 4: 上传所有 db 文件到 MinIO（异步，不阻塞返回）
    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] 构建完成，上传 ${DB_FILES.length} 个 db 文件到 MinIO dbs/${targetProduct}/...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    // 异步上传，不阻塞
    minioClient.uploadDbFiles(targetProduct, workspaceDir, DB_FILES)
      .then(uploadResult => {
        const uploadedNames = uploadResult.files.filter(f => f.success).map(f => f.name);
        onEvent({
          type: 'log_chunk',
          content: `[Codedmap] 上传 MinIO 成功: ${uploadResult.uploaded}/${DB_FILES.length} 个文件 (${uploadedNames.join(', ')})`,
          timestamp: new Date().toISOString(),
          level: 'worker',
        });
      })
      .catch(err => {
        onEvent({
          type: 'log_chunk',
          content: `[Codedmap] 上传 MinIO 失败: ${err instanceof Error ? err.message : String(err)}（不影响任务使用）`,
          timestamp: new Date().toISOString(),
          level: 'worker',
        });
      });

    const dbStat = fs.statSync(graphDbPath);
    const analysisFiles = this.listExistingAnalysisDbs(workspaceDir);
    onEvent({
      type: 'phase_complete',
      phase: 'codedmap',
      success: true,
      message: `知识图谱就绪: graph.db (${(dbStat.size / 1024 / 1024).toFixed(1)}MB) + ${analysisFiles.length} 分析文件`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    return graphDbPath;
  }

  /**
   * 列出已存在的分析 db 文件
   */
  private listExistingAnalysisDbs(workspaceDir: string): string[] {
    const analysisDir = path.join(workspaceDir, 'analysis');
    if (!fs.existsSync(analysisDir)) return [];
    
    return fs.readdirSync(analysisDir)
      .filter(f => f.endsWith('.db'))
      .map(f => `analysis/${f}`);
  }

  /**
   * 执行 build_map.py 生成 db 文件
   * 
   * 输出目录: {workspacePath}/workspace/
   * 主数据库: workspace/graph.db
   * 分析文件: workspace/analysis/*.db
   */
  private async buildDb(
    workspacePath: string,
    targetProduct: string,
    onEvent: CodedmapEventCallback,
  ): Promise<void> {
    const buildScript = path.join(CODEDMAP_HOME, 'tools', 'build_map.py');
    const workspaceDir = path.join(workspacePath, 'workspace');
    const graphDbPath = path.join(workspaceDir, 'graph.db');

    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] 开始生成知识图谱: ${PYTHON_CMD} ${[...PYTHON_PREFIX_ARGS, buildScript, workspacePath, '--joern-home', JOERN_HOME, '--workspace', workspaceDir].join(' ')}`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    if (!fs.existsSync(buildScript)) {
      throw new Error(`codedmap build script not found: ${buildScript} (CODEDMAP_HOME=${CODEDMAP_HOME})`);
    }

    // 设置环境变量
    const buildEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      GIT_TERMINAL_PROMPT: '0',
    };
    if (JAVA_HOME) {
      buildEnv.JAVA_HOME = JAVA_HOME;
      buildEnv.PATH = `${JAVA_HOME}/bin${path.delimiter}${process.env.PATH || ''}`;
    }

    const { stdout, stderr } = await this.runCommand(PYTHON_CMD, [
      ...PYTHON_PREFIX_ARGS,
      buildScript,
      workspacePath,
      '--joern-home', JOERN_HOME,
      '--workspace', workspaceDir,
    ], workspacePath, 3600_000, buildEnv);

    if (!fs.existsSync(graphDbPath)) {
      throw new Error(`build_map.py completed but graph.db not found at ${graphDbPath}\nstderr: ${stderr}\nstdout: ${stdout}`);
    }

    const stat = fs.statSync(graphDbPath);
    const analysisFiles = this.listExistingAnalysisDbs(workspaceDir);
    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] 知识图谱生成完成: graph.db (${(stat.size / 1024 / 1024).toFixed(1)}MB) + ${analysisFiles.length} 分析文件`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    // 输出所有生成的 db 文件信息
    for (const dbFile of analysisFiles) {
      const dbPath = path.join(workspaceDir, dbFile);
      if (fs.existsSync(dbPath)) {
        const dbStat = fs.statSync(dbPath);
        onEvent({
          type: 'log_chunk',
          content: `[Codedmap]   - ${dbFile}: ${(dbStat.size / 1024).toFixed(1)}KB`,
          timestamp: new Date().toISOString(),
          level: 'worker',
        });
      }
    }
  }

  /**
   * 执行命令，带超时和自定义环境变量
   */
  private runCommand(
    command: string,
    args: string[],
    cwd: string,
    timeout = 300_000,
    env?: NodeJS.ProcessEnv,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = execFile(command, args, {
        cwd,
        timeout,
        maxBuffer: 50 * 1024 * 1024,
        env: env || { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }, (error, stdout, stderr) => {
        if (error) {
          if ((error as any).killed) {
            reject(new Error(`Command timed out after ${timeout / 1000}s: ${command} ${args.join(' ')}`));
          } else {
            reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr || error.message}`));
          }
        } else {
          resolve({ stdout: stdout || '', stderr: stderr || '' });
        }
      });
    });
  }
}
