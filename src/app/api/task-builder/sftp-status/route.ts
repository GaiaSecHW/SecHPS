import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { testSftpConnection } from '@/lib/sftp-upload';

export async function GET(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    const connected = await testSftpConnection();
    
    const config = {
      host: process.env.SFTP_HOST || '',
      port: process.env.SFTP_PORT || '22',
      username: process.env.SFTP_USER || '',
      remotePath: process.env.SFTP_REMOTE_PATH || '',
      hasPassword: !!process.env.SFTP_PASSWORD,
      hasPrivateKey: !!process.env.SFTP_PRIVATE_KEY_PATH,
    };

    return NextResponse.json({
      connected,
      config: {
        host: config.host,
        port: config.port,
        username: config.username,
        remotePath: config.remotePath,
        hasPassword: config.hasPassword,
        hasPrivateKey: config.hasPrivateKey,
      },
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: error instanceof Error ? error.message : 'SFTP连接测试失败',
    });
  }
}