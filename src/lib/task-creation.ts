import { prisma } from '@/lib/prisma';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import AdmZip from 'adm-zip';
import { downloadFilesFromGitea } from '@/lib/gitea';

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
    files,
  } = params;

  const taskDir = join(SHARED_WORKSPACE_BASE, taskId);
  await mkdir(taskDir, { recursive: true });

  let filePath: string | null = null;
  let projectPath: string | null = null;

  let giteaRootDir: string | null = null;

  try {
    console.log(`[TaskCreation] 开始为任务 ${taskId} 从 Gitea 拉取 AgentHarness (${agentId})`);
    const giteaFiles = await downloadFilesFromGitea(agentId);

    if (giteaFiles.length > 0) {
      console.log(`[TaskCreation] 从 Gitea 拉取了 ${giteaFiles.length} 个文件`);
      for (const giteaFile of giteaFiles) {
        const destPath = join(taskDir, giteaFile.path);
        const destDir = join(taskDir, giteaFile.path.split('/').slice(0, -1).join('/'));
        if (giteaFile.path.includes('/')) {
          await mkdir(destDir, { recursive: true });
        }
        await writeFile(destPath, giteaFile.content);
        console.log(`[TaskCreation] 写入文件: ${destPath}`);
        
        if (!giteaRootDir && giteaFile.path.includes('/')) {
          giteaRootDir = giteaFile.path.split('/')[0];
        }
      }
      projectPath = taskDir;
    } else {
      console.log(`[TaskCreation] Gitea 未找到 AgentHarness 文件，继续处理上传文件`);
    }
  } catch (giteaError) {
    console.error(`[TaskCreation] 从 Gitea 拉取文件失败:`, giteaError);
  }

  if (files && files.length > 0) {
    const uploadBaseDir = giteaRootDir ? join(taskDir, giteaRootDir) : taskDir;
    
    for (const file of files) {
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.zip')) {
        console.log(`[TaskCreation] 检测到压缩文件 ${file.name}，开始解压`);
        const zip = new AdmZip(file.buffer);
        const zipEntries = zip.getEntries();

        for (const entry of zipEntries) {
          if (!entry.isDirectory) {
            const entryPath = join(uploadBaseDir, entry.entryName);
            const entryDir = join(uploadBaseDir, entry.entryName.split('/').slice(0, -1).join('/'));
            if (entry.entryName.includes('/')) {
              await mkdir(entryDir, { recursive: true });
            }
            await writeFile(entryPath, entry.getData());
            console.log(`[TaskCreation] 解压文件: ${entryPath}`);
          }
        }
        console.log(`[TaskCreation] 解压完成，已解压 ${zipEntries.filter(e => !e.isDirectory).length} 个文件`);
      } else {
        const destPath = join(uploadBaseDir, file.name);
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