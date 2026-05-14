import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { logger, LOG_MODULES } from '@/lib/logger';

const GITEA_CONFIG = {
  url: process.env.GITEA_URL || 'http://172.31.30.81:30030',
  token: process.env.GITEA_TOKEN || '',
  owner: process.env.GITEA_REPO_OWNER || 'wx1470671',
  repo: process.env.GITEA_REPO_NAME || 'test',
  branch: process.env.GITEA_BRANCH || 'main',
  localPath: process.env.AGENT_APP_LOCAL_PATH || path.join(process.cwd(), 'AgentHarness_management'),
};

class GitAgentAppSync {
  private git: SimpleGit | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private getRepoUrl(): string {
    const host = GITEA_CONFIG.url.replace('http://', '').replace('https://', '');
    return `http://${host}/${GITEA_CONFIG.owner}/${GITEA_CONFIG.repo}.git`;
  }

  private getRepoUrlWithAuth(): string {
    const host = GITEA_CONFIG.url.replace('http://', '').replace('https://', '');
    return `http://oauth2:${GITEA_CONFIG.token}@${host}/${GITEA_CONFIG.owner}/${GITEA_CONFIG.repo}.git`;
  }

  async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const repoPath = GITEA_CONFIG.localPath;
    const repoUrl = this.getRepoUrl();

    logger.info(LOG_MODULES.SKILL, 'GitAgentAppSync 初始化', { repoPath, repo: GITEA_CONFIG.repo });

    try {
      if (!fs.existsSync(repoPath)) {
        fs.mkdirSync(repoPath, { recursive: true });
        logger.info(LOG_MODULES.SKILL, '创建 AgentHarness_management 目录', { repoPath });
      }

      const gitDir = path.join(repoPath, '.git');
      
      // 设置环境变量禁用 SSL 验证（Windows 兼容）
      process.env.GIT_SSL_NO_VERIFY = '1';

      if (fs.existsSync(gitDir)) {
        this.git = simpleGit(repoPath);
        
        // 设置带认证的 remote URL
        await this.git.remote(['set-url', 'origin', this.getRepoUrlWithAuth()]);
        
        const currentBranch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
        if (currentBranch.trim() !== GITEA_CONFIG.branch) {
          await this.git.checkout(GITEA_CONFIG.branch);
        }
        
        await this.pull();
        logger.info(LOG_MODULES.SKILL, 'GitAgentAppSync 已初始化（已存在仓库）', { branch: currentBranch.trim() });
      } else {
        this.git = simpleGit();
        
        await this.git.clone(repoUrl, repoPath, ['-b', GITEA_CONFIG.branch]);
        this.git = simpleGit(repoPath);
        
        // 设置带认证的 remote URL
        await this.git.remote(['set-url', 'origin', this.getRepoUrlWithAuth()]);
        
        logger.info(LOG_MODULES.SKILL, 'GitAgentAppSync 已初始化（克隆仓库）', { repo: GITEA_CONFIG.repo, branch: GITEA_CONFIG.branch });
      }

      this.initialized = true;
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, 'GitAgentAppSync 初始化失败', { 
        details: { error: error instanceof Error ? error.message : String(error) } 
      });
      throw error;
    }
  }

  async pull(): Promise<{ success: boolean; message: string }> {
    if (!this.git) {
      await this.init();
    }

    try {
      const result = await this.git!.pull('origin', GITEA_CONFIG.branch);
      const changes = result.summary?.changes || 0;
      
      if (changes > 0) {
        logger.info(LOG_MODULES.SKILL, 'GitAgentApp pull 成功', { changes });
      }
      
      return { success: true, message: `拉取 ${changes} 个变更` };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.errorNoUser(LOG_MODULES.SKILL, 'GitAgentApp pull 失败', { details: { error: errorMsg } });
      return { success: false, message: errorMsg };
    }
  }

  async syncFromRemote(): Promise<{ success: boolean; message: string }> {
    return this.pull();
  }

  async uploadAgentApp(appId: string, files: Map<string, Buffer>): Promise<{ success: boolean; message: string; errors?: string[] }> {
    if (!this.git) {
      await this.init();
    }

    const appDir = path.join(GITEA_CONFIG.localPath, appId);
    const errors: string[] = [];

    try {
      if (!fs.existsSync(appDir)) {
        fs.mkdirSync(appDir, { recursive: true });
      }

      for (const [fileName, content] of files) {
        const filePath = path.join(appDir, fileName);
        // 确保子目录存在
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, content);
      }

      await this.git!.add(`${appId}/`);

      const status = await this.git!.status();
      if (status.staged.length > 0) {
        await this.git!.commit(`Add AgentApp: ${appId}`);
        await this.git!.push('origin', GITEA_CONFIG.branch);
        
        logger.info(LOG_MODULES.SKILL, 'GitAgentApp upload 成功', { appId, filesCount: files.size });
        return { success: true, message: `上传 ${files.size} 个文件` };
      } else {
        return { success: true, message: '文件已存在，无变更' };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.errorNoUser(LOG_MODULES.SKILL, 'GitAgentApp upload 失败', { details: { appId, error: errorMsg } });
      return { success: false, message: errorMsg, errors: [errorMsg] };
    }
  }

  async deleteAgentApp(appId: string): Promise<{ success: boolean; message: string }> {
    if (!this.git) {
      await this.init();
    }

    const appDir = path.join(GITEA_CONFIG.localPath, appId);

    try {
      if (!fs.existsSync(appDir)) {
        return { success: true, message: '文件夹不存在' };
      }

      fs.rmSync(appDir, { recursive: true, force: true });

      await this.git!.add('-A');
      await this.git!.commit(`Delete AgentApp: ${appId}`);
      await this.git!.push('origin', GITEA_CONFIG.branch);

      logger.info(LOG_MODULES.SKILL, 'GitAgentApp delete 成功', { appId });
      return { success: true, message: `删除 ${appId} 成功` };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.errorNoUser(LOG_MODULES.SKILL, 'GitAgentApp delete 失败', { details: { appId, error: errorMsg } });
      return { success: false, message: errorMsg };
    }
  }

  getLocalPath(): string {
    return GITEA_CONFIG.localPath;
  }

  getAppPath(appId: string): string {
    return path.join(GITEA_CONFIG.localPath, appId);
  }

  appExistsLocally(appId: string): boolean {
    return fs.existsSync(this.getAppPath(appId));
  }

  listLocalApps(): string[] {
    const repoPath = GITEA_CONFIG.localPath;
    if (!fs.existsSync(repoPath)) {
      return [];
    }

    const items = fs.readdirSync(repoPath);
    return items.filter(item => {
      const itemPath = path.join(repoPath, item);
      return fs.statSync(itemPath).isDirectory() && item !== '.git';
    });
  }
}

export const gitAgentAppSync = new GitAgentAppSync();

export async function initGitAgentAppSync(): Promise<void> {
  try {
    await gitAgentAppSync.init();
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '初始化 GitAgentAppSync 失败', { 
      details: { error: error instanceof Error ? error.message : String(error) } 
    });
  }
}