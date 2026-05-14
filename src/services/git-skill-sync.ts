import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { logger, LOG_MODULES } from '@/lib/logger';

const GITEA_CONFIG = {
  url: process.env.SKILLS_GITEA_URL || 'http://172.31.30.81:30030',
  token: process.env.SKILLS_GITEA_TOKEN || '',
  owner: process.env.SKILLS_GITEA_REPO_OWNER || 'wx1470671',
  repo: process.env.SKILLS_GITEA_REPO_NAME || 'skill-test',
  branch: process.env.SKILLS_GITEA_BRANCH || 'main',
  localPath: process.env.SKILL_LOCAL_PATH || path.join(process.cwd(), 'skill_management'),
};

class GitSkillSync {
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

    logger.info(LOG_MODULES.SKILL, 'GitSkillSync 初始化', { repoPath, repo: GITEA_CONFIG.repo });

    try {
      if (!fs.existsSync(repoPath)) {
        fs.mkdirSync(repoPath, { recursive: true });
        logger.info(LOG_MODULES.SKILL, '创建 skill_management 目录', { repoPath });
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
        logger.info(LOG_MODULES.SKILL, 'GitSkillSync 已初始化（已存在仓库）', { branch: currentBranch.trim() });
      } else {
        this.git = simpleGit();
        
        await this.git.clone(repoUrl, repoPath, ['-b', GITEA_CONFIG.branch]);
        this.git = simpleGit(repoPath);
        
        // 设置带认证的 remote URL
        await this.git.remote(['set-url', 'origin', this.getRepoUrlWithAuth()]);
        
        logger.info(LOG_MODULES.SKILL, 'GitSkillSync 已初始化（克隆仓库）', { repo: GITEA_CONFIG.repo, branch: GITEA_CONFIG.branch });
      }

      this.initialized = true;
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, 'GitSkillSync 初始化失败', { 
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
        logger.info(LOG_MODULES.SKILL, 'Git pull 成功', { changes });
      }
      
      return { success: true, message: `拉取 ${changes} 个变更` };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.errorNoUser(LOG_MODULES.SKILL, 'Git pull 失败', { details: { error: errorMsg } });
      return { success: false, message: errorMsg };
    }
  }

  async syncFromRemote(): Promise<{ success: boolean; message: string }> {
    return this.pull();
  }

  async uploadSkill(skillName: string, files: Map<string, Buffer>): Promise<{ success: boolean; message: string; errors?: string[] }> {
    if (!this.git) {
      await this.init();
    }

    const skillDir = path.join(GITEA_CONFIG.localPath, skillName);
    const errors: string[] = [];

    try {
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      for (const [fileName, content] of files) {
        const filePath = path.join(skillDir, fileName);
        // 确保子目录存在
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, content);
      }

      await this.git!.add(`${skillName}/`);

      const status = await this.git!.status();
      if (status.staged.length > 0) {
        await this.git!.commit(`Add skill: ${skillName}`);
        await this.git!.push('origin', GITEA_CONFIG.branch);
        
        logger.info(LOG_MODULES.SKILL, 'Git push 成功', { skillName, filesCount: files.size });
        return { success: true, message: `上传 ${files.size} 个文件` };
      } else {
        return { success: true, message: '文件已存在，无变更' };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.errorNoUser(LOG_MODULES.SKILL, 'Git upload 失败', { details: { skillName, error: errorMsg } });
      return { success: false, message: errorMsg, errors: [errorMsg] };
    }
  }

  async deleteSkill(skillName: string): Promise<{ success: boolean; message: string }> {
    if (!this.git) {
      await this.init();
    }

    const skillDir = path.join(GITEA_CONFIG.localPath, skillName);

    try {
      if (!fs.existsSync(skillDir)) {
        return { success: true, message: '文件夹不存在' };
      }

fs.rmSync(skillDir, { recursive: true, force: true });

      await this.git!.add('-A');
      await this.git!.commit(`Delete skill: ${skillName}`);
      await this.git!.push('origin', GITEA_CONFIG.branch);

      logger.info(LOG_MODULES.SKILL, 'Git delete 成功', { skillName });
      return { success: true, message: `删除 ${skillName} 成功` };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.errorNoUser(LOG_MODULES.SKILL, 'Git delete 失败', { details: { skillName, error: errorMsg } });
      return { success: false, message: errorMsg };
    }
  }

  async updateSkillFile(skillName: string, fileName: string, content: string): Promise<{ success: boolean; message: string }> {
    if (!this.git) {
      await this.init();
    }

    const filePath = path.join(GITEA_CONFIG.localPath, skillName, fileName);

    try {
      const skillDir = path.join(GITEA_CONFIG.localPath, skillName);
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      fs.writeFileSync(filePath, content, 'utf-8');

      await this.git!.add(`${skillName}/${fileName}`);
      
      const status = await this.git!.status();
      if (status.staged.length > 0) {
        await this.git!.commit(`Update skill file: ${skillName}/${fileName}`);
        await this.git!.push('origin', GITEA_CONFIG.branch);
        
        logger.info(LOG_MODULES.SKILL, 'Git update 成功', { skillName, fileName });
        return { success: true, message: `更新 ${fileName} 成功` };
      } else {
        return { success: true, message: '文件无变更' };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.errorNoUser(LOG_MODULES.SKILL, 'Git update 失败', { details: { skillName, fileName, error: errorMsg } });
      return { success: false, message: errorMsg };
    }
  }

  getLocalPath(): string {
    return GITEA_CONFIG.localPath;
  }

  getSkillPath(skillName: string): string {
    return path.join(GITEA_CONFIG.localPath, skillName);
  }

  skillExistsLocally(skillName: string): boolean {
    return fs.existsSync(this.getSkillPath(skillName));
  }

  getSkillFileContent(skillName: string, fileName: string): string | null {
    const filePath = path.join(GITEA_CONFIG.localPath, skillName, fileName);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return null;
  }

  listLocalSkills(): string[] {
    const repoPath = GITEA_CONFIG.localPath;
    if (!fs.existsSync(repoPath)) {
      return [];
    }

    const items = fs.readdirSync(repoPath);
    return items.filter(item => {
      const itemPath = path.join(repoPath, item);
      return fs.statSync(itemPath).isDirectory() && 
             item !== '.git' &&
             fs.existsSync(path.join(itemPath, 'SKILL.md'));
    });
  }
}

export const gitSkillSync = new GitSkillSync();

export async function initGitSkillSync(): Promise<void> {
  try {
    await gitSkillSync.init();
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '初始化 GitSkillSync 失败', { 
      details: { error: error instanceof Error ? error.message : String(error) } 
    });
  }
}