import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { testNfsConnection, getNfsConfig } from '@/lib/nfs-upload';

export async function GET(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    const connected = await testNfsConnection();
    const config = getNfsConfig();

    return NextResponse.json({
      connected,
      config: {
        mountPath: config?.mountPath || '',
      },
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: error instanceof Error ? error.message : 'NFS连接测试失败',
    });
  }
}