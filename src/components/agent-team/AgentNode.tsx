'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import {
  Crown,
  Settings,
  Brain,
  Zap,
  Circle,
  ChevronRight,
} from 'lucide-react';

// ============ Types ============

export interface AgentNodeData {
  id: string;
  agentId: string;
  name: string;
  displayName: string;
  model: string;
  category: string;
  isLead: boolean;
  status: 'idle' | 'active' | 'error';
  overrideModel?: string | null;
  onConfigure?: (id: string) => void;
  [key: string]: unknown; // Index signature for Record<string, unknown> compatibility
}

// ============ Agent Node Component ============

function AgentNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as AgentNodeData;
  const isLead = nodeData.isLead;
  const status = nodeData.status || 'idle';

  // Color schemes based on role
  const colorScheme = isLead
    ? {
        bg: 'bg-gradient-to-br from-amber-50 to-orange-50',
        border: selected ? 'border-amber-500' : 'border-amber-200',
        accent: 'text-amber-600',
        badgeBg: 'bg-amber-100',
        badgeText: 'text-amber-700',
        shadow: 'shadow-amber-100/50',
        glow: selected ? 'ring-2 ring-amber-400/50' : '',
      }
    : {
        bg: 'bg-gradient-to-br from-blue-50 to-indigo-50',
        border: selected ? 'border-blue-500' : 'border-blue-200',
        accent: 'text-blue-600',
        badgeBg: 'bg-blue-100',
        badgeText: 'text-blue-700',
        shadow: 'shadow-blue-100/50',
        glow: selected ? 'ring-2 ring-blue-400/50' : '',
      };

  // Status indicator colors
  const statusColors = {
    idle: { bg: 'bg-gray-200', text: 'text-gray-500' },
    active: { bg: 'bg-green-400', text: 'text-green-600' },
    error: { bg: 'bg-red-400', text: 'text-red-600' },
  };

  const statusColor = statusColors[status];

  // Node size - Lead is larger
  const nodeSize = isLead ? 'w-[220px] min-h-[140px]' : 'w-[180px] min-h-[100px]';

  return (
    <div
      className={`${nodeSize} ${colorScheme.bg} ${colorScheme.border} border-2 rounded-xl shadow-lg ${colorScheme.shadow} ${colorScheme.glow} transition-all duration-200 relative overflow-visible`}
    >
      {/* Handles for connections */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white !rounded-full hover:!bg-blue-500 transition-colors"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white !rounded-full hover:!bg-blue-500 transition-colors"
      />

      {/* Lead Agent Crown Badge */}
      {isLead && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center justify-center w-8 h-8 bg-amber-500 rounded-full shadow-md border-2 border-white">
          <Crown size={14} className="text-white" />
        </div>
      )}

      {/* Status Indicator */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        <Circle
          size={8}
          className={`${statusColor.bg} ${statusColor.text} fill-current`}
        />
      </div>

      {/* Configure Button */}
      <button
        onClick={() => nodeData.onConfigure?.(nodeData.id)}
        className="absolute top-2 left-2 p-1.5 rounded-lg bg-white/80 hover:bg-white shadow-sm border border-gray-200 transition-all hover:scale-105"
        title="配置 Agent"
      >
        <Settings size={14} className="text-gray-600" />
      </button>

      {/* Content */}
      <div className="p-4 pt-6">
        {/* Agent Icon */}
        <div className="flex items-center gap-2 mb-2">
          <div className={`p-2 rounded-lg ${colorScheme.badgeBg}`}>
            <Brain size={isLead ? 20 : 16} className={colorScheme.accent} />
          </div>
          <div className="flex-1 min-w-0">
            {/* Agent Name */}
            <h3 className={`font-semibold ${isLead ? 'text-base' : 'text-sm'} text-gray-900 truncate`}>
              {nodeData.displayName || nodeData.name}
            </h3>
            {/* Category */}
            <p className="text-xs text-gray-500 truncate">{nodeData.category}</p>
          </div>
        </div>

        {/* Model Badge */}
        <div className="flex items-center gap-2 mt-2">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-md ${colorScheme.badgeBg}`}>
            <Zap size={12} className={colorScheme.badgeText} />
            <span className={`text-xs font-medium ${colorScheme.badgeText} truncate`}>
              {nodeData.overrideModel || nodeData.model}
            </span>
          </div>
        </div>

        {/* Role Badge */}
        {isLead && (
          <div className="mt-2 flex items-center gap-1 px-2 py-1 bg-amber-200/50 rounded-md">
            <span className="text-xs font-medium text-amber-800">Lead Agent</span>
          </div>
        )}
      </div>

      {/* Expand indicator */}
      <div className="absolute bottom-2 right-2">
        <ChevronRight size={12} className="text-gray-400" />
      </div>
    </div>
  );
}

// Memoize for performance
export const AgentNode = memo(AgentNodeComponent);

// ============ Sidebar Agent Item (Draggable) ============

export interface SidebarAgentItemProps {
  agent: {
    id: string;
    name: string;
    displayName: string;
    model: string;
    category: string;
    description?: string;
  };
  onDragStart: (agent: SidebarAgentItemProps['agent']) => void;
  isLead?: boolean;
}

export function SidebarAgentItem({ agent, onDragStart, isLead = false }: SidebarAgentItemProps) {
  const colorScheme = isLead
    ? {
        bg: 'bg-gradient-to-r from-amber-50 to-orange-50',
        border: 'border-amber-200',
        accent: 'text-amber-600',
        badgeBg: 'bg-amber-100',
        badgeText: 'text-amber-700',
      }
    : {
        bg: 'bg-gradient-to-r from-blue-50 to-indigo-50',
        border: 'border-blue-200',
        accent: 'text-blue-600',
        badgeBg: 'bg-blue-100',
        badgeText: 'text-blue-700',
      };

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/json', JSON.stringify(agent));
        onDragStart(agent);
      }}
      className={`${colorScheme.bg} ${colorScheme.border} border rounded-lg p-3 cursor-grab hover:shadow-md transition-all hover:scale-[1.02] active:cursor-grabbing`}
    >
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-md ${colorScheme.badgeBg}`}>
          <Brain size={14} className={colorScheme.accent} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {agent.displayName || agent.name}
          </p>
          <p className="text-xs text-gray-500 truncate">{agent.category}</p>
        </div>
      </div>
      <div className={`mt-2 flex items-center gap-1 px-2 py-0.5 rounded ${colorScheme.badgeBg}`}>
        <Zap size={10} className={colorScheme.badgeText} />
        <span className={`text-xs ${colorScheme.badgeText} truncate`}>{agent.model}</span>
      </div>
      {isLead && (
        <div className="mt-1 flex items-center gap-1">
          <Crown size={10} className="text-amber-500" />
          <span className="text-xs text-amber-600 font-medium">Lead</span>
        </div>
      )}
    </div>
  );
}

export default AgentNode;