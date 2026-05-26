/**
 * Gitea 组织仓库服务
 * 用于在指定组织下创建和管理 AgentHarness 仓库
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { logger, LOG_MODULES } from '@/lib/logger';

const GITEA = 'GiteaOrg';

const GITEA_ORG_URL = process.env.GITEA_ORG_URL || 'http://172.31.30.81:30030';
const GITEA_ORG_TOKEN = process.env.GITEA_ORG_TOKEN || '';
const GITEA_ORG_NAME = process.env.GITEA_ORG_NAME || 'icsl-test';
const AGENT_HARNESS_LOCAL_PATH = process.env.AGENT_HARNESS_LOCAL_PATH || './AgentHarness';

const GITEA_TIMEOUT = 30000;

interface GiteaRepoInfo {
  name: string;
  full_name: string;
  html_url: string;
}

interface FileUploadResult {
  path: string;
  sha: string;
  url: string;
}

function isConfigured(): boolean {
  return Boolean(GITEA_ORG_URL && GITEA_ORG_TOKEN && GITEA_ORG_NAME);
}

async function fetchWithTimeout(url: string, options: RequestInit, timeout: number = GITEA_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`请求超时 (${timeout}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function sanitizeRepoName(fileName: string): string {
  const baseName = fileName.replace(/\.(zip|rar|7z|tar\.gz|tar)$/i, '');
  return baseName.replace(/[^a-zA-Z0-9_.-]/g, '-').toLowerCase();
}

/** 查询当天已有版本分支数，生成下一个序号 */
async function getNextBranchSeq(repoName: string, dateStr: string): Promise<string> {
  try {
    const url = `${GITEA_ORG_URL}/api/v1/repos/${GITEA_ORG_NAME}/${repoName}/branches`;
    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `token ${GITEA_ORG_TOKEN}`, Accept: 'application/json' },
    });
    if (response.ok) {
      const branches = await response.json() as Array<{ name: string }>;
      const prefix = `update-${dateStr}-`;
      const todayBranches = branches.filter(b => b.name.startsWith(prefix));
      const seq = todayBranches.length + 1;
      return String(seq).padStart(3, '0');
    }
  } catch {}
  return '001';
}

/** 通过 Gitea API 将版本分支合入 main */
async function mergeBranchToMain(repoName: string, headBranch: string, baseBranch: string): Promise<boolean> {
  try {
    // 创建 PR
    const prUrl = `${GITEA_ORG_URL}/api/v1/repos/${GITEA_ORG_NAME}/${repoName}/pulls`;
    const prResp = await fetchWithTimeout(prUrl, {
      method: 'POST',
      headers: { Authorization: `token ${GITEA_ORG_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        head: headBranch,
        base: baseBranch,
        title: `Merge ${headBranch} into ${baseBranch}`,
      }),
    });
    if (!prResp.ok) {
      logger.error(GITEA, `创建 PR 失败: ${prResp.status}`);
      return false;
    }
    const pr = await prResp.json() as { number: number };

    // 合并 PR
    const mergeUrl = `${GITEA_ORG_URL}/api/v1/repos/${GITEA_ORG_NAME}/${repoName}/pulls/${pr.number}/merge`;
    const mergeResp = await fetchWithTimeout(mergeUrl, {
      method: 'POST',
      headers: { Authorization: `token ${GITEA_ORG_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ Do: 'merge' }),
    });
    return mergeResp.ok;
  } catch (e) {
    logger.error(GITEA, '合入 main 异常', { details: { error: e instanceof Error ? e.message : String(e) } });
    return false;
  }
}

