import { prisma } from '@/lib/prisma';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import AdmZip from 'adm-zip';
import { downloadAgentHarness } from '@/lib/minio-client';

/**
 * 验证上传文件的目录结构是否符合 Agent 要求
 * 通过读取压缩包内的文件名列表（不读内容），调用模型判断
 */
export async function validateFileStructure(
  files: { name: string; buffer: Buffer }[],
  inputRequirements: string,
): Promise<{ valid: boolean; reason?: string }> {
  // 1. 获取系统配置的校验模型
  const activeConfig = await prisma.opencodeConfig.findFirst({
    where: { isActive: true },
    select: { fileValidationModel: true },
  });

  if (!activeConfig?.fileValidationModel) {
    return { valid: true }; // 没配置校验模型，跳过
  }

  const [configId, modelName] = activeConfig.fileValidationModel.split('::');
  if (!configId || !modelName) {
    return { valid: true }; // 格式不对，跳过
  }

  // 2. 获取模型配置和 apiKey
  const modelConfig = await prisma.modelConfig.findUnique({
    where: { id: configId },
    select: { apiKey: true, baseURL: true, providerType: true },
  });

  if (!modelConfig?.apiKey) {
    return { valid: true }; // 没有模型配置或 apiKey，跳过
  }

  // 3. 从 zip 中提取文件结构
  const fileTree = extractFileTree(files);
  if (!fileTree) {
    return { valid: true }; // 非 zip 文件，跳过校验
  }

  // 4. 调用模型判断
  const prompt = `以下是一个压缩包的文件结构：

${fileTree}

要求：${inputRequirements}

请判断该文件结构是否符合要求。只回答 YES 或 NO，然后简述原因（一句话即可）。`;

  try {
    const baseURL = modelConfig.baseURL || 'https://api.anthropic.com/v1';
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
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await resp.json();
      const text = data.content?.[0]?.text || '';
      return parseValidationResponse(text);
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
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    return parseValidationResponse(text);
  } catch (error) {
    console.error('[FileValidation] 模型调用失败，跳过校验:', error);
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

function parseValidationResponse(text: string): { valid: boolean; reason?: string } {
  const upper = text.toUpperCase().trim();
  if (upper.startsWith('YES')) {
    return { valid: true };
  }
  const reason = text.replace(/^YES\s*|^NO\s*/i, '').trim();
  return { valid: false, reason: reason || '文件结构不符合要求' };
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

  // 检查 Agent 是否有文件结构要求，有则校验
  if (files && files.length > 0) {
    const agent = await prisma.agentApp.findUnique({
      where: { id: agentId },
      select: { inputRequirements: true },
    });

    if (agent?.inputRequirements) {
      const validation = await validateFileStructure(files, agent.inputRequirements);
      if (!validation.valid) {
        throw new Error(`文件结构校验失败: ${validation.reason || '不符合 Agent 要求'}`);
      }
      console.log(`[TaskCreation] 文件结构校验通过`);
    }
  }

  let filePath: string | null = null;
  let projectPath: string | null = null;

  try {
    console.log(`[TaskCreation] 开始为任务 ${taskId} 从 MinIO 拉取 AgentHarness (${agentId})`);
    const rootDir = await downloadAgentHarness(agentId, taskDir);

    if (rootDir) {
      console.log(`[TaskCreation] 从 MinIO 拉取完成，根目录: ${rootDir}`);
    } else {
      console.log(`[TaskCreation] MinIO 未找到 AgentHarness 文件，继续处理上传文件`);
    }
  } catch (downloadError) {
    console.error(`[TaskCreation] 从 MinIO 拉取文件失败:`, downloadError);
  }

  if (files && files.length > 0) {
    for (const file of files) {
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.zip')) {
        console.log(`[TaskCreation] 检测到压缩文件 ${file.name}，开始解压`);
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
            console.log(`[TaskCreation] 解压文件: ${entryPath}`);
          }
        }
        console.log(`[TaskCreation] 解压完成，已解压 ${zipEntries.filter(e => !e.isDirectory).length} 个文件`);
      } else {
        const destPath = join(taskDir, file.name);
        await writeFile(destPath, file.buffer);
        filePath = destPath;
        console.log(`[TaskCreation] 写入上传文件: ${destPath}`);
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
    console.log(`[TaskCreation] 清理任务目录: ${taskDir}`);
  }
}