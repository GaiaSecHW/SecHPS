'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

const AGENT_COLORS: Record<string, string> = {
  codex: '#3B82F6',
  claude: '#F97316',
  kimi: '#10B981',
  opencode: '#EF4444',
  pi: '#8B5CF6',
  python_node: '#06B6D4',
  shell: '#9CA3AF',
  sync: '#EAB308',
  custom: '#7C3AED',
  fanout: '#06B6D4',
  merge: '#F59E0B',
  evolve: '#EC4899',
};

export default function AgentFlowNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>;
  const nodeType = d.nodeType as string;
  const borderColor = AGENT_COLORS[nodeType] || '#6B7280';

  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 min-w-[180px] max-w-[240px] transition-shadow ${
        selected ? 'shadow-[0_0_0_3px_rgba(59,130,246,0.5)]' : ''
      }`}
      style={{ background: '#1a2332', borderColor }}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-500 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-gray-500 !w-2 !h-2" />

      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-semibold text-gray-100 truncate">{String(d.taskId ?? '')}</span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white shrink-0"
          style={{ background: borderColor }}
        >
          {nodeType}
        </span>
      </div>

      {Boolean(d.prompt) && (
        <p className="text-xs text-gray-400 leading-tight mb-1 line-clamp-2">{String(d.prompt)}</p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {Boolean(d.model) && (
          <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{String(d.model)}</span>
        )}
        {Boolean(d.tools) && (
          <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{String(d.tools)}</span>
        )}
      </div>

      {nodeType === 'fanout' && (
        <div className="mt-1.5 text-[10px] text-cyan-400 bg-cyan-900/20 px-1.5 py-0.5 rounded flex items-center gap-1">
          <span>⊕</span>
          <span>fanout</span>
          {Boolean(d.fanoutSourceCount) && <span className="text-cyan-300">×{String(d.fanoutSourceCount)}</span>}
        </div>
      )}

      {nodeType === 'merge' && (
        <div className="mt-1.5 text-[10px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded flex items-center gap-1">
          <span>⊗</span>
          <span>merge</span>
        </div>
      )}

      {nodeType === 'evolve' && (
        <div className="mt-1.5 text-[10px] text-pink-400 bg-pink-900/20 px-1.5 py-0.5 rounded flex items-center gap-1">
          <span>⚡</span>
          <span>evolve</span>
          {Boolean(d.evolveTarget) && <span className="text-pink-300">→{String(d.evolveTarget)}</span>}
        </div>
      )}
    </div>
  );
}
