import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const SHARED_WORKSPACE_BASE = process.env.SHARED_WORKSPACE_PATH || '/data/shared-workspace';

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

  let filePath: string | null = null;

  if (files && files.length > 0) {
    const taskDir = join(SHARED_WORKSPACE_BASE, 'tasks', taskId);
    await mkdir(taskDir, { recursive: true });

    for (const file of files) {
      const destPath = join(taskDir, file.name);
      await writeFile(destPath, file.buffer);
      if (!filePath) {
        filePath = destPath;
      }
    }
  }

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
      createdAt: task.createdAt,
    },
  };
}