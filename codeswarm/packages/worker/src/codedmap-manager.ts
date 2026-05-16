import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';

const GITEA_REPO = process.env.GITEA_CODEDMAP_REPO || 'http://172.31.30.81:30030/ai-infra/codedmap.git';
const GITEA_TOKEN = process.env.GITEA_CODEDMAP_TOKEN || '';
const GITEA_USER = process.env.GITEA_CODEDMAP_USER || 'git';
const CODEDMAP_HOME = process.env.CODEDMAP_HOME || '/opt/codedmap';

export interface CodedmapEventCallback {
  (event: { type: string; content?: string; message?: string; timestamp: string; level?: string; phase?: string; success?: boolean }): void;
}

export class CodedmapManager {

  /**
   * 确保工作区中存在 targetProduct 对应的 db 文件。
   * 流程: 本地检查 → Gitea拉取 → 本地生成并上传
   */
  async ensureDbFile(
    workspacePath: string,
    targetProduct: string,
    onEvent: CodedmapEventCallback,
  ): Promise<string> {
    const dbFileName = `${targetProduct}.db`;
    const dbPath = path.join(workspacePath, dbFileName);

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

    // Step 2: 尝试从 Gitea 拉取（通过 API 直接下载单文件）
    const pulled = await this.pullFromGitea(workspacePath, targetProduct, onEvent);
    if (pulled) {
      return dbPath;
    }

    // Step 3: 本地生成 db 文件
    await this.buildDb(workspacePath, targetProduct, onEvent);

    // Step 4: 上传到 Gitea
    await this.pushToGitea(dbPath, targetProduct, onEvent);

    return dbPath;
  }

