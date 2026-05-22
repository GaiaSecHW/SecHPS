'use client';

import { useMemo } from 'react';
import type { AgentFlowNode, AgentFlowNodeData, AgentFlowEdge } from '@/types/workflow';

const INNER_AGENT_TYPES = ['codex', 'claude', 'kimi', 'opencode', 'pi', 'python_node', 'shell'] as const;
const EVOLVE_AGENT_TYPES = ['codex', 'claude', 'kimi', 'opencode', 'pi'] as const;

interface NodeConfigPanelProps {
  node: AgentFlowNode | null;
  allNodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
  onUpdate: (nodeId: string, data: Partial<AgentFlowNodeData>) => void;
  availableModels: { name: string; displayName: string }[];
  availableSkills: { name: string; displayName: string }[];
  availableMcps: { name: string }[];
  className?: string;
}

export default function NodeConfigPanel({
  node,
  allNodes,
  edges,
  onUpdate,
  availableModels,
  availableSkills,
  availableMcps,
  className = 'w-80',
}: NodeConfigPanelProps) {
  const mergeByCandidates = useMemo(() => {
    if (!node) return [];
    const incomingEdges = edges.filter((e) => e.target === node.id);
    const sourceIds = incomingEdges.map((e) => e.source);
    return sourceIds;
  }, [node, edges]);

  const fanoutNodes = useMemo(() => {
    return allNodes.filter((n) => n.data.nodeType === 'fanout');
  }, [allNodes]);

  if (!node) {
    return (
      <div className={`${className} bg-[#0F172A] border-l border-gray-700/50 h-full flex items-center justify-center`}>
        <p className="text-sm text-gray-500">点击节点编辑属性</p>
      </div>
    );
  }

  const { data } = node;
  const isPythonNode = data.nodeType === 'python_node';
  const isShell = data.nodeType === 'shell';
  const isSync = data.nodeType === 'sync';
  const isCustom = data.nodeType === 'custom';
  const isFanout = data.nodeType === 'fanout';
  const isMerge = data.nodeType === 'merge';
  const isEvolve = data.nodeType === 'evolve';
  const isKimi = data.nodeType === 'kimi';
  const isPi = data.nodeType === 'pi';

  const showPrompt = !isPythonNode && !isShell && !isSync && !isEvolve;
  const showModel = !isPythonNode && !isShell && !isSync && !isEvolve;
  const showTools = !isKimi && !isPythonNode && !isShell && !isSync && !isPi && !isEvolve;
  const showSkills = !isSync && !isEvolve;
  const showMcps = !isPi && !isPythonNode && !isShell && !isSync && !isEvolve;

  const updateField = <K extends keyof AgentFlowNodeData>(key: K, value: AgentFlowNodeData[K]) => {
    onUpdate(node.id, { [key]: value });
  };

  return (
    <div className={`${className} bg-[#0F172A] border-l border-gray-700/50 h-full overflow-y-auto`}>
      <div className="p-4 border-b border-gray-700/50">
        <h3 className="text-sm font-semibold text-gray-200">节点属性</h3>
        <p className="text-xs text-gray-500 mt-1 truncate">{data.nodeType}</p>
      </div>

      <div className="p-4 space-y-4">
        {isEvolve ? (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">目标 Agent 类型</label>
              <select
                value={data.evolveTarget || 'codex'}
                onChange={(e) => updateField('evolveTarget', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {EVOLVE_AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">优化器 Agent 类型</label>
              <select
                value={data.evolveOptimizer || 'codex'}
                onChange={(e) => updateField('evolveOptimizer', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {EVOLVE_AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                任务 ID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={data.taskId || ''}
                onChange={(e) => updateField('taskId', e.target.value)}
                placeholder="task_id"
                className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {isCustom && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Agent 名称</label>
                <input
                  type="text"
                  value={data.agentName || ''}
                  onChange={(e) => updateField('agentName', e.target.value)}
                  placeholder="custom-agent-name"
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {showPrompt && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  提示词 <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={data.prompt || ''}
                  onChange={(e) => updateField('prompt', e.target.value)}
                  placeholder="输入任务提示..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            )}

            {isPythonNode && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Python 代码 <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={data.code || ''}
                  onChange={(e) => updateField('code', e.target.value)}
                  placeholder="# Python 代码"
                  rows={5}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-xs"
                />
              </div>
            )}

            {isShell && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Shell 脚本 <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={data.script || ''}
                  onChange={(e) => updateField('script', e.target.value)}
                  placeholder="# Shell 命令"
                  rows={5}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-xs"
                />
              </div>
            )}

            {isSync && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">同步模式</label>
                <select
                  value={data.mode || 'repo'}
                  onChange={(e) => updateField('mode', e.target.value as 'repo' | 'full')}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="repo">仅同步 .git</option>
                  <option value="full">同步整个目录</option>
                </select>
              </div>
            )}

            {(isFanout || isMerge) && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">内嵌 Agent 类型</label>
                <select
                  value={data.innerAgentType || 'codex'}
                  onChange={(e) => updateField('innerAgentType', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {INNER_AGENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isFanout && (
              <div className="border-t border-gray-700/50 pt-3">
                <label className="block text-xs font-medium text-gray-400 mb-2">扇出参数</label>
                <div className="space-y-2">
                  <div>
                    <label className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                      <input
                        type="radio"
                        name="fanout-source"
                        checked={data.fanoutSourceCount !== undefined}
                        onChange={() => {
                          updateField('fanoutSourceCount', 3);
                          updateField('fanoutSourceValues', undefined);
                          updateField('fanoutSourceMatrix', undefined);
                        }}
                        className="text-blue-500 focus:ring-blue-500"
                      />
                      按数量
                    </label>
                    {data.fanoutSourceCount !== undefined && (
                      <input
                        type="number"
                        min="1"
                        value={data.fanoutSourceCount}
                        onChange={(e) => updateField('fanoutSourceCount', parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                      <input
                        type="radio"
                        name="fanout-source"
                        checked={data.fanoutSourceValues !== undefined}
                        onChange={() => {
                          updateField('fanoutSourceValues', []);
                          updateField('fanoutSourceCount', undefined);
                          updateField('fanoutSourceMatrix', undefined);
                        }}
                        className="text-blue-500 focus:ring-blue-500"
                      />
                      按值列表
                    </label>
                    {data.fanoutSourceValues !== undefined && (
                      <input
                        type="text"
                        value={JSON.stringify(data.fanoutSourceValues)}
                        onChange={(e) => {
                          try {
                            updateField('fanoutSourceValues', JSON.parse(e.target.value));
                          } catch {
                            // ignore invalid JSON
                          }
                        }}
                        placeholder='["a", "b", "c"]'
                        className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {isMerge && (
              <div className="border-t border-gray-700/50 pt-3">
                <label className="block text-xs font-medium text-gray-400 mb-1">汇聚来源</label>
                <select
                  value={data.mergeSourceNodeId || ''}
                  onChange={(e) => updateField('mergeSourceNodeId', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">选择 fanout 节点</option>
                  {fanoutNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.data.taskId || n.id}
                    </option>
                  ))}
                </select>

                {mergeByCandidates.length > 0 && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-400 mb-1">按字段汇聚</label>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {mergeByCandidates.map((candidateId) => (
                        <label key={candidateId} className="flex items-center gap-2 text-xs text-gray-400">
                          <input
                            type="checkbox"
                            checked={data.mergeBy?.includes(candidateId) ?? true}
                            onChange={(e) => {
                              const current = data.mergeBy || mergeByCandidates;
                              if (e.target.checked) {
                                updateField('mergeBy', [...current, candidateId]);
                              } else {
                                updateField('mergeBy', current.filter((id) => id !== candidateId));
                              }
                              updateField('mergeSize', undefined);
                            }}
                            className="text-blue-500 focus:ring-blue-500"
                          />
                          {candidateId}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3">
                  <label className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                    <input
                      type="radio"
                      name="merge-mode"
                      checked={data.mergeSize !== undefined}
                      onChange={() => {
                        updateField('mergeSize', 1);
                        updateField('mergeBy', undefined);
                      }}
                      className="text-blue-500 focus:ring-blue-500"
                    />
                    按数量汇聚
                  </label>
                  {data.mergeSize !== undefined && (
                    <input
                      type="number"
                      min="1"
                      value={data.mergeSize}
                      onChange={(e) => updateField('mergeSize', parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              </div>
            )}

            {showModel && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">模型</label>
                <select
                  value={data.model || ''}
                  onChange={(e) => updateField('model', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">选择模型</option>
                  {availableModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showTools && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">工具权限</label>
                <select
                  value={data.tools || 'read_only'}
                  onChange={(e) => updateField('tools', e.target.value as 'read_only' | 'read_write')}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="read_only">只读</option>
                  <option value="read_write">读写</option>
                </select>
              </div>
            )}

            {showSkills && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Skills</label>
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {availableSkills.map((skill) => (
                    <label key={skill.name} className="flex items-center gap-2 text-xs text-gray-400">
                      <input
                        type="checkbox"
                        checked={data.skills?.includes(skill.name) ?? false}
                        onChange={(e) => {
                          const current = data.skills || [];
                          if (e.target.checked) {
                            updateField('skills', [...current, skill.name]);
                          } else {
                            updateField('skills', current.filter((s) => s !== skill.name));
                          }
                        }}
                        className="text-blue-500 focus:ring-blue-500"
                      />
                      {skill.displayName}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {showMcps && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">MCP 服务</label>
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {availableMcps.map((mcp) => (
                    <label key={mcp.name} className="flex items-center gap-2 text-xs text-gray-400">
                      <input
                        type="checkbox"
                        checked={data.mcps?.includes(mcp.name) ?? false}
                        onChange={(e) => {
                          const current = data.mcps || [];
                          if (e.target.checked) {
                            updateField('mcps', [...current, mcp.name]);
                          } else {
                            updateField('mcps', current.filter((m) => m !== mcp.name));
                          }
                        }}
                        className="text-blue-500 focus:ring-blue-500"
                      />
                      {mcp.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-gray-700/50 pt-3">
              <label className="block text-xs font-medium text-gray-400 mb-1">捕获模式</label>
              <select
                value={data.capture || 'final'}
                onChange={(e) => updateField('capture', e.target.value as 'final' | 'trace')}
                className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="final">最终结果</option>
                <option value="trace">完整追踪</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">超时(秒)</label>
                <input
                  type="number"
                  min="1"
                  value={data.timeoutSeconds || 1800}
                  onChange={(e) => updateField('timeoutSeconds', parseInt(e.target.value) || 1800)}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">重试次数</label>
                <input
                  type="number"
                  min="0"
                  value={data.retries ?? 0}
                  onChange={(e) => updateField('retries', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
