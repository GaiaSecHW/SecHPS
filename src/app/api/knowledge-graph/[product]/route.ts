import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import * as Minio from 'minio';
import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { logger, LOG_MODULES } from '@/lib/logger';

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

async function getDb(product: string): Promise<Database.Database> {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const safeName = product.replace(/[^a-zA-Z0-9]/g, '_');
  const dbPath = path.join(CACHE_DIR, `${safeName}_graph.db`);
  if (!fs.existsSync(dbPath)) {
    const client = getMinioClient();
    try {
      await client.fGetObject(KG_BUCKET, `dbs/${product}/graph.db`, dbPath);
    } catch (e) {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      throw e;
    }
  }
  return new Database(dbPath, { readonly: true });
}

function parseClassFullName(classFullName: string): { pkg: string; className: string } {
  if (!classFullName || classFullName === '<global>' || classFullName === '<speculatedMethods>') {
    return { pkg: '<synthetic>', className: classFullName || '<unknown>' };
  }
  if (classFullName.includes('.py:') || classFullName.endsWith('.py')) {
    const parts = classFullName.split('.');
    return { pkg: parts[0], className: parts.slice(1).join('.') || '<module>' };
  }
  const parts = classFullName.split('.');
  const classIdx = parts.findIndex(p => p.length > 0 && /^[A-Z$]/.test(p));
  if (classIdx > 0) {
    return { pkg: parts.slice(0, classIdx).join('.'), className: parts.slice(classIdx).join('.') };
  }
  return { pkg: parts.slice(0, -1).join('.') || '<default>', className: parts[parts.length - 1] };
}

function nodeToInfo(id: string, props: any) {
  const tags: string[] = props.tags || [];
  return {
    id,
    name: props.name,
    fullName: props.fullName,
    signature: props.signature || null,
    lineNumber: props.lineNumber || null,
    tags,
    isExternal: !!props.isExternal,
    isSource: tags.some((t: string) => t.startsWith('ONTOLOGY:SOURCE')),
    isSink: tags.some((t: string) => t.startsWith('ONTOLOGY:SINK')),
    isEntryPoint: tags.some((t: string) => t.startsWith('ONTOLOGY:ENTRY_POINT')),
  };
}

