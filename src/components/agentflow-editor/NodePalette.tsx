'use client';

import { Bot, Code2, GitBranch } from 'lucide-react';
import type { AgentFlowNodeData } from '@/types/workflow';

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

interface NodeEntry {
  type: AgentFlowNodeData['nodeType'];
  label: string;
  description: string;
}

interface NodeCategory {
  key: string;
  label: string;
  icon: typeof Bot;
  nodes: NodeEntry[];
}

const CATEGORIES: NodeCategory[] = [
  {
    key: 'agent',
    label: '智能体节点',
    icon: Bot,
    nodes: [
      { type: 'codex', label: 'Codex', description: 'Codex Agent' },
      { type: 'claude', label: 'Claude', description: 'Claude Agent' },
      { type: 'kimi', label: 'Kimi', description: 'Kimi Agent' },
      { type: 'opencode', label: 'OpenCode', description: 'OpenCode Agent' },
      { type: 'pi', label: 'Pi', description: 'Pi Agent' },
      { type: 'custom', label: 'Custom', description: '自定义 Agent' },
    ],
  },
  {
    key: 'code',
    label: '代码执行节点',
    icon: Code2,
    nodes: [
      { type: 'python_node', label: 'Python', description: 'Python 脚本节点' },
      { type: 'shell', label: 'Shell', description: 'Shell 命令节点' },
      { type: 'sync', label: 'Sync', description: '文件同步节点' },
    ],
  },
  {
    key: 'edge',
    label: '边',
    icon: GitBranch,
    nodes: [
      { type: 'fanout', label: 'Fanout', description: '并行扇出' },
      { type: 'merge', label: 'Merge', description: '结果汇聚' },
      { type: 'evolve', label: 'Evolve', description: 'Agent 进化' },
    ],
  },
];

interface NodePaletteProps {
  onAddNode: (nodeType: string) => void;
}

export default function NodePalette({ onAddNode }: NodePaletteProps) {
  const handleDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/agentflow', nodeType);
  };

  return (
    <div className="h-full bg-dark-surface border-r border-gray-700/50 overflow-y-auto">
      <div className="p-4 border-b border-gray-700/50">
        <h2 className="text-lg font-semibold text-gray-100">节点面板</h2>
        <p className="text-sm text-gray-600 mt-1">拖拽节点到画布</p>
      </div>

      <div className="p-4 space-y-6">
        {CATEGORIES.map(({ key, label, icon: CategoryIcon, nodes }) => (
          <div key={key}>
            <div className="flex items-center space-x-2 mb-3">
              <CategoryIcon size={16} className="text-gray-400" />
              <h3 className="text-sm font-medium text-gray-100 uppercase">{label}</h3>
            </div>

            <div className="space-y-2">
              {nodes.map(({ type, label: nodeLabel, description }) => {
                const color = AGENT_COLORS[type] || '#6B7280';
                return (
                  <div
                    key={type}
                    draggable
                    onDragStart={(e) => handleDragStart(e, type)}
                    onClick={() => onAddNode(type)}
                    className="flex items-center space-x-3 p-3 bg-[#0F172A] rounded-lg border border-gray-700/50 cursor-grab hover:bg-dark-surface-hover hover:border-gray-600 transition-all active:cursor-grabbing"
                    style={{ borderLeftColor: color, borderLeftWidth: '4px' }}
                  >
                    <div
                      className="p-2 rounded-md"
                      style={{ backgroundColor: `${color}20` }}
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ background: color }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-100">{nodeLabel}</p>
                      <p className="text-xs text-gray-500 truncate">{description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
