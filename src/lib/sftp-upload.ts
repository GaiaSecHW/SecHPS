import SftpClient from 'ssh2-sftp-client';
import { Client as SSHClient, type ClientChannel, type ConnectConfig } from 'ssh2';
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

interface GiteaFile {
  path: string;
  content: Buffer;
  size: number;
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

const ARCHIVE_EXTENSIONS = ['.zip', '.tar', '.tar.gz', '.tgz', '.gz'];

function isArchiveFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return ARCHIVE_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

function executeSSHCommand(config: SftpConfig, command: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const conn = new SSHClient();

    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 30000,
    };

    if (config.password) {
      connectConfig.password = config.password;
    }
    if (config.privateKey) {
      connectConfig.privateKey = config.privateKey;
    }

    conn.on('ready', () => {
      conn.exec(command, (err: Error | null, stream: ClientChannel) => {
        if (err) {
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }

        let stderrOutput = '';

        stream.on('close', (code: number) => {
          conn.end();
          if (code === 0) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: stderrOutput || `命令执行失败，退出码: ${code}` });
          }
        });

        stream.on('data', () => {});

        stream.stderr.on('data', (data: Buffer) => {
          stderrOutput += data.toString();
        });
      });
    });

    conn.on('error', (err: Error) => {
      resolve({ success: false, error: err.message });
    });

    conn.connect(connectConfig);
  });
}

export async function uploadAndExtractArchive(
  taskId: string,
  fileName: string,
  fileBuffer: Buffer
): Promise<{ remoteFilePath: string; remoteDirPath: string; extracted: boolean }> {
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

    const isArchive = isArchiveFile(fileName);
    let extracted = false;

    if (isArchive) {
      let extractCommand: string;
      const lowerName = fileName.toLowerCase();

      if (lowerName.endsWith('.zip')) {
        extractCommand = `cd "${remoteDirPath}" && (command -v unzip >/dev/null 2>&1 && unzip -o "${fileName}" || python3 -c "import zipfile; zipfile.ZipFile('${fileName}').extractall('.')") && rm -f "${fileName}"`;
      } else if (lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz')) {
        extractCommand = `cd "${remoteDirPath}" && (command -v tar >/dev/null 2>&1 && tar -xzf "${fileName}" || python3 -c "import tarfile; tarfile.open('${fileName}').extractall('.')") && rm -f "${fileName}"`;
      } else if (lowerName.endsWith('.tar')) {
        extractCommand = `cd "${remoteDirPath}" && (command -v tar >/dev/null 2>&1 && tar -xf "${fileName}" || python3 -c "import tarfile; tarfile.open('${fileName}').extractall('.')") && rm -f "${fileName}"`;
      } else if (lowerName.endsWith('.gz') && !lowerName.endsWith('.tar.gz')) {
        const outputName = fileName.replace(/\.gz$/i, '');
        extractCommand = `cd "${remoteDirPath}" && (command -v gunzip >/dev/null 2>&1 && gunzip -f "${fileName}" || python3 -c "import gzip; open('${outputName}','wb').write(gzip.open('${fileName}').read())"; rm -f "${fileName}")`;
      } else {
        throw new Error(`不支持的压缩文件格式: ${fileName}`);
      }

      const result = await executeSSHCommand(config, extractCommand);

      if (!result.success) {
        throw new Error(`解压失败: ${result.error || '未知错误'}`);
      }

      extracted = true;
      console.log(`Archive extracted and original file deleted: ${fileName}`);
    }

    return {
      remoteFilePath: isArchive ? remoteDirPath : remoteFilePath,
      remoteDirPath,
      extracted,
    };
  } finally {
    await sftp.end();
  }
}

export async function uploadFilesToRemote(
  taskId: string,
  files: GiteaFile[],
  targetSubDir?: string
): Promise<{ uploadedCount: number; remoteDirPath: string }> {
  const config = getSftpConfig();

  if (!config) {
    throw new Error('SFTP configuration is incomplete. Please check environment variables.');
  }

  if (files.length === 0) {
    return { uploadedCount: 0, remoteDirPath: '' };
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

    const remoteDirPath = targetSubDir 
      ? `${config.remotePath}/${taskId}/${targetSubDir}`
      : `${config.remotePath}/${taskId}`;

    await sftp.mkdir(remoteDirPath, true);

    let uploadedCount = 0;

    for (const file of files) {
      const remoteFilePath = `${remoteDirPath}/${file.path}`;
      
      const parentDir = path.dirname(remoteFilePath);
      await sftp.mkdir(parentDir, true);

      try {
        await sftp.put(file.content, remoteFilePath);
        uploadedCount++;
        console.log(`[SFTP] 上传文件成功: ${file.path}`);
      } catch (uploadError) {
        console.error(`[SFTP] 上传文件失败: ${file.path}`, uploadError);
      }
    }

    console.log(`[SFTP] 共上传 ${uploadedCount}/${files.length} 个文件到 ${remoteDirPath}`);
    return { uploadedCount, remoteDirPath };
  } finally {
    await sftp.end();
  }
}