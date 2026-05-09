/**
 * Gitea API 服务
 * 用于将 AgentHarness 文件上传到 Gitea 仓库
 */

interface GiteaConfig {
  url: string;
  token: string;
  repoOwner: string;
  repoName: string;
  branch: string;
}

interface FileUploadResult {
  path: string;
  sha: string;
  url: string;
}

function getGiteaConfig(): GiteaConfig | null {
  const url = process.env.GITEA_URL;
  const token = process.env.GITEA_TOKEN;
  const repoOwner = process.env.GITEA_REPO_OWNER;
  const repoName = process.env.GITEA_REPO_NAME || 'agent-apps';
  const branch = process.env.GITEA_BRANCH || 'main';

  if (!url || !token || !repoOwner) {
    console.warn('[Gitea] 配置不完整，跳过 Gitea 上传');
    return null;
  }

  return { url, token, repoOwner, repoName, branch };
}

async function getFileContent(
  config: GiteaConfig,
  filePath: string
): Promise<{ content: string; sha: string } | null> {
  const url = `${config.url}/api/v1/repos/${config.repoOwner}/${config.repoName}/contents/${filePath}?ref=${config.branch}`;
  
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${config.token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`获取文件失败: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    content: data.content,
    sha: data.sha,
  };
}

export async function uploadFileToGitea(
  appId: string,
  fileName: string,
  fileContent: Buffer | string,
  isBase64: boolean = false
): Promise<FileUploadResult | null> {
  const config = getGiteaConfig();
  if (!config) {
    console.log('[Gitea] 配置不完整，文件未上传到 Gitea');
    return null;
  }

  const filePath = `${appId}/${fileName}`;
  const apiUrl = `${config.url}/api/v1/repos/${config.repoOwner}/${config.repoName}/contents/${filePath}`;

  const content = isBase64 
    ? fileContent.toString() 
    : Buffer.isBuffer(fileContent) 
      ? fileContent.toString('base64') 
      : Buffer.from(fileContent).toString('base64');

  const existingFile = await getFileContent(config, filePath);

  const body = {
    message: existingFile 
      ? `Update AgentHarness for app ${appId}` 
      : `Add AgentHarness for app ${appId}`,
    content: content,
    branch: config.branch,
    ...(existingFile && { sha: existingFile.sha }),
  };

  const method = existingFile ? 'PUT' : 'POST';

  const response = await fetch(apiUrl, {
    method,
    headers: {
      Authorization: `token ${config.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`上传文件失败: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  console.log(`[Gitea] 文件上传成功: ${filePath}`);

  return {
    path: filePath,
    sha: data.content.sha,
    url: `${config.url}/${config.repoOwner}/${config.repoName}/src/branch/${config.branch}/${filePath}`,
  };
}

export async function uploadMultipleFilesToGitea(
  appId: string,
  files: Array<{ name: string; content: Buffer | string; isBase64?: boolean }>
): Promise<FileUploadResult[]> {
  const results: FileUploadResult[] = [];

  for (const file of files) {
    try {
      const result = await uploadFileToGitea(appId, file.name, file.content, file.isBase64);
      if (result) {
        results.push(result);
      }
    } catch (error) {
      console.error(`[Gitea] 上传文件 ${file.name} 失败:`, error);
    }
  }

  return results;
}

export async function deleteFileFromGitea(
  appId: string,
  fileName?: string
): Promise<boolean> {
  const config = getGiteaConfig();
  if (!config) {
    return false;
  }

  const filePath = fileName 
    ? `${appId}/${fileName}` 
    : `${appId}`;

  try {
    if (fileName) {
      const existingFile = await getFileContent(config, filePath);
      if (!existingFile) {
        console.log(`[Gitea] 文件不存在: ${filePath}`);
        return true;
      }

      const apiUrl = `${config.url}/api/v1/repos/${config.repoOwner}/${config.repoName}/contents/${filePath}`;
      
      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `token ${config.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Delete AgentHarness file for app ${appId}`,
          sha: existingFile.sha,
          branch: config.branch,
        }),
      });

      if (!response.ok) {
        throw new Error(`删除文件失败: ${response.status}`);
      }

      console.log(`[Gitea] 文件删除成功: ${filePath}`);
    } else {
      console.log(`[Gitea] 目录删除需要逐个删除文件: ${appId}`);
    }

    return true;
  } catch (error) {
    console.error(`[Gitea] 删除失败:`, error);
    return false;
  }
}

export function getGiteaRepoUrl(): string | null {
  const config = getGiteaConfig();
  if (!config) {
    return null;
  }
  return `${config.url}/${config.repoOwner}/${config.repoName}`;
}

export function isGiteaConfigured(): boolean {
  const config = getGiteaConfig();
  return config !== null;
}

export type { GiteaConfig, FileUploadResult };