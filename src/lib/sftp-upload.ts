import SftpClient from 'ssh2-sftp-client';
import * as fs from 'fs';
import * as path from 'path';

interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  remotePath: string;
}

function getSftpConfig(): SftpConfig | null {
  const host = process.env.SFTP_HOST;
  const port = parseInt(process.env.SFTP_PORT || '22');
  const username = process.env.SFTP_USER;
  const password = process.env.SFTP_PASSWORD;
  const privateKeyPath = process.env.SFTP_PRIVATE_KEY_PATH;
  const remotePath = process.env.SFTP_REMOTE_PATH;

  if (!host || !username || !remotePath) {
    console.warn('SFTP configuration incomplete');
    return null;
  }

  let privateKey: string | undefined;
  if (privateKeyPath && fs.existsSync(privateKeyPath)) {
    privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
  }

  return {
    host,
    port,
    username,
    password,
    privateKey,
    remotePath,
  };
}

export async function uploadFileToRemote(
  taskId: string,
  fileName: string,
  fileBuffer: Buffer
): Promise<{ remoteFilePath: string; remoteDirPath: string }> {
  const config = getSftpConfig();

  if (!config) {
    throw new Error('SFTP configuration is incomplete. Please check environment variables.');
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

    const remoteDirPath = `${config.remotePath}/${taskId}`;
    const remoteFilePath = `${remoteDirPath}/${fileName}`;

    await sftp.mkdir(remoteDirPath, true);

    await sftp.put(fileBuffer, remoteFilePath);

    return {
      remoteFilePath,
      remoteDirPath,
    };
  } finally {
    await sftp.end();
  }
}

export async function testSftpConnection(): Promise<boolean> {
  const config = getSftpConfig();

  if (!config) {
    return false;
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

    await sftp.list(config.remotePath);
    return true;
  } catch (error) {
    console.error('SFTP connection test failed:', error);
    return false;
  } finally {
    await sftp.end();
  }
}

export async function checkRemotePathExists(remotePath: string): Promise<boolean> {
  const config = getSftpConfig();

  if (!config) {
    return false;
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

    const exists = await sftp.exists(remotePath);
    return exists !== false;
  } catch {
    return false;
  } finally {
    await sftp.end();
  }
}