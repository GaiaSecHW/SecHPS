import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import * as Minio from 'minio';

const KG_BUCKET = 'codedmap-dbs';

function getMinioClient() {
  return new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || '172.31.23.181',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  });
}

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    const client = getMinioClient();
    const products: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const stream = client.listObjects(KG_BUCKET, 'dbs/', false);
      stream.on('data', (item: any) => {
        if (item.prefix) {
          const name = item.prefix.replace('dbs/', '').replace(/\/$/, '').trim();
          if (name) products.push(name);
        }
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    return NextResponse.json({ products });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
