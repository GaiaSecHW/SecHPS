import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';

const CACHE_DIR = path.join(os.tmpdir(), 'kg_cache');

const TAG_PREFIXES: Record<string, string> = {
  source: 'ONTOLOGY:SOURCE',
  sink: 'ONTOLOGY:SINK',
  entry: 'ONTOLOGY:ENTRY_POINT',
};

const TAG_VALUES: Record<string, string> = {
  source: 'ONTOLOGY:SOURCE:MANUAL',
  sink: 'ONTOLOGY:SINK:MANUAL',
  entry: 'ONTOLOGY:ENTRY_POINT:MANUAL',
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ product: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { product } = await params;
  const { nodeId, action, tagType } = await request.json() as {
    nodeId: string;
    action: 'add' | 'remove';
    tagType: 'source' | 'sink' | 'entry';
  };

  if (!nodeId || !action || !tagType) {
    return NextResponse.json({ error: 'nodeId, action, tagType required' }, { status: 400 });
  }
  if (!TAG_PREFIXES[tagType]) {
    return NextResponse.json({ error: 'invalid tagType' }, { status: 400 });
  }

  const safeName = decodeURIComponent(product).replace(/[^a-zA-Z0-9]/g, '_');
  const dbPath = path.join(CACHE_DIR, `${safeName}_graph.db`);
  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: 'Product DB not cached, load the product first' }, { status: 404 });
  }

  const db = new Database(dbPath);
  try {
    const row = db.prepare('SELECT properties FROM nodes WHERE CAST(id AS TEXT) = ?').get(nodeId) as { properties: string } | undefined;
    if (!row) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

    const props = JSON.parse(row.properties);
    let tags: string[] = props.tags || [];
    const prefix = TAG_PREFIXES[tagType];

    if (action === 'add') {
      if (!tags.some(t => t.startsWith(prefix))) {
        tags = [...tags, TAG_VALUES[tagType]];
      }
    } else {
      tags = tags.filter(t => !t.startsWith(prefix));
    }

    props.tags = tags;
    db.prepare('UPDATE nodes SET properties = ? WHERE CAST(id AS TEXT) = ?').run(JSON.stringify(props), nodeId);

    return NextResponse.json({
      id: nodeId,
      tags,
      isSource: tags.some(t => t.startsWith('ONTOLOGY:SOURCE')),
      isSink: tags.some(t => t.startsWith('ONTOLOGY:SINK')),
      isEntryPoint: tags.some(t => t.startsWith('ONTOLOGY:ENTRY_POINT')),
    });
  } finally {
    db.close();
  }
}
