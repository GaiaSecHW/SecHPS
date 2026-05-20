'use client';

import { useState, useEffect } from 'react';
import { Network, ChevronRight, ChevronDown, Loader2, AlertCircle, Search, X } from 'lucide-react';
import { ReactFlowProvider, ReactFlow, Background, Controls, Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface MethodInfo {
  id: string;
  name: string;
  fullName: string;
  tags: string[];
  isSource: boolean;
  isSink: boolean;
  isEntryPoint: boolean;
  isExternal?: boolean;
}

interface TreeClass {
  id: string;
  name: string;
  fullName: string;
  methods: MethodInfo[];
}

interface TreePackage {
  name: string;
  classes: TreeClass[];
}

interface TreeData {
  packages: TreePackage[];
  stats: { totalMethods: number; sources: number; sinks: number; entryPoints: number };
}

interface PathData {
  id: string;
  source: MethodInfo;
  sink: MethodInfo;
  intermediates: { id: string; name: string; fullName: string }[];
}

function methodColor(m: MethodInfo) {
  if (m.isSink) return 'text-red-400';
  if (m.isSource) return 'text-green-400';
  if (m.isEntryPoint) return 'text-yellow-400';
  return 'text-gray-300';
}

function tagBadge(m: MethodInfo) {
  if (m.isSink) return <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-red-500/20 text-red-400">SINK</span>;
  if (m.isSource) return <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-green-500/20 text-green-400">SRC</span>;
  if (m.isEntryPoint) return <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400">ENTRY</span>;
  return null;
}

function shortName(fullName: string) {
  const noSig = fullName?.split(':')[0] || fullName || '';
  const parts = noSig.split('.');
  return parts[parts.length - 1] || fullName;
}

// ─── Package Tree ─────────────────────────────────────────────────────────────

function MethodItem({ m, selected, onSelect }: { m: MethodInfo; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
        selected ? 'bg-primary-600/20 text-primary-300' : `${methodColor(m)} hover:bg-gray-700/40`
      }`}
      title={m.fullName}
    >
      <span className="truncate">{m.name}</span>
      {tagBadge(m)}
    </button>
  );
}

type TagFilter = 'all' | 'source' | 'sink' | 'entry';

function matchesFilter(m: MethodInfo, search: string, tagFilter: TagFilter) {
  if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
  if (tagFilter === 'source' && !m.isSource) return false;
  if (tagFilter === 'sink' && !m.isSink) return false;
  if (tagFilter === 'entry' && !m.isEntryPoint) return false;
  return true;
}

function ClassItem({ cls, selectedId, onSelect, search, tagFilter }: {
  cls: TreeClass; selectedId: string | null; onSelect: (m: MethodInfo) => void;
  search: string; tagFilter: TagFilter;
}) {
  const [open, setOpen] = useState(false);
  const hasTagged = cls.methods.some(m => m.isSource || m.isSink || m.isEntryPoint);
  const isFiltering = !!search || tagFilter !== 'all';
  const filteredMethods = cls.methods.filter(m => matchesFilter(m, search, tagFilter));

  useEffect(() => {
    if (isFiltering) {
      setOpen(filteredMethods.length > 0);
    } else if (hasTagged) {
      setOpen(true);
    }
  }, [isFiltering, filteredMethods.length, hasTagged]);

  if (filteredMethods.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700/30 rounded transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="truncate font-medium">{cls.name}</span>
        <span className="ml-auto text-gray-600 text-[10px]">{filteredMethods.length}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-gray-700/40 pl-1">
          {filteredMethods.map(m => (
            <MethodItem key={m.id} m={m} selected={selectedId === m.id} onSelect={() => onSelect(m)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PackageItem({ pkg, selectedId, onSelect, search, tagFilter }: {
  pkg: TreePackage; selectedId: string | null; onSelect: (m: MethodInfo) => void;
  search: string; tagFilter: TagFilter;
}) {
  const [open, setOpen] = useState(false);
  const hasTagged = pkg.classes.some(c => c.methods.some(m => m.isSource || m.isSink || m.isEntryPoint));
  const isFiltering = !!search || tagFilter !== 'all';
  const hasMatches = pkg.classes.some(c => c.methods.some(m => matchesFilter(m, search, tagFilter)));

  useEffect(() => {
    if (isFiltering) {
      setOpen(hasMatches);
    } else if (hasTagged) {
      setOpen(true);
    }
  }, [isFiltering, hasMatches, hasTagged]);

  if (isFiltering && !hasMatches) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-700/20 rounded transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="truncate">{pkg.name}</span>
        <span className="ml-auto text-gray-600 text-[10px]">{pkg.classes.length}</span>
      </button>
      {open && (
        <div className="ml-2">
          {pkg.classes.map(cls => (
            <ClassItem key={cls.id} cls={cls} selectedId={selectedId} onSelect={onSelect} search={search} tagFilter={tagFilter} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Call Graph View ──────────────────────────────────────────────────────────

function nodeStyle(n: any) {
  if (n.isSelected) return { background: '#3b82f6', color: '#fff', border: '2px solid #60a5fa' };
  if (n.isSink) return { background: '#7f1d1d', color: '#fca5a5', border: '1px solid #ef4444' };
  if (n.isSource) return { background: '#064e3b', color: '#6ee7b7', border: '1px solid #10b981' };
  if (n.isEntryPoint) return { background: '#78350f', color: '#fde68a', border: '1px solid #f59e0b' };
  if (n.isExternal) return { background: '#1f2937', color: '#9ca3af', border: '1px solid #374151' };
  return { background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f6' };
}

function CallGraphView({ product, method }: { product: string; method: MethodInfo | null }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);
  const [depth, setDepth] = useState(2);

  useEffect(() => {
    if (!method || !product) { setNodes([]); setEdges([]); return; }
    setLoading(true);
    setNodes([]);
    setEdges([]);
    const controller = new AbortController();
    const token = localStorage.getItem('token');
    fetch(`/api/knowledge-graph/${encodeURIComponent(product)}?view=graph&nodeId=${method.id}&depth=${depth}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(data => {
        if (!data.nodes || !data.edges) { setNodes([]); setEdges([]); return; }
        setNodes(data.nodes.map((n: any) => ({
          id: n.id,
          position: n.position,
          data: { label: n.name, fullName: n.fullName, ...n },
          style: { ...nodeStyle(n), borderRadius: 6, padding: '6px 10px', fontSize: 11, maxWidth: 200 },
        })));
        setEdges(data.edges.map((e: any) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: '',
          style: { stroke: '#4b5563' },
          markerEnd: { type: 'arrowclosed' as any, color: '#4b5563' },
        })));
      })
      .catch(e => { if (e.name !== 'AbortError') console.error(e); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [method?.id, product, depth]);

  if (!method) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        在左侧选择一个方法查看调用图
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark-bg/60 z-10">
          <Loader2 size={24} className="animate-spin text-primary-400" />
        </div>
      )}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 bg-dark-surface/90 border border-gray-700/50 rounded-lg px-2 py-1">
        <span className="text-[10px] text-gray-500">深度</span>
        {[1, 2, 3, 4].map(d => (
          <button
            key={d}
            onClick={() => setDepth(d)}
            className={`w-6 h-6 text-xs rounded transition-colors ${depth === d ? 'bg-primary-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
          >
            {d}
          </button>
        ))}
      </div>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background color="#374151" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

// ─── Source-Sink Paths ────────────────────────────────────────────────────────

function PathCard({ path }: { path: PathData }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700/20 transition-colors text-left"
      >
        <span className="text-xs px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20 flex-shrink-0">SOURCE</span>
        <span className="text-xs text-gray-300 truncate flex-1" title={path.source.fullName}>{shortName(path.source.fullName)}</span>
        <span className="text-gray-600 text-xs flex-shrink-0">→ {path.intermediates.length} 跳 →</span>
        <span className="text-xs px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20 flex-shrink-0">SINK</span>
        <span className="text-xs text-gray-300 truncate flex-1" title={path.sink.fullName}>{shortName(path.sink.fullName)}</span>
        {open ? <ChevronDown size={14} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-500 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-gray-700/30">
          <div className="mt-3 space-y-1">
            <PathNode label="SOURCE" name={path.source.name} fullName={path.source.fullName} color="green" />
            {path.intermediates.map((n, i) => (
              <PathNode key={i} label={`${i + 1}`} name={n.name} fullName={n.fullName} color="blue" />
            ))}
            <PathNode label="SINK" name={path.sink.name} fullName={path.sink.fullName} color="red" />
          </div>
        </div>
      )}
    </div>
  );
}

function PathNode({ label, name, fullName, color }: { label: string; name: string; fullName: string; color: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${colors[color]}`}>{label}</span>
      <span className="text-xs text-gray-300 font-medium">{name}</span>
      <span className="text-[10px] text-gray-600 truncate" title={fullName}>{fullName}</span>
    </div>
  );
}

function SourceSinkPaths({ product }: { product: string }) {
  const [paths, setPaths] = useState<PathData[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!product || loaded) return;
    setLoading(true);
    const token = localStorage.getItem('token');
    fetch(`/api/knowledge-graph/${encodeURIComponent(product)}?view=paths`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => { setPaths(data.paths || []); setLoaded(true); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [product, loaded]);

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 size={24} className="animate-spin text-primary-400" /></div>;

  if (paths.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-2">
        <AlertCircle size={32} className="opacity-40" />
        <p className="text-sm">未发现 Source-Sink 路径</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-2">
      <p className="text-xs text-gray-500 mb-3">共发现 {paths.length} 条数据流路径</p>
      {paths.map(p => <PathCard key={p.id} path={p} />)}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KnowledgeGraphPage() {
  const [products, setProducts] = useState<string[]>([]);
  const [product, setProduct] = useState('');
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<MethodInfo | null>(null);
  const [tab, setTab] = useState<'graph' | 'paths'>('graph');
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<TagFilter>('all');

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch('/api/knowledge-graph', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setProducts(data.products || []);
        if (data.products?.length > 0) setProduct(data.products[0]);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!product) return;
    setTreeLoading(true);
    setTreeData(null);
    setSelectedMethod(null);
    const token = localStorage.getItem('token');
    fetch(`/api/knowledge-graph/${encodeURIComponent(product)}?view=tree`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => setTreeData(data))
      .catch(console.error)
      .finally(() => setTreeLoading(false));
  }, [product]);

  const stats = treeData?.stats;

  return (
    <div className="flex flex-col h-full gap-0" style={{ height: 'calc(100vh - 56px - 48px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-3 mb-3 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center">
            <Network size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">知识图谱</h1>
            <p className="text-xs text-gray-400">代码安全知识图谱可视化</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {stats && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-500">{stats.totalMethods} 方法</span>
              <span className="text-green-400">{stats.sources} Source</span>
              <span className="text-red-400">{stats.sinks} Sink</span>
              <span className="text-yellow-400">{stats.entryPoints} Entry</span>
            </div>
          )}
          <select
            value={product}
            onChange={e => { setSelectedMethod(null); setProduct(e.target.value); }}
            className="bg-dark-bg border border-gray-700/50 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary-500"
          >
            {products.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 gap-3 min-h-0">
        {/* Left: Package Tree */}
        <div className="w-64 flex-shrink-0 bg-dark-surface border border-gray-700/50 rounded-xl flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-700/40 flex-shrink-0 space-y-2">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">包结构</p>
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索方法名..."
                className="w-full bg-dark-bg border border-gray-700/50 rounded text-xs text-gray-300 placeholder-gray-600 pl-6 pr-6 py-1 focus:outline-none focus:border-primary-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  <X size={11} />
                </button>
              )}
            </div>
            <div className="flex gap-1">
              {(['all', 'entry', 'source', 'sink'] as const).map(f => {
                const labels: Record<string, string> = { all: '全部', entry: 'Entry', source: 'Source', sink: 'Sink' };
                const colors: Record<string, string> = {
                  all: tagFilter === 'all' ? 'bg-gray-600 text-gray-100' : 'text-gray-500 hover:text-gray-300',
                  entry: tagFilter === 'entry' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'text-gray-500 hover:text-yellow-400',
                  source: tagFilter === 'source' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'text-gray-500 hover:text-green-400',
                  sink: tagFilter === 'sink' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-gray-500 hover:text-red-400',
                };
                return (
                  <button
                    key={f}
                    onClick={() => setTagFilter(tagFilter === f ? 'all' : f)}
                    className={`flex-1 text-[10px] px-1 py-0.5 rounded transition-colors ${colors[f]}`}
                  >
                    {labels[f]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-1 custom-scrollbar">
            {treeLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-primary-400" /></div>
            ) : treeData?.packages ? (
              treeData.packages.map(pkg => (
                <PackageItem key={pkg.name} pkg={pkg} selectedId={selectedMethod?.id || null} onSelect={setSelectedMethod} search={search} tagFilter={tagFilter} />
              ))
            ) : null}
          </div>
        </div>

        {/* Right: Graph / Paths */}
        <div className="flex-1 bg-dark-surface border border-gray-700/50 rounded-xl flex flex-col overflow-hidden min-w-0">
          <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-700/40 flex-shrink-0">
            <button
              onClick={() => setTab('graph')}
              className={`px-3 py-1 text-xs rounded transition-colors ${tab === 'graph' ? 'bg-primary-600/20 text-primary-300' : 'text-gray-500 hover:text-gray-300'}`}
            >
              调用图
            </button>
            <button
              onClick={() => setTab('paths')}
              className={`px-3 py-1 text-xs rounded transition-colors ${tab === 'paths' ? 'bg-primary-600/20 text-primary-300' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Source-Sink 路径
            </button>
            {selectedMethod && tab === 'graph' && (
              <span className="ml-3 text-xs text-gray-500 truncate" title={selectedMethod.fullName}>
                {selectedMethod.name}
              </span>
            )}
          </div>
          {tab === 'graph' ? (
            <ReactFlowProvider>
              <CallGraphView product={product} method={selectedMethod} />
            </ReactFlowProvider>
          ) : (
            product ? <SourceSinkPaths key={product} product={product} /> : null
          )}
        </div>
      </div>
    </div>
  );
}
