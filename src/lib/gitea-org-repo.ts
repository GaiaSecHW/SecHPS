/**
 * Gitea 组织仓库服务
 * 用于在指定组织下创建和管理 AgentHarness 仓库
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

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

export async function checkOrgRepoExists(repoName: string): Promise<boolean> {
  if (!isConfigured()) {
    console.warn('[GiteaOrg] 配置不完整');
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
    
    console.error(`[GiteaOrg] 检查仓库失败: ${response.status}`);
    return false;
  } catch (error) {
    console.error('[GiteaOrg] 检查仓库异常:', error);
    return false;
  }
}

export async function createOrgRepo(repoName: string): Promise<GiteaRepoInfo | null> {
  if (!isConfigured()) {
    console.warn('[GiteaOrg] 配置不完整，无法创建仓库');
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
    console.log(`[GiteaOrg] 仓库创建成功: ${data.full_name}`);
    
    return {
      name: data.name,
      full_name: data.full_name,
      html_url: data.html_url,
    };
  } catch (error) {
    console.error('[GiteaOrg] 创建仓库异常:', error);
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
  const agentHarnessRoot = join(process.cwd(), AGENT_HARNESS_LOCAL_PATH);
  const gitFileInRoot = join(agentHarnessRoot, '.git');
  
  if (!existsSync(gitFileInRoot)) {
    await mkdir(agentHarnessRoot, { recursive: true });
    await writeFile(gitFileInRoot, 'gitdir: ../.git/modules/AgentHarness\n');
  }
  
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
  
  console.log(`[GiteaOrg] 本地文件写入完成: ${localPath} (${cleanedFiles.size} 个文件)`);
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
      console.log(`[GiteaOrg] fetch 失败（可能仓库刚创建），将直接 push: ${fetchError}`);
    }

    let remoteBranch = 'main';
    try {
      const remote = await git.remote(['show', 'origin']);
      const headBranchMatch = remote.match(/HEAD branch:\s*(\S+)/);
      if (headBranchMatch && headBranchMatch[1]) {
        remoteBranch = headBranchMatch[1];
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
    
    console.log(`[GiteaOrg] Git status: ${localPath}, files: ${status.files.length}, staged: ${status.staged.length}`);
    
    if (status.files.length === 0) {
      console.log(`[GiteaOrg] 无变更需要提交: ${repoName}`);
      return { success: true, method: 'git' };
    }

    await git.commit(`Add AgentHarness for ${repoName}`);
    
    try {
      await git.push('origin', remoteBranch, { '--set-upstream': null });
    } catch (pushError) {
      console.log(`[GiteaOrg] 正常 push 失败，尝试 force push: ${pushError}`);
      await git.push('origin', remoteBranch, { '--force': null, '--set-upstream': null });
    }

    console.log(`[GiteaOrg] Git push 成功: ${repoName} (${status.files.length} 个文件)`);
    return { success: true, method: 'git' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[GiteaOrg] Git push 失败: ${repoName} - ${errorMsg}`);
    return { success: false, method: 'git', error: errorMsg };
  }
}

export async function uploadFilesToOrgRepo(
  repoName: string,
  files: Map<string, Buffer>
): Promise<FileUploadResult[]> {
  if (!isConfigured()) {
    console.warn('[GiteaOrg] 配置不完整，无法上传文件');
    return [];
  }

  if (files.size === 0) {
    console.log('[GiteaOrg] 无文件需要上传');
    return [];
  }

  const cleanedFiles = removeCommonPrefix(files);
  const results: FileUploadResult[] = [];
  const branch = 'main';

  for (const [relativePath, content] of cleanedFiles) {
    const filePath = relativePath.replace(/^\/+/, '');
    const apiUrl = `${GITEA_ORG_URL}/api/v1/repos/${GITEA_ORG_NAME}/${repoName}/contents/${filePath}`;
    
    const encodedContent = content.toString('base64');
    
    let existingFile: { sha: string } | null = null;
    try {
      const checkResponse = await fetchWithTimeout(`${apiUrl}?ref=${branch}`, {
        headers: {
          Authorization: `token ${GITEA_ORG_TOKEN}`,
          Accept: 'application/json',
        },
      });
      
      if (checkResponse.ok) {
        const data = await checkResponse.json();
        existingFile = { sha: data.sha };
      }
    } catch {
      existingFile = null;
    }

    const body = {
      message: existingFile 
        ? `Update ${filePath}` 
        : `Add ${filePath}`,
      content: encodedContent,
      branch: branch,
      ...(existingFile && { sha: existingFile.sha }),
    };

    const method = existingFile ? 'PUT' : 'POST';

    try {
      const response = await fetchWithTimeout(apiUrl, {
        method,
        headers: {
          Authorization: `token ${GITEA_ORG_TOKEN}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[GiteaOrg] 上传文件失败: ${filePath} - ${errorText}`);
        continue;
      }

      const data = await response.json();
      console.log(`[GiteaOrg] 文件上传成功: ${filePath}`);
      
      results.push({
        path: filePath,
        sha: data.content?.sha || data.sha,
        url: `${GITEA_ORG_URL}/${GITEA_ORG_NAME}/${repoName}/src/branch/${branch}/${filePath}`,
      });
    } catch (error) {
      console.error(`[GiteaOrg] 上传文件异常: ${filePath}`, error);
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`[GiteaOrg] 共上传 ${results.length}/${cleanedFiles.size} 个文件`);
  return results;
}

export async function pushOrUpdateOrgRepo(
  repoName: string,
  files: Map<string, Buffer>
): Promise<{ success: boolean; method: string }> {
  const gitResult = await pushToOrgRepoViaGit(repoName, files);
  
  if (gitResult.success) {
    return { success: true, method: 'git' };
  }
  
  console.log(`[GiteaOrg] Git 方式失败，回退到 API 上传: ${gitResult.error}`);
  
  const apiResults = await uploadFilesToOrgRepo(repoName, files);
  
  if (apiResults.length === files.size) {
    return { success: true, method: 'api' };
  }
  
  return { success: false, method: 'api' };
}

export async function deleteOrgRepo(repoName: string): Promise<boolean> {
  if (!isConfigured()) {
    console.warn('[GiteaOrg] 配置不完整，无法删除仓库');
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
      console.log(`[GiteaOrg] 仓库不存在: ${repoName}`);
      return true;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`删除仓库失败: ${response.status} - ${errorText}`);
    }

    console.log(`[GiteaOrg] 仓库删除成功: ${repoName}`);
    
    const localPath = join(process.cwd(), AGENT_HARNESS_LOCAL_PATH, repoName);
    try {
      await rm(localPath, { recursive: true, force: true });
      console.log(`[GiteaOrg] 本地目录删除成功: ${localPath}`);
    } catch (rmError) {
      console.warn(`[GiteaOrg] 本地目录删除失败: ${localPath}`, rmError);
    }
    
    return true;
  } catch (error) {
    console.error('[GiteaOrg] 删除仓库异常:', error);
    return false;
  }
}

export function getRepoUrl(repoName: string): string {
  return `${GITEA_ORG_URL}/${GITEA_ORG_NAME}/${repoName}`;
}

export { isConfigured };