function buildTree(db: Database.Database) {
  const rows = db.prepare(`
    SELECT CAST(id AS TEXT) as id, properties
    FROM nodes WHERE label = 'METHOD'
    AND json_extract(properties, '$.isExternal') = 0
  `).all() as { id: string; properties: string }[];

  const classMap = new Map<string, { fullName: string; methods: any[] }>();
  for (const row of rows) {
    const p = JSON.parse(row.properties);
    const cls = p.astParentFullName || '<unknown>';
    if (!classMap.has(cls)) classMap.set(cls, { fullName: cls, methods: [] });
    classMap.get(cls)!.methods.push(nodeToInfo(row.id, p));
  }

  const pkgMap = new Map<string, { name: string; classes: any[] }>();
  for (const [clsFull, cls] of classMap) {
    const { pkg, className } = parseClassFullName(clsFull);
    if (!pkgMap.has(pkg)) pkgMap.set(pkg, { name: pkg, classes: [] });
    pkgMap.get(pkg)!.classes.push({ id: `cls_${clsFull}`, name: className, fullName: clsFull, methods: cls.methods });
  }

  const packages = Array.from(pkgMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  for (const pkg of packages) {
    pkg.classes.sort((a: any, b: any) => a.name.localeCompare(b.name));
    for (const cls of pkg.classes) cls.methods.sort((a: any, b: any) => a.name.localeCompare(b.name));
  }

  const allProps = rows.map(r => JSON.parse(r.properties));
  return {
    packages,
    stats: {
      totalMethods: rows.length,
      sources: allProps.filter(p => (p.tags || []).some((t: string) => t.startsWith('ONTOLOGY:SOURCE'))).length,
      sinks: allProps.filter(p => (p.tags || []).some((t: string) => t.startsWith('ONTOLOGY:SINK'))).length,
      entryPoints: allProps.filter(p => (p.tags || []).some((t: string) => t.startsWith('ONTOLOGY:ENTRY_POINT'))).length,
    },
  };
}

function buildCallGraph(db: Database.Database, nodeId: string, depth = 2) {
  // Build full METHOD-to-METHOD call graph in memory
  const allCallEdges = db.prepare(`
    SELECT DISTINCT CAST(caller.id AS TEXT) as caller_id, CAST(callee.id AS TEXT) as callee_id
    FROM edges call_edge
    JOIN nodes callee ON call_edge.dst = callee.id AND callee.label = 'METHOD'
    JOIN edges contains_edge ON contains_edge.dst = call_edge.src AND contains_edge.type = 'CONTAINS'
    JOIN nodes caller ON contains_edge.src = caller.id AND caller.label = 'METHOD'
    WHERE call_edge.type = 'CALL'
  `).all() as { caller_id: string; callee_id: string }[];

  const fwd = new Map<string, string[]>();
  const bwd = new Map<string, string[]>();
  for (const e of allCallEdges) {
    if (!fwd.has(e.caller_id)) fwd.set(e.caller_id, []);
    fwd.get(e.caller_id)!.push(e.callee_id);
    if (!bwd.has(e.callee_id)) bwd.set(e.callee_id, []);
    bwd.get(e.callee_id)!.push(e.caller_id);
  }

  // BFS outward (callees, positive depth) and inward (callers, negative depth)
  const nodeDepth = new Map<string, number>();
  nodeDepth.set(nodeId, 0);

  const fwdQueue: [string, number][] = [[nodeId, 0]];
  while (fwdQueue.length > 0) {
    const [curr, d] = fwdQueue.shift()!;
    if (d >= depth) continue;
    for (const next of (fwd.get(curr) || []).slice(0, 15)) {
      if (!nodeDepth.has(next)) {
        nodeDepth.set(next, d + 1);
        fwdQueue.push([next, d + 1]);
      }
    }
  }

  const bwdQueue: [string, number][] = [[nodeId, 0]];
  while (bwdQueue.length > 0) {
    const [curr, d] = bwdQueue.shift()!;
    if (d >= depth) continue;
    for (const next of (bwd.get(curr) || []).slice(0, 15)) {
      if (!nodeDepth.has(next)) {
        nodeDepth.set(next, -(d + 1));
        bwdQueue.push([next, d + 1]);
      }
    }
  }

  // Group nodes by depth for layout
  const depthGroups = new Map<number, string[]>();
  for (const [id, d] of nodeDepth) {
    if (!depthGroups.has(d)) depthGroups.set(d, []);
    depthGroups.get(d)!.push(id);
  }

  const X_SPACING = 300;
  const Y_SPACING = 85;
  const getNode = db.prepare("SELECT properties FROM nodes WHERE CAST(id AS TEXT) = ?");

  const nodes: any[] = [];
  for (const [id, d] of nodeDepth) {
    const row = getNode.get(id) as { properties: string } | undefined;
    if (!row) continue;
    const p = JSON.parse(row.properties);
    const group = depthGroups.get(d)!;
    const idx = group.indexOf(id);
    const groupSize = group.length;
    nodes.push({
      ...nodeToInfo(id, p),
      isSelected: id === nodeId,
      position: {
        x: d * X_SPACING + 600,
        y: (idx - (groupSize - 1) / 2) * Y_SPACING,
      },
    });
  }

  // Add edges between nodes that are both in the subgraph
  const inGraph = new Set(nodeDepth.keys());
  const addedEdges = new Set<string>();
  const edges: any[] = [];
  for (const [callerId, calleeIds] of fwd) {
    if (!inGraph.has(callerId)) continue;
    for (const calleeId of calleeIds) {
      if (!inGraph.has(calleeId)) continue;
      const eid = `e_${callerId}_${calleeId}`;
      if (!addedEdges.has(eid)) {
        addedEdges.add(eid);
        edges.push({ id: eid, source: callerId, target: calleeId });
      }
    }
  }

  return { nodes, edges };
}

function buildPaths(db: Database.Database) {
  const callEdges = db.prepare(`
    SELECT DISTINCT CAST(caller.id AS TEXT) as caller_id, CAST(callee.id AS TEXT) as callee_id
    FROM edges call_edge
    JOIN nodes callee ON call_edge.dst = callee.id AND callee.label = 'METHOD'
    JOIN edges contains_edge ON contains_edge.dst = call_edge.src AND contains_edge.type = 'CONTAINS'
    JOIN nodes caller ON contains_edge.src = caller.id AND caller.label = 'METHOD'
    WHERE call_edge.type = 'CALL'
  `).all() as { caller_id: string; callee_id: string }[];

  const fwd = new Map<string, string[]>();
  for (const e of callEdges) {
    if (!fwd.has(e.caller_id)) fwd.set(e.caller_id, []);
    fwd.get(e.caller_id)!.push(e.callee_id);
  }

  const sources = db.prepare(
    "SELECT CAST(id AS TEXT) as id, properties FROM nodes WHERE json_extract(properties, '$.tags') LIKE '%ONTOLOGY:SOURCE%' AND label='METHOD'"
  ).all() as { id: string; properties: string }[];
  const sinks = db.prepare(
    "SELECT CAST(id AS TEXT) as id, properties FROM nodes WHERE json_extract(properties, '$.tags') LIKE '%ONTOLOGY:SINK%' AND label='METHOD'"
  ).all() as { id: string; properties: string }[];
  const sinkMap = new Map(sinks.map(s => [s.id, s]));

  const getNode = db.prepare("SELECT properties FROM nodes WHERE CAST(id AS TEXT) = ?");

  const paths: any[] = [];
  for (const src of sources) {
    const sp = JSON.parse(src.properties);
    // 每个 source 独立 BFS，visited 不跨 source 共享
    const visited = new Set<string>();
    const queue: [string, string[]][] = [[src.id, [src.id]]];

    while (queue.length > 0) {
      const [curr, pathIds] = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);

      if (sinkMap.has(curr)) {
        const sinkRow = sinkMap.get(curr)!;
        const sinkP = JSON.parse(sinkRow.properties);
        const intermediates = pathIds.slice(1, -1).map(id => {
          const row = getNode.get(id) as { properties: string } | undefined;
          if (!row) return null;
          const p = JSON.parse(row.properties);
          return { id, name: p.name, fullName: p.fullName };
        }).filter(Boolean);

        paths.push({
          id: `path_${paths.length}`,
          source: nodeToInfo(src.id, sp),
          sink: nodeToInfo(sinkRow.id, sinkP),
          intermediates,
        });
        // 找到 sink 后继续探索，不 continue，让 BFS 继续找其他 sink
      }

      if (pathIds.length > 8) continue;
      for (const next of (fwd.get(curr) || [])) {
        if (!visited.has(next)) queue.push([next, [...pathIds, next]]);
      }
    }
  }

  return { paths };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ product: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { product } = await params;
  const view = request.nextUrl.searchParams.get('view') || 'tree';
  const nodeId = request.nextUrl.searchParams.get('nodeId');
  const depth = Math.min(parseInt(request.nextUrl.searchParams.get('depth') || '2', 10), 4);

  try {
    const db = await getDb(decodeURIComponent(product));

    if (view === 'tree') {
      return NextResponse.json(buildTree(db));
    }
    if (view === 'node' && nodeId) {
      const row = db.prepare("SELECT properties FROM nodes WHERE CAST(id AS TEXT) = ?").get(nodeId) as { properties: string } | undefined;
      if (!row) return NextResponse.json({ error: 'Node not found' }, { status: 404 });
      const p = JSON.parse(row.properties);
      return NextResponse.json({ ...nodeToInfo(nodeId, p), code: p.code || null });
    }
    if (view === 'graph' && nodeId) {
      const result = buildCallGraph(db, nodeId, depth);
      if (!result) return NextResponse.json({ error: 'Node not found' }, { status: 404 });
      return NextResponse.json(result);
    }
    if (view === 'paths') {
      return NextResponse.json(buildPaths(db));
    }

    return NextResponse.json({ error: 'Invalid view' }, { status: 400 });
  } catch (error: any) {
    logger.error(LOG_MODULES.CODE, 'Knowledge graph error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
