import { NextRequest } from 'next/server';
import { authenticateApiKey, apiKeyAuthErrorResponse } from '@/lib/api-key-auth';
import type { ApiKeyAuthSuccess } from '@/lib/api-key-auth';
import { prisma } from '@/lib/prisma';
import { notFound, internalError } from '@/lib/api-errors';
import SftpClient from 'ssh2-sftp-client';
import * as fs from 'fs';
import { logger, LOG_MODULES } from '@/lib/logger';

function getSftpConfig() {
  const host = process.env.SFTP_HOST;
  const port = parseInt(process.env.SFTP_PORT || '22');
  const username = process.env.SFTP_USER;
  const password = process.env.SFTP_PASSWORD;
  const privateKeyPath = process.env.SFTP_PRIVATE_KEY_PATH;
  const remotePath = process.env.SFTP_REMOTE_PATH;

  if (!host || !username || !remotePath) return null;

  let privateKey: string | undefined;
  if (privateKeyPath && fs.existsSync(privateKeyPath)) {
    privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
  }

  return { host, port, username, password, privateKey, remotePath };
}

const CONTENT_TYPE_MAP: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function getContentType(reportPath: string): string {
  const ext = reportPath.toLowerCase().split('.').pop();
  if (ext && CONTENT_TYPE_MAP['.' + ext]) {
    return CONTENT_TYPE_MAP['.' + ext];
  }
  return 'application/octet-stream';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = await authenticateApiKey(request);
  if (!auth.success) return apiKeyAuthErrorResponse(auth);
  const { apiKey } = auth as ApiKeyAuthSuccess;

  const { taskId } = await params;

  const task = await prisma.taskInstance.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      reportPath: true,
      tenantId: true,
    },
  });

  if (!task) {
    return notFound('Task not found');
  }

  if (task.tenantId !== apiKey.tenantId) {
    return notFound('Task not found');
  }

  if (!task.reportPath) {
    return notFound('No report available');
  }

  const config = getSftpConfig();
  if (!config) {
    return internalError('SFTP configuration not available');
  }

  const sftp = new SftpClient();

  try {
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
    });

    const data = await sftp.get(task.reportPath, undefined as any);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as string);

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': getContentType(task.reportPath),
      },
    });
  } catch (error) {
    logger.error(LOG_MODULES.CODE, 'Failed to read report from SFTP', { details: { error: error instanceof Error ? error.message : String(error) } });
    return internalError('Failed to retrieve report');
  } finally {
    await sftp.end();
  }
}
