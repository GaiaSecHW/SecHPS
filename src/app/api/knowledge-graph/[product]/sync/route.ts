import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import * as Minio from 'minio';
import os from 'os';
import path from 'path';
import fs from 'fs';

const KG_BUCKET = 'codedmap-dbs';
const CACHE_DIR = path.join(os.tmpdir(), 'kg_cache');

function getMinioClient() {
  return new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || '172.31.23.181',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ product: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { product } = await params;
  const decoded = decodeURIComponent(product);
  const safeName = decoded.replace(/[^a-zA-Z0-9]/g, '_');
  const dbPath = path.join(CACHE_DIR, `${safeName}_graph.db`);

  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: 'Local DB not found, load the product first' }, { status: 404 });
  }

  const client = getMinioClient();
  await client.fPutObject(KG_BUCKET, `dbs/${decoded}/graph.db`, dbPath);

  return NextResponse.json({ ok: true });
}