  /**
   * 通过 Gitea API 直接下载单个 db 文件，避免克隆整个仓库
   */
  private async pullFromGitea(
    workspacePath: string,
    targetProduct: string,
    onEvent: CodedmapEventCallback,
  ): Promise<boolean> {
    const dbFileName = `${targetProduct}.db`;
    const dbPath = path.join(workspacePath, dbFileName);

    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] 尝试从 Gitea 拉取 ${dbFileName}...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    try {
      const { apiBaseUrl, ownerRepo } = this.parseGiteaRepoInfo();
      const downloadUrl = `${apiBaseUrl}/api/v1/repos/${ownerRepo}/raw/dbs/${dbFileName}?ref=master`;

      const response = await fetch(downloadUrl, {
        headers: GITEA_TOKEN ? { 'Authorization': `token ${GITEA_TOKEN}` } : {},
        signal: AbortSignal.timeout(600_000), // 10 min timeout for large files
      });

      if (!response.ok) {
        if (response.status === 404) {
          onEvent({
            type: 'log_chunk',
            content: `[Codedmap] Gitea 上不存在 ${dbFileName}，需要本地生成`,
            timestamp: new Date().toISOString(),
            level: 'worker',
          });
        } else {
          onEvent({
            type: 'log_chunk',
            content: `[Codedmap] Gitea API 返回 ${response.status}，跳过拉取`,
            timestamp: new Date().toISOString(),
            level: 'worker',
          });
        }
        return false;
      }

      if (!response.body) {
        onEvent({
          type: 'log_chunk',
          content: `[Codedmap] Gitea 响应无 body，跳过拉取`,
          timestamp: new Date().toISOString(),
          level: 'worker',
        });
        return false;
      }

      // 流式写入文件，避免内存溢出
      const nodeStream = Readable.fromWeb(response.body as any);
      const fileStream = fs.createWriteStream(dbPath);
      await pipeline(nodeStream, fileStream);

      const stat = fs.statSync(dbPath);
      onEvent({
        type: 'phase_complete',
        phase: 'codedmap',
        success: true,
        message: `从 Gitea 拉取知识图谱成功: ${dbFileName} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });

      return true;
    } catch (err) {
      onEvent({
        type: 'log_chunk',
        content: `[Codedmap] Gitea 拉取失败: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
      return false;
    }
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
   * 上传 db 文件到 Gitea 仓库（通过 git clone + push）
   */
  private async pushToGitea(
    dbPath: string,
    targetProduct: string,
    onEvent: CodedmapEventCallback,
  ): Promise<void> {
    const dbFileName = `${targetProduct}.db`;
    const tmpDir = path.join(path.dirname(dbPath), '.codedmap_push_tmp');

    onEvent({
      type: 'log_chunk',
      content: `[Codedmap] 上传 ${dbFileName} 到 Gitea...`,
      timestamp: new Date().toISOString(),
      level: 'worker',
    });

    try {
      const cloneUrl = this.buildAuthUrl(GITEA_REPO, GITEA_TOKEN);

      await this.runCommand('git', ['clone', '--depth', '1', cloneUrl, tmpDir], path.dirname(dbPath));

      const dbsDir = path.join(tmpDir, 'dbs');
      if (!fs.existsSync(dbsDir)) {
        fs.mkdirSync(dbsDir, { recursive: true });
      }

      const targetPath = path.join(dbsDir, dbFileName);
      fs.copyFileSync(dbPath, targetPath);

      await this.runCommand('git', ['add', `dbs/${dbFileName}`], tmpDir);

      // 检查是否有变更，避免 "nothing to commit" 报错
      try {
        await this.runCommand('git', ['diff', '--cached', '--quiet'], tmpDir);
        // diff --cached --quiet 成功 = 无变更，无需 commit/push
        onEvent({
          type: 'log_chunk',
          content: `[Codedmap] ${dbFileName} 已是最新，跳过上传`,
          timestamp: new Date().toISOString(),
          level: 'worker',
        });
        return;
      } catch {
        // diff 失败 = 有变更，继续 commit
      }

      await this.runCommand('git', [
        '-c', 'user.name=codeswarm-worker',
        '-c', 'user.email=worker@codeswarm.local',
        'commit', '-m', `upload codedmap db: ${dbFileName}`,
      ], tmpDir);
      await this.runCommand('git', ['push', 'origin', 'HEAD'], tmpDir);

      onEvent({
        type: 'log_chunk',
        content: `[Codedmap] 上传 ${dbFileName} 到 Gitea 成功`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
    } catch (err) {
      onEvent({
        type: 'log_chunk',
        content: `[Codedmap] 上传 Gitea 失败（不影响任务）: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
        level: 'worker',
      });
    } finally {
      this.removeDir(tmpDir);
    }
  }

  /**
   * 解析 Gitea 仓库 URL，提取 API 基础 URL 和 owner/repo 路径
   */
  private parseGiteaRepoInfo(): { apiBaseUrl: string; ownerRepo: string } {
    const url = new URL(GITEA_REPO);
    const pathParts = url.pathname.replace(/\.git$/, '').replace(/^\//, '').split('/');
    const ownerRepo = pathParts.slice(0, 2).join('/');
    return { apiBaseUrl: `${url.protocol}//${url.host}`, ownerRepo };
  }

  /**
   * 构建带认证信息的 git URL
   * 支持 http://username:token@host/path 和 http://token@host/path 两种格式
   */
  private buildAuthUrl(repoUrl: string, token: string): string {
    if (!token) return repoUrl;
    const user = GITEA_USER || 'git';
    // http(s)://host/path → http(s)://username:token@host/path
    return repoUrl.replace(/^(https?:\/\/)/, `$1${user}:${token}@`);
  }

  /**
   * 执行命令，带超时。错误消息中不包含敏感参数（如 token）
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
          // 脱敏：移除错误消息中可能包含的 token 凭据
          const safeCmd = this.sanitizeCredentials(`${command} ${args.join(' ')}`);
          const safeStderr = this.sanitizeCredentials(stderr || '');
          reject(new Error(`Command failed: ${safeCmd}\n${safeStderr || error.message}`));
        } else {
          resolve({ stdout: stdout || '', stderr: stderr || '' });
        }
      });
    });
  }

  /**
   * 移除字符串中可能包含的凭据信息
   */
  private sanitizeCredentials(input: string): string {
    // 匹配 :token@ 或 :any-string@ 格式的凭据
    return input.replace(/:[^:@\/]+@/g, ':***@');
  }

  /**
   * 递归删除目录
   */
  private removeDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}
