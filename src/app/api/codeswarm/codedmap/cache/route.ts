import { NextRequest, NextResponse } from 'next/server';
import * as Minio from 'minio';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '172.31.23.181';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin123';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'codedmap-dbs';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';

let clientInstance: Minio.Client | null = null;

function getClient(): Minio.Client {
  if (!clientInstance) {
    clientInstance = new Minio.Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
      useSSL: MINIO_USE_SSL,
    });
  }
  return clientInstance;
}

async function ensureBucket(): Promise<void> {
  const client = getClient();
  const exists = await client.bucketExists(MINIO_BUCKET);
  if (!exists) {
    await client.makeBucket(MINIO_BUCKET);
  }
}

interface CacheEntry {
  targetProduct: string;
  files: { name: string; size: number; lastModified: string }[];
  totalSize: number;
  fileCount: number;
}

export async function GET() {
  try {
    await ensureBucket();
    const client = getClient();

    const objectStream = client.listObjectsV2(MINIO_BUCKET, 'dbs/', true);
    const objects: { name: string; size: number; lastModified: Date }[] = [];

    for await (const obj of objectStream) {
      if (obj.name && obj.name.endsWith('.db')) {
        objects.push({ name: obj.name, size: obj.size || 0, lastModified: obj.lastModified || new Date() });
      }
    }

    const grouped = new Map<string, CacheEntry>();
    for (const obj of objects) {
      // path: dbs/{targetProduct}/xxx.db or dbs/{targetProduct}/analysis/xxx.db
      const relativePath = obj.name.replace('dbs/', '');
      const slashIdx = relativePath.indexOf('/');
      if (slashIdx === -1) continue;
      const product = relativePath.substring(0, slashIdx);
      const fileName = relativePath.substring(slashIdx + 1);

      if (!grouped.has(product)) {
        grouped.set(product, { targetProduct: product, files: [], totalSize: 0, fileCount: 0 });
      }
      const entry = grouped.get(product)!;
      entry.files.push({ name: fileName, size: obj.size, lastModified: obj.lastModified.toISOString() });
      entry.totalSize += obj.size;
      entry.fileCount++;
    }

    // Sort by most recently modified
    const entries = [...grouped.values()].sort((a, b) => {
      const aLatest = a.files.reduce((max, f) => f.lastModified > max ? f.lastModified : max, '');
      const bLatest = b.files.reduce((max, f) => f.lastModified > max ? f.lastModified : max, '');
      return bLatest.localeCompare(aLatest);
    });

    return NextResponse.json({ entries });
  } catch (err) {
    console.error('[CodedmapCache] GET error:', err);
    return NextResponse.json({ error: '获取缓存列表失败', entries: [] }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const targetProduct = request.nextUrl.searchParams.get('targetProduct');
  if (!targetProduct) {
    return NextResponse.json({ error: '缺少 targetProduct 参数' }, { status: 400 });
  }

  try {
    await ensureBucket();
    const client = getClient();
    const prefix = `dbs/${targetProduct}/`;

    const objectStream = client.listObjectsV2(MINIO_BUCKET, prefix, true);
    const objectsToDelete: string[] = [];
    for await (const obj of objectStream) {
      if (obj.name) objectsToDelete.push(obj.name);
    }

    if (objectsToDelete.length === 0) {
      return NextResponse.json({ error: '未找到缓存文件', deleted: 0 });
    }

    await client.removeObjects(MINIO_BUCKET, objectsToDelete);

    return NextResponse.json({ deleted: objectsToDelete.length, targetProduct });
  } catch (err) {
    console.error('[CodedmapCache] DELETE error:', err);
    return NextResponse.json({ error: '删除缓存失败' }, { status: 500 });
  }
}
