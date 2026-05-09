'use client';

import { NODE_TYPES, NodeTypeDefinition } from '@/types/workflow';
import { Play, Square, Cog, GitBranch, GitMerge, Clock, Variable, Shuffle, Bell } from 'lucide-react';

// 图标映射
const iconMap: Record<string, any> = {
  Play,
  Square,
  Cog,
  GitBranch,
  GitMerge,
  Clock,
  Variable,
  Shuffle,
  Bell,
};

interface NodePaletteProps {
  onNodeDragStart: (nodeType: NodeTypeDefinition) => void;
  hideTriggers?: boolean;  // 隐藏触发器节点（用于 FSM 渗透测试区）
}

export default function NodePalette({ onNodeDragStart, hideTriggers = false }: NodePaletteProps) {
  // 按类别分组节点，过滤掉 subtask 类型、控制流类型，以及触发器（如果 hideTriggers=true）
  const nodesByCategory = NODE_TYPES
    .filter(node => node.type !== 'subtask' && node.category !== 'control' && (!hideTriggers || node.category !== 'trigger'))
    .reduce((acc, node) => {
      if (!acc[node.category]) {
        acc[node.category] = [];
      }
      acc[node.category].push(node);
      return acc;
    }, {} as Record<string, NodeTypeDefinition[]>);

  const categoryLabels: Record<string, string> = {
    trigger: '触发器',
    action: '动作',
    data: '数据',
  };

  const categoryIcons: Record<string, any> = {
    trigger: Play,
    action: Cog,
    data: Variable,
  };

  return (
    <div className="h-full bg-dark-surface border-r border-gray-700/50 overflow-y-auto">
      <div className="p-4 border-b border-gray-700/50">
        <h2 className="text-lg font-semibold text-gray-100">节点面板</h2>
        <p className="text-sm text-gray-600 mt-1">拖拽节点到画布</p>
      </div>

      <div className="p-4 space-y-6">
        {Object.entries(nodesByCategory).map(([category, nodes]) => {
          const CategoryIcon = categoryIcons[category];
          return (
            <div key={category}>
              <div className="flex items-center space-x-2 mb-3">
                {CategoryIcon && <CategoryIcon size={16} className="text-gray-400" />}
                <h3 className="text-sm font-medium text-gray-100 uppercase">
                  {categoryLabels[category] || category}
                </h3>
              </div>

              <div className="space-y-2">
                {nodes.map((node) => {
                  const Icon = iconMap[node.icon];
                  return (
                    <div
                      key={node.type}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/reactflow', JSON.stringify(node));
                        onNodeDragStart(node);
                      }}
                      className="flex items-center space-x-3 p-3 bg-[#0F172A] rounded-lg border border-gray-700/50 cursor-grab hover:bg-dark-surface-hover hover:border-gray-600 transition-all"
                      style={{ borderLeftColor: node.color, borderLeftWidth: '4px' }}
                    >
                      {Icon && (
                        <div
                          className="p-2 rounded-md"
                          style={{ backgroundColor: `${node.color}20` }}
                        >
                          <Icon size={16} style={{ color: node.color }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-100">{node.label}</p>
                        <p className="text-xs text-gray-500 truncate">{node.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
