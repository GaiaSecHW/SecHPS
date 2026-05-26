import { prisma } from '@/lib/prisma';
import { writeFile, mkdir, rm, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import AdmZip from 'adm-zip';
import { serverLog } from '@/lib/server-log';

/**
 * 验证上传文件的目录结构是否符合 Agent 要求
 * 通过读取压缩包内的文件名列表（不读内容），调用模型判断
 */
export async function validateFileStructure(
  files: { name: string; buffer: Buffer }[],
  inputRequirements: string,
): Promise<{ valid: boolean; reason?: string }> {
  // 使用默认模型配置（isDefault=true，否则取第一个激活的）
  const defaultModel = await prisma.modelConfig.findFirst({
    where: { isDefault: true, isActive: true },
    select: { apiKey: true, apiBaseUrl: true, providerType: true, models: true },
  }) || await prisma.modelConfig.findFirst({
    where: { isActive: true },
    select: { apiKey: true, apiBaseUrl: true, providerType: true, models: true },
  });

  if (!defaultModel?.apiKey) {
    return { valid: true }; // 没有可用模型配置，跳过
  }

  const modelConfig = defaultModel;
  const modelName = (defaultModel.models as string).split(',')[0]?.trim();

  if (!modelConfig?.apiKey) {
    return { valid: true }; // 没有模型配置或 apiKey，跳过
  }

  // 3. 从 zip 中提取文件结构
  const fileTree = extractFileTree(files);
  if (fileTree === null) {
    return { valid: true }; // 非 zip 文件，跳过校验
  }
  if (fileTree === '') {
    return { valid: false, reason: '压缩包为空，没有任何文件' };
  }

  // 4. 调用模型判断
  const prompt = `以下是一个压缩包的文件结构：

${fileTree}

要求：${inputRequirements}

请判断该文件结构是否符合要求。只回答 YES 或 NO，然后简述原因（一句话即可）。`;

  try {
    const baseURL = modelConfig.apiBaseUrl || 'https://api.anthropic.com/v1';
    const isAnthropic = (baseURL as string).includes('anthropic') || modelConfig.providerType === 'anthropic';

    if (isAnthropic) {
      const resp = await fetch(`${baseURL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': modelConfig.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!resp.ok) {
        serverLog.error(`[FileValidation] 模型 API 返回错误 ${resp.status}，跳过校验`);
        return { valid: true };
      }
      const data = await resp.json();
      const text = data.content?.[0]?.text || '';
      return parseValidationResponse(stripThinkTags(text));
    }

    // OpenAI 兼容格式
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${modelConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      serverLog.error(`[FileValidation] 模型 API 返回错误 ${resp.status}，跳过校验`);
      return { valid: true };
    }
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    return parseValidationResponse(stripThinkTags(text));
  } catch (error) {
    serverLog.error('[FileValidation] 模型调用失败，跳过校验:', error);
    return { valid: true }; // 模型调用失败，跳过校验
  }
}

function extractFileTree(files: { name: string; buffer: Buffer }[]): string | null {
  const zipFile = files.find(f => f.name.toLowerCase().endsWith('.zip'));
  if (!zipFile) return null;

  try {
    const zip = new AdmZip(zipFile.buffer);
    const entries = zip.getEntries();
    const lines = entries
      .filter(e => !e.isDirectory)
      .map(e => e.entryName)
      .sort();

    return lines.join('\n');
  } catch {
    return null;
  }
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function parseValidationResponse(text: string): { valid: boolean; reason?: string } {
  const upper = text.toUpperCase().trim();
  if (upper.startsWith('YES')) {
    return { valid: true };
  }
  const reason = text.replace(/^YES\s*|^NO\s*/i, '').trim();
  return { valid: false, reason: reason || '文件结构不符合要求' };
}

/**
 * 递归拷贝目录
 */
async function copyDirectoryRecursive(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else {
      const content = await readFile(srcPath);
      await writeFile(destPath, content);
    }
  }
}

export async function copyAgentHarnessFromLocal(repoName: string, destDir: string): Promise<boolean> {
  const agentHarnessBase = process.env.AGENT_HARNESS_LOCAL_PATH || './AgentHarness';
  const sourceDir = join(process.cwd(), agentHarnessBase, repoName);

  // 始终先从 Gitea 拉取最新版本，确保本地缓存不陈旧
  const { cloneOrPullOrgRepo, isConfigured } = await import('@/lib/gitea-org-repo');
  if (isConfigured()) {
    const syncResult = await cloneOrPullOrgRepo(repoName);
    if (syncResult.success) {
      serverLog.info(`[TaskCreation] AgentHarness 同步成功: ${repoName} (${syncResult.method})`);
    } else if (existsSync(sourceDir)) {
      serverLog.warn(`[TaskCreation] AgentHarness 拉取失败，降级使用本地缓存: ${syncResult.error}`);
    } else {
      serverLog.error(`[TaskCreation] AgentHarness 拉取失败且无本地缓存: ${syncResult.error}`);
      return false;
    }
  } else if (!existsSync(sourceDir)) {
    serverLog.info(`[TaskCreation] Gitea 未配置，本地 AgentHarness 目录不存在`);
    return false;
  }

  try {
    await copyDirectoryRecursive(sourceDir, destDir);
    serverLog.info(`[TaskCreation] 从本地拷贝 AgentHarness 完成: ${repoName} -> ${destDir}`);
    return true;
  } catch (error) {
    serverLog.error(`[TaskCreation] 拷贝 AgentHarness 失败:`, error);
    return false;
  }
}

const SHARED_WORKSPACE_BASE = process.env.NFS_MOUNT_PATH || process.env.SHARED_WORKSPACE_PATH || '/data/shared-workspace';

interface CreateTaskParams {
  taskId: string;
  userId: string;
  tenantId?: string | null;
  isPublic?: boolean;
  agentId: string;
  agentName: string;
  name: string;
  notes: string;
  modelId?: string | null;
  modelName?: string | null;
  parameters?: string;
  skills?: string | null;
  scripts?: string | null;
  targetProduct?: string | null;
  files?: { name: string; buffer: Buffer }[] | null;
}

interface CreateTaskResult {
  task: {
    id: string;
    name: string;
    status: string;
    filePath?: string | null;
    projectPath?: string | null;
    createdAt: Date;
  };
}

export async function createTaskWithFiles(params: CreateTaskParams): Promise<CreateTaskResult> {
  const {
    taskId,
    userId,
    tenantId,
    isPublic = false,
    agentId,
    agentName,
    name,
    notes,
    modelId,
    modelName,
    parameters = '{}',
    skills,
    scripts,
    targetProduct,
    files,
  } = params;

  const taskDir = join(SHARED_WORKSPACE_BASE, taskId);
  await mkdir(taskDir, { recursive: true });

  // 获取 Agent 信息
  const agent = await prisma.agentApp.findUnique({
    where: { id: agentId },
    select: { agentHarnessPath: true, inputRequirements: true },
  });

  // 检查 Agent 是否有文件结构要求，有则校验
  if (files && files.length > 0 && agent?.inputRequirements) {
    const validation = await validateFileStructure(files, agent.inputRequirements);
    if (!validation.valid) {
      throw new Error(`文件结构校验失败: ${validation.reason || '不符合 Agent 要求'}`);
    }
    serverLog.info(`[TaskCreation] 文件结构校验通过`);
  }

  let filePath: string | null = null;
  let projectPath: string | null = null;

  if (files && files.length > 0) {
    for (const file of files) {
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.zip')) {
        serverLog.info(`[TaskCreation] 检测到压缩文件 ${file.name}，开始解压`);
        const zip = new AdmZip(file.buffer);
        const zipEntries = zip.getEntries();

        for (const entry of zipEntries) {
          if (!entry.isDirectory) {
            const entryPath = join(taskDir, entry.entryName);
            const entryDir = join(taskDir, entry.entryName.split('/').slice(0, -1).join('/'));
            if (entry.entryName.includes('/')) {
              await mkdir(entryDir, { recursive: true });
            }
            await writeFile(entryPath, entry.getData());
            serverLog.info(`[TaskCreation] 解压文件: ${entryPath}`);
          }
        }
        serverLog.info(`[TaskCreation] 解压完成，已解压 ${zipEntries.filter(e => !e.isDirectory).length} 个文件`);
      } else {
        const destPath = join(taskDir, file.name);
        await writeFile(destPath, file.buffer);
        filePath = destPath;
        serverLog.info(`[TaskCreation] 写入上传文件: ${destPath}`);
      }
    }
  }

  projectPath = taskDir;

  const task = await prisma.taskInstance.create({
    data: {
      id: taskId,
      userId,
      tenantId,
      name,
      agentId,
      agentName,
      modelId,
      modelName,
      parameters,
      filePath,
      projectPath,
      skills,
      scripts,
      targetProduct,
      notes,
      status: 'pending',
      isPublic,
      updatedAt: new Date(),
    },
  });

  return {
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      filePath: task.filePath,
      projectPath: task.projectPath,
      createdAt: task.createdAt,
    },
  };
}

export async function cleanupTaskDirectory(taskId: string): Promise<void> {
  const taskDir = join(SHARED_WORKSPACE_BASE, taskId);
  if (existsSync(taskDir)) {
    await rm(taskDir, { recursive: true, force: true });
    serverLog.info(`[TaskCreation] 清理任务目录: ${taskDir}`);
  }
}