import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import { routeRequestWithDefaultModel } from '@/lib/model-client';
import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';

const CACHE_DIR = path.join(os.tmpdir(), 'kg_cache');

function getDbPath(product: string) {
  const safeName = product.replace(/[^a-zA-Z0-9]/g, '_');
  return path.join(CACHE_DIR, `${safeName}_graph.db`);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ product: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { product } = await params;
  const { nodeId } = await request.json();
  if (!nodeId) return NextResponse.json({ error: 'nodeId required' }, { status: 400 });

  const dbPath = getDbPath(decodeURIComponent(product));
  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: 'Product DB not found, please load the product first' }, { status: 404 });
  }

  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT properties FROM nodes WHERE CAST(id AS TEXT) = ?').get(nodeId) as { properties: string } | undefined;
  db.close();

  if (!row) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

  const props = JSON.parse(row.properties);
  const code: string = props.code || '';
  if (!code.trim()) return NextResponse.json({ error: 'No code available for this node' }, { status: 404 });

  const response = await routeRequestWithDefaultModel(
    [
      {
        role: 'user',
        content: `以下是通过字节码反编译得到的 Jimple 中间表示代码，请将其还原为可读的 Java 源代码。
要求：
- 只输出源代码，不要任何解释或 markdown 代码块标记
- 保留原始方法签名、参数名、返回类型
- 将 Jimple 的临时变量（如 $stack1、$stack2）替换为有意义的变量名
- 将 specialinvoke/virtualinvoke/staticinvoke 还原为正常的方法调用语法
- 保留异常处理逻辑

Jimple 代码：
${code}`,
      },
    ],
    {
      system: '你是一个 Java 字节码反编译专家，擅长将 Jimple 中间表示还原为可读的 Java 源代码。',
      max_tokens: 4096,
      context: {
        userId: auth.userId,
        scene: 'other',
        description: '知识图谱方法体反编译',
      },
    }
  );

  const content = response?.content?.[0]?.text ?? response?.choices?.[0]?.message?.content ?? '';
  return NextResponse.json({ source: content });
}
