'use client';

import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Play, Square, Cog, GitBranch, GitMerge, Clock, Variable, Shuffle, Bell, MoreVertical } from 'lucide-react';
import { NODE_TYPE_MAP, WorkflowNodeType } from '@/types/workflow';

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

// 定义节点数据类型
interface NodeData {
  label: string;
  description?: string;
  config?: Record<string, any>;
  inputs?: any[];
  outputs?: any[];
  type?: WorkflowNodeType;
  workflowConfig?: {
    startNodeLabel: string;
    startNodeDescription: string;
    endNodeLabel: string;
    endNodeDescription: string;
  };
  roleId?: string | null;
  roleColor?: string;
  inheritedRoleId?: string | null;
  inheritedRoleColor?: string;
  [key: string]: any; // 添加索引签名
}

// 基础节点组件（左右连接 - 用于开始、结束、Agent）
const BaseNode = memo((props: NodeProps) => {
  const { data, type, selected } = props;
  const nodeData = data as NodeData;
  // 从 props.type 获取节点类型（如 'start', 'end', 'task'）
  const nodeType = NODE_TYPE_MAP[type as WorkflowNodeType] || null;
  const Icon = iconMap[nodeType?.icon || 'Cog'];

  // 对于开始和结束节点，从 workflowConfig 读取 label 和 description
  let displayLabel = nodeData.label;
  let displayDescription = nodeData.description;
  
  if (type === 'start' && nodeData.workflowConfig) {
    displayLabel = nodeData.workflowConfig.startNodeLabel;
    displayDescription = nodeData.workflowConfig.startNodeDescription;
  } else if (type === 'end' && nodeData.workflowConfig) {
    displayLabel = nodeData.workflowConfig.endNodeLabel;
    displayDescription = nodeData.workflowConfig.endNodeDescription;
  }

  const handleStyle = {
    width: '12px',
    height: '12px',
    border: '2px solid white',
    borderRadius: '50%',
    backgroundColor: nodeType?.color || '#3B82F6',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    transition: 'all 0.2s',
  };

  return (
    <div
      className="relative min-w-[100px] w-[100px] rounded-md border bg-white shadow-sm transition-all"
      style={{ 
        borderColor: nodeType?.color || '#3B82F6', 
        borderWidth: '1.5px',
        overflow: 'visible',
      }}
    >
      {/* 角色颜色标识 */}
      {nodeData.roleId && nodeData.roleColor && (
        <div
          className="absolute top-0 left-0 w-2 h-full rounded-l-md"
          style={{ backgroundColor: nodeData.roleColor }}
        />
      )}
      
      {/* 输入句柄 - 左侧 */}
      {nodeType?.inputs && nodeType.inputs.length > 0 && nodeType.inputs.map((input, index) => (
        <Handle
          key={input.id}
          type="target"
          position={Position.Left}
          id={input.id}
          style={{
            ...handleStyle,
            backgroundColor: nodeType?.color || '#3B82F6',
            top: `${((index + 1) / (nodeType.inputs.length + 1)) * 100}%`,
            left: '-8px',
          }}
        />
      ))}

      {/* 节点内容 */}
      <div className="p-1.5">
        <div className="flex items-center space-x-1.5">
          <div
            className="p-1 rounded flex-shrink-0"
            style={{ backgroundColor: `${nodeType?.color}15` || '#3B82F615' }}
          >
            <Icon size={12} style={{ color: nodeType?.color || '#3B82F6' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[10px] font-medium text-gray-900 truncate leading-tight">
              {displayLabel}
            </h3>
          </div>
        </div>
      </div>

      {/* 输出句柄 - 右侧 */}
      {nodeType?.outputs && nodeType.outputs.length > 0 && nodeType.outputs.map((output, index) => (
        <Handle
          key={output.id}
          type="source"
          position={Position.Right}
          id={output.id}
          style={{
            ...handleStyle,
            backgroundColor: nodeType?.color || '#3B82F6',
            top: `${((index + 1) / (nodeType.outputs.length + 1)) * 100}%`,
            right: '-8px',
          }}
        />
      ))}
    </div>
  );
});

BaseNode.displayName = 'BaseNode';

// 子Agent节点组件（上下连接 - 挂在Agent下方）
const SubtaskNode = memo((props: NodeProps) => {
  const { data, type, selected } = props;
  const nodeData = data as NodeData;
  const nodeType = NODE_TYPE_MAP[type as WorkflowNodeType] || null;
  const Icon = iconMap[nodeType?.icon || 'Cog'];

  const handleStyle = {
    width: '12px',
    height: '12px',
    border: '2px solid white',
    borderRadius: '50%',
    backgroundColor: nodeType?.color || '#8B5CF6',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    transition: 'all 0.2s',
  };

  return (
    <div
      className="relative min-w-[80px] w-[80px] rounded-md border bg-white shadow-sm transition-all"
      style={{ 
        borderColor: nodeType?.color || '#8B5CF6', 
        borderWidth: '1.5px',
        overflow: 'visible',
      }}
    >
      {/* 继承角色颜色标识 */}
      {nodeData.inheritedRoleId && nodeData.inheritedRoleColor && (
        <div
          className="absolute top-0 left-0 w-2 h-full rounded-l-md"
          style={{ backgroundColor: nodeData.inheritedRoleColor }}
        />
      )}
      
      {/* 输入句柄 - 顶部 */}
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        style={{
          ...handleStyle,
          backgroundColor: nodeType?.color || '#8B5CF6',
          top: '-8px',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />

      {/* 节点内容 */}
      <div className="p-1.5">
        <div className="flex items-center space-x-1">
          <div
            className="p-0.5 rounded flex-shrink-0"
            style={{ backgroundColor: `${nodeType?.color}15` || '#8B5CF615' }}
          >
            <Icon size={10} style={{ color: nodeType?.color || '#8B5CF6' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[10px] font-medium text-gray-900 truncate leading-tight">
              {nodeData.label}
            </h3>
          </div>
        </div>
      </div>

      {/* 输出句柄 - 底部 */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        style={{
          ...handleStyle,
          backgroundColor: nodeType?.color || '#8B5CF6',
          bottom: '-8px',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />
    </div>
  );
});

SubtaskNode.displayName = 'SubtaskNode';

// 开始节点
export const StartNode = memo((props: NodeProps) => {
  return <BaseNode {...props} />;
});

StartNode.displayName = 'StartNode';

// 结束节点
export const EndNode = memo((props: NodeProps) => {
  return <BaseNode {...props} />;
});

EndNode.displayName = 'EndNode';

// Agent节点（三个连接点：左输入、右输出、底子Agent输出）
export const TaskNode = memo((props: NodeProps) => {
  const { data, type, selected } = props;
  const nodeData = data as NodeData;
  const nodeType = NODE_TYPE_MAP[type as WorkflowNodeType] || null;
  const Icon = iconMap[nodeType?.icon || 'Cog'];

  const handleStyle = {
    width: '12px',
    height: '12px',
    border: '2px solid white',
    borderRadius: '50%',
    backgroundColor: nodeType?.color || '#3B82F6',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    transition: 'all 0.2s',
  };

  const subtaskHandleStyle = {
    width: '12px',
    height: '12px',
    border: '2px solid white',
    borderRadius: '50%',
    backgroundColor: '#8B5CF6', // 子Agent节点颜色
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    transition: 'all 0.2s',
  };

  return (
    <div
      className="relative min-w-[100px] w-[100px] rounded-md border bg-white shadow-sm transition-all"
      style={{ 
        borderColor: nodeType?.color || '#3B82F6', 
        borderWidth: '1.5px',
        overflow: 'visible',
      }}
    >
      {/* 角色颜色标识 */}
      {nodeData.roleId && nodeData.roleColor && (
        <div
          className="absolute top-0 left-0 w-2 h-full rounded-l-md"
          style={{ backgroundColor: nodeData.roleColor }}
        />
      )}
      
      {/* 输入句柄 - 左侧 */}
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={{
          ...handleStyle,
          backgroundColor: nodeType?.color || '#3B82F6',
          left: '-8px',
          top: '50%',
          transform: 'translateY(-50%)',
        }}
      />

      {/* 节点内容 */}
      <div className="p-1.5">
        <div className="flex items-center space-x-1.5">
          <div
            className="p-1 rounded flex-shrink-0"
            style={{ backgroundColor: `${nodeType?.color}15` || '#3B82F615' }}
          >
            <Icon size={12} style={{ color: nodeType?.color || '#3B82F6' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[10px] font-medium text-gray-900 truncate leading-tight">
              {nodeData.label}
            </h3>
          </div>
        </div>
      </div>

      {/* 输出句柄 - 右侧 */}
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{
          ...handleStyle,
          backgroundColor: nodeType?.color || '#3B82F6',
          right: '-8px',
          top: '50%',
          transform: 'translateY(-50%)',
        }}
      />

      {/* 子Agent输出句柄 - 底部 */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="subtask"
        style={{
          ...subtaskHandleStyle,
          bottom: '-8px',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />
    </div>
  );
});

TaskNode.displayName = 'TaskNode';

// 节点类型映射
export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  task: TaskNode,
  subtask: SubtaskNode,
};