export async function checkOrgRepoExists(repoName: string): Promise<boolean> {
  if (!isConfigured()) {
    logger.warn(GITEA, '配置不完整');
    return false;
  }

  const url = `${GITEA_ORG_URL}/api/v1/repos/${GITEA_ORG_NAME}/${repoName}`;

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `token ${GITEA_ORG_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      return true;
    }

    if (response.status === 404) {
      return false;
    }

    logger.error(GITEA, `检查仓库失败: ${response.status}`);
    return false;
  } catch (error) {
    logger.error(GITEA, '检查仓库异常', { details: { error: error instanceof Error ? error.message : String(error) } });
    return false;
  }
}

export async function createOrgRepo(repoName: string): Promise<GiteaRepoInfo | null> {
  if (!isConfigured()) {
    logger.warn(GITEA, '配置不完整，无法创建仓库');
    return null;
  }

  const url = `${GITEA_ORG_URL}/api/v1/orgs/${GITEA_ORG_NAME}/repos`;

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${GITEA_ORG_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: repoName,
        private: true,
        description: `AgentHarness for ${repoName}`,
        auto_init: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 409) {
        throw new Error(`仓库 ${repoName} 已存在`);
      }
      throw new Error(`创建仓库失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    logger.info(GITEA, `仓库创建成功: ${data.full_name}`);

    return {
      name: data.name,
      full_name: data.full_name,
      html_url: data.html_url,
    };
  } catch (error) {
    logger.error(GITEA, '创建仓库异常', { details: { error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

function removeCommonPrefix(files: Map<string, Buffer>): Map<string, Buffer> {
  const paths = Array.from(files.keys());
  if (paths.length === 0) return files;
  
  let commonPrefix = '';
  const firstPath = paths[0].replace(/^\/+/, '').replace(/\\+/g, '/');
  const parts = firstPath.split('/');
  
  if (parts.length > 1) {
    commonPrefix = parts[0] + '/';
    const allHavePrefix = paths.every(p => {
      const normalized = p.replace(/^\/+/, '').replace(/\\+/g, '/');
      return normalized.startsWith(commonPrefix);
    });
    if (!allHavePrefix) {
      commonPrefix = '';
    }
  }
  
  if (!commonPrefix) return files;
  
  const cleanedFiles = new Map<string, Buffer>();
  for (const [path, content] of files) {
    let cleanPath = path.replace(/^\/+/, '').replace(/\\+/g, '/');
    if (cleanPath.startsWith(commonPrefix)) {
      cleanPath = cleanPath.slice(commonPrefix.length);
    }
    if (cleanPath) {
      cleanedFiles.set(cleanPath, content);
    }
  }
  
  return cleanedFiles;
}

async function ensureIndependentGitRepo(localPath: string): Promise<void> {
  await mkdir(localPath, { recursive: true });
  
  const gitDir = join(localPath, '.git');
  if (!existsSync(gitDir)) {
    const tempGit: SimpleGit = simpleGit(localPath);
    await tempGit.init();
    await tempGit.addConfig('user.name', 'SecHPS-Bot');
    await tempGit.addConfig('user.email', 'bot@sechps.com');
    if (!GITEA_ORG_URL.startsWith('https://')) {
      await tempGit.addConfig('http.sslVerify', 'false');
    }
  }
}

async function writeFilesToLocalDir(repoName: string, files: Map<string, Buffer>): Promise<string> {
  const localPath = join(process.cwd(), AGENT_HARNESS_LOCAL_PATH, repoName);
  
  await ensureIndependentGitRepo(localPath);
  
  const cleanedFiles = removeCommonPrefix(files);
  
  for (const [relativePath, content] of cleanedFiles) {
    const filePath = join(localPath, relativePath);
    const dirPath = dirname(filePath);
    
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, content);
  }
  
  logger.info(GITEA, `本地文件写入完成: ${localPath} (${cleanedFiles.size} 个文件)`);
  return localPath;
}

export async function pushToOrgRepoViaGit(
  repoName: string,
  files: Map<string, Buffer>
): Promise<{ success: boolean; method: string; error?: string }> {
  if (!isConfigured()) {
    return { success: false, method: 'git', error: 'Gitea 配置不完整' };
  }

  if (files.size === 0) {
    return { success: false, method: 'git', error: '无文件需要上传' };
  }

  const localPath = await writeFilesToLocalDir(repoName, files);
  
  const isHttps = GITEA_ORG_URL.startsWith('https://');
  const giteaHost = GITEA_ORG_URL.replace(/^https?:\/\//, '');
  const protocol = isHttps ? 'https' : 'http';
  const repoUrl = `${protocol}://${GITEA_ORG_TOKEN}@${giteaHost}/${GITEA_ORG_NAME}/${repoName}.git`;

  const git: SimpleGit = simpleGit(localPath);

  try {
    const remotes = await git.getRemotes(true);
    const originRemote = remotes.find(r => r.name === 'origin');
    
    if (!originRemote) {
      await git.addRemote('origin', repoUrl);
    } else if (originRemote.refs?.fetch !== repoUrl) {
      await git.removeRemote('origin');
      await git.addRemote('origin', repoUrl);
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      await git.fetch('origin');
    } catch (fetchError) {
      logger.info(GITEA, `fetch 失败（可能仓库刚创建），将直接 push: ${fetchError}`);
    }

    let remoteBranch = 'main';
    try {
      const remote = await git.remote(['show', 'origin']);
      if (typeof remote === 'string') {
        const headBranchMatch = remote.match(/HEAD branch:\s*(\S+)/);
        if (headBranchMatch && headBranchMatch[1]) {
          remoteBranch = headBranchMatch[1];
        }
      }
    } catch {
      remoteBranch = 'main';
    }

    try {
      const branches = await git.branchLocal();
      if (branches.all.includes(remoteBranch)) {
        await git.checkout(remoteBranch);
      } else {
        await git.checkoutLocalBranch(remoteBranch);
      }
    } catch (checkoutError) {
      try {
        await git.checkoutLocalBranch('main');
        remoteBranch = 'main';
      } catch {
        await git.raw(['checkout', '-b', 'main']);
        remoteBranch = 'main';
      }
    }

    await git.add('.');
    const status = await git.status();

    logger.info(GITEA, `Git status: ${localPath}, files: ${status.files.length}, staged: ${status.staged.length}`);

    if (status.files.length === 0) {
      logger.info(GITEA, `无变更需要提交: ${repoName}`);
      return { success: true, method: 'git' };
    }

    await git.addConfig('user.email', 'sechps-bot@SecHPS.local');
    await git.addConfig('user.name', 'SecHPS Bot');
    await git.commit(`Add AgentHarness for ${repoName}`);

    // 生成版本分支名：update-{YYYYMMDD}-{当日序号}
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const seq = await getNextBranchSeq(repoName, dateStr);
    const versionBranch = `update-${dateStr}-${seq}`;

    // 创建版本分支并 push
    await git.checkoutLocalBranch(versionBranch);

    try {
      await git.push('origin', versionBranch, { '--set-upstream': null });
    } catch (pushError) {
      logger.warn(GITEA, `版本分支 push 失败，尝试 force push: ${pushError}`);
      await git.push('origin', versionBranch, { '--force': null, '--set-upstream': null });
    }

    logger.info(GITEA, `版本分支 push 成功: ${repoName} -> ${versionBranch}`);

    // 通过 Gitea API 合入 main
    const mergeResult = await mergeBranchToMain(repoName, versionBranch, remoteBranch);
    if (mergeResult) {
      logger.info(GITEA, `版本分支 ${versionBranch} 已合入 ${remoteBranch}`);
    } else {
      logger.warn(GITEA, `版本分支 ${versionBranch} 合入 ${remoteBranch} 失败，分支已保留`);
    }

    return { success: true, method: 'git' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(GITEA, `Git push 失败: ${repoName}`, { details: { error: errorMsg } });
    return { success: false, method: 'git', error: errorMsg };
  }
}

export async function uploadFilesToOrgRepo(
  repoName: string,
  files: Map<string, Buffer>
): Promise<FileUploadResult[]> {
  if (!isConfigured()) {
    logger.warn(GITEA, '配置不完整，无法上传文件');
    return [];
  }

  if (files.size === 0) {
    logger.info(GITEA, '无文件需要上传');
    return [];
  }

  const cleanedFiles = removeCommonPrefix(files);
  const branch = 'main';

  // 使用 Gitea 1.20+ 批量文件提交 API：一次 HTTP 请求提交所有文件
  const apiUrl = `${GITEA_ORG_URL}/api/v1/repos/${GITEA_ORG_NAME}/${repoName}/contents`;

  const fileOperations = Array.from(cleanedFiles.entries()).map(([relativePath, content]) => ({
    operation: 'create',
    path: relativePath.replace(/^\/+/, ''),
    content: content.toString('base64'),
  }));

  try {
    const response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `token ${GITEA_ORG_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: fileOperations,
        message: `Update AgentHarness: ${fileOperations.length} files`,
        branch,
      }),
    }, 60000);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(GITEA, `批量上传失败 (${response.status}): ${errorText}`);
      return [];
    }

    logger.info(GITEA, `批量上传成功: ${fileOperations.length} 个文件`);
    return fileOperations.map(f => ({
      path: f.path,
      sha: '',
      url: `${GITEA_ORG_URL}/${GITEA_ORG_NAME}/${repoName}/src/branch/${branch}/${f.path}`,
    }));
  } catch (error) {
    logger.error(GITEA, '批量上传异常', { details: { error: error instanceof Error ? error.message : String(error) } });
    return [];
  }
}

export async function pushOrUpdateOrgRepo(
  repoName: string,
  files: Map<string, Buffer>
): Promise<{ success: boolean; method: string }> {
  const gitResult = await pushToOrgRepoViaGit(repoName, files);
  
  if (gitResult.success) {
    return { success: true, method: 'git' };
  }
  
  logger.error(GITEA, `Git push 失败，回退到 API 上传: ${gitResult.error}`);
  
  const apiResults = await uploadFilesToOrgRepo(repoName, files);
  
  if (apiResults.length === files.size) {
    return { success: true, method: 'api' };
  }
  
  return { success: false, method: 'api' };
}

export async function deleteOrgRepo(repoName: string): Promise<boolean> {
  if (!isConfigured()) {
    logger.warn(GITEA, '配置不完整，无法删除仓库');
    return false;
  }

  const url = `${GITEA_ORG_URL}/api/v1/repos/${GITEA_ORG_NAME}/${repoName}`;

  try {
    const response = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: {
        Authorization: `token ${GITEA_ORG_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      logger.info(GITEA, `仓库不存在: ${repoName}`);
      return true;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`删除仓库失败: ${response.status} - ${errorText}`);
    }

    logger.info(GITEA, `仓库删除成功: ${repoName}`);

    const localPath = join(process.cwd(), AGENT_HARNESS_LOCAL_PATH, repoName);
    try {
      await rm(localPath, { recursive: true, force: true });
      logger.info(GITEA, `本地目录删除成功: ${localPath}`);
    } catch (rmError) {
      logger.warn(GITEA, `本地目录删除失败: ${localPath}`, { details: { error: rmError instanceof Error ? rmError.message : String(rmError) } });
    }
    
    return true;
  } catch (error) {
    logger.error(GITEA, '删除仓库异常', { details: { error: error instanceof Error ? error.message : String(error) } });
    return false;
  }
}

/**
 * 从 Gitea 组织仓库克隆或拉取到本地 AgentHarness 目录
 * 如果本地目录已存在且有 .git，执行 git pull
 * 如果不存在，执行 git clone
 */
export async function cloneOrPullOrgRepo(
  repoName: string,
  branch: string = 'main'
): Promise<{ success: boolean; method: string; error?: string }> {
  if (!isConfigured()) {
    return { success: false, method: 'clone', error: 'Gitea 配置不完整' };
  }

  const localPath = join(process.cwd(), AGENT_HARNESS_LOCAL_PATH, repoName);
  const gitDir = join(localPath, '.git');

  const isHttps = GITEA_ORG_URL.startsWith('https://');
  const giteaHost = GITEA_ORG_URL.replace(/^https?:\/\//, '');
  const protocol = isHttps ? 'https' : 'http';
  const repoUrl = `${protocol}://${GITEA_ORG_TOKEN}@${giteaHost}/${GITEA_ORG_NAME}/${repoName}.git`;

  process.env.GIT_SSL_NO_VERIFY = '1';

  if (existsSync(gitDir)) {
    const git: SimpleGit = simpleGit(localPath);

    try {
      await git.remote(['set-url', 'origin', repoUrl]);

      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      if (currentBranch.trim() !== branch) {
        try {
          await git.checkout(branch);
        } catch {
          await git.checkoutLocalBranch(branch);
        }
      }

      const result = await git.pull('origin', branch);
      const changes = result.summary?.changes || 0;

      logger.info(GITEA, `pull 成功: ${repoName} (${changes} 个变更)`);
      return { success: true, method: 'pull' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(GITEA, `pull 失败: ${repoName}`, { details: { error: errorMsg } });
      return { success: false, method: 'pull', error: errorMsg };
    }
  }

  try {
    await mkdir(join(process.cwd(), AGENT_HARNESS_LOCAL_PATH), { recursive: true });

    const git: SimpleGit = simpleGit();
    await git.clone(repoUrl, localPath, ['-b', branch]);

    logger.info(GITEA, `clone 成功: ${repoName} -> ${localPath}`);
    return { success: true, method: 'clone' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(GITEA, `clone 失败: ${repoName}`, { details: { error: errorMsg } });

    try {
      await rm(localPath, { recursive: true, force: true });
    } catch {
    }

    return { success: false, method: 'clone', error: errorMsg };
  }
}

/**
 * 批量同步所有 AgentApp 的 AgentHarness 从 Gitea 到本地
 * 遍历数据库中所有有 agentHarnessPath 的 AgentApp，逐个执行 cloneOrPullOrgRepo
 */
export async function syncAllAgentHarnessFromGitea(): Promise<{
  total: number;
  success: number;
  failed: number;
  errors: Array<{ repoName: string; error: string }>;
}> {
  if (!isConfigured()) {
    logger.warn(GITEA, '配置不完整，无法同步');
    return { total: 0, success: 0, failed: 0, errors: [{ repoName: '', error: 'Gitea 配置不完整' }] };
  }

  const { prisma } = await import('@/lib/prisma');

  const apps = await prisma.agentApp.findMany({
    select: { id: true, name: true, agentHarnessPath: true },
  });

  const appsWithHarness = apps.filter(app => app.agentHarnessPath);

  logger.info(GITEA, `开始同步 AgentHarness: ${appsWithHarness.length} 个仓库`);

  const results: Array<{ repoName: string; result: { success: boolean; method: string; error?: string } }> = [];
  const errors: Array<{ repoName: string; error: string }> = [];

  for (const app of appsWithHarness) {
    const repoName = app.agentHarnessPath!;
    logger.info(GITEA, `同步 ${app.name} (${repoName})...`);

    const repoExists = await checkOrgRepoExists(repoName);
    if (!repoExists) {
      logger.warn(GITEA, `远端仓库不存在: ${repoName}, 跳过`);
      errors.push({ repoName, error: '远端仓库不存在' });
      continue;
    }

    const result = await cloneOrPullOrgRepo(repoName);
    results.push({ repoName, result });

    if (!result.success) {
      errors.push({ repoName, error: result.error || '未知错误' });
    }
  }

  const successCount = results.filter(r => r.result.success).length;

  logger.info(GITEA, `同步完成: ${successCount}/${appsWithHarness.length} 成功`);

  return {
    total: appsWithHarness.length,
    success: successCount,
    failed: errors.length,
    errors,
  };
}

export function getRepoUrl(repoName: string): string {
  return `${GITEA_ORG_URL}/${GITEA_ORG_NAME}/${repoName}`;
}

export { isConfigured };