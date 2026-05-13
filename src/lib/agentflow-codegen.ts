export interface AgentFlowNodeData {
  nodeType: 'codex' | 'claude' | 'kimi' | 'opencode' | 'pi'
          | 'python_node' | 'shell' | 'sync' | 'custom'
          | 'fanout' | 'merge' | 'evolve';
  taskId: string;
  prompt?: string;
  model?: string;
  tools?: 'read_only' | 'read_write';
  skills?: string[];
  mcps?: string[];
  capture?: 'final' | 'trace';
  timeoutSeconds?: number;
  retries?: number;
  code?: string;
  script?: string;
  mode?: 'repo' | 'full';
  agentName?: string;
  innerAgentType?: string;
  fanoutSourceCount?: number;
  fanoutSourceValues?: string[];
  fanoutSourceMatrix?: Record<string, string[]>;
  mergeSourceNodeId?: string;
  mergeBy?: string[];
  mergeSize?: number;
  evolveTarget?: string;
  evolveOptimizer?: string;
}

export interface AgentFlowNode {
  id: string;
  type: 'agentFlowNode';
  position: { x: number; y: number };
  data: AgentFlowNodeData;
}

export interface AgentFlowEdge {
  id: string;
  source: string;
  target: string;
  data?: { isFailure: boolean };
}

const PYTHON_KEYWORDS = new Set([
  'for', 'if', 'while', 'class', 'return', 'import', 'from', 'def',
  'with', 'as', 'try', 'except', 'finally', 'raise', 'yield', 'lambda',
  'pass', 'break', 'continue', 'else', 'elif', 'del', 'global', 'nonlocal',
  'assert', 'and', 'or', 'not', 'is', 'in'
]);

const FIXED_SYMBOL_ORDER = [
  'Graph', 'codex', 'claude', 'kimi', 'opencode', 'pi', 'python_node',
  'shell', 'sync', 'agent', 'fanout', 'merge', 'evolve'
];

function collectImportSymbols(nodes: AgentFlowNode[]): string[] {
  const used = new Set<string>(['Graph']);

  nodes.forEach(node => {
    const { nodeType, innerAgentType } = node.data;
    if (nodeType === 'custom') {
      used.add('agent');
    } else if (nodeType === 'fanout' || nodeType === 'merge') {
      used.add(nodeType);
      if (innerAgentType && FIXED_SYMBOL_ORDER.includes(innerAgentType)) {
        used.add(innerAgentType);
      }
    } else if (nodeType === 'evolve') {
      used.add('evolve');
    } else if (FIXED_SYMBOL_ORDER.includes(nodeType)) {
      used.add(nodeType === 'python_node' ? 'python_node' : nodeType);
    }
  });

  return FIXED_SYMBOL_ORDER.filter(s => used.has(s));
}

function toPythonVarName(taskId: string, usedNames: Set<string>): string {
  let name = taskId.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^[0-9]/.test(name)) {
    name = 'n_' + name;
  }
  if (PYTHON_KEYWORDS.has(name)) {
    name = name + '_';
  }

  let finalName = name;
  let suffix = 2;
  while (usedNames.has(finalName)) {
    finalName = name + '_' + suffix++;
  }
  usedNames.add(finalName);
  return finalName;
}

function topologicalSort(nodes: AgentFlowNode[], edges: AgentFlowEdge[]): AgentFlowNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  nodes.forEach(n => inDegree.set(n.id, 0));
  edges.forEach(e => {
    if (!e.data?.isFailure) {
      adj.set(e.source, [...(adj.get(e.source) || []), e.target]);
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }
  });

  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const sorted: AgentFlowNode[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node && !visited.has(id)) {
      sorted.push(node);
      visited.add(id);
    }

    (adj.get(id) || []).forEach(target => {
      const newDeg = (inDegree.get(target) || 0) - 1;
      inDegree.set(target, newDeg);
      if (newDeg === 0) queue.push(target);
    });
  }

  nodes.forEach(n => {
    if (!visited.has(n.id)) {
      sorted.push(n);
    }
  });

  return sorted;
}

function formatParamValue(val: string | string[] | Record<string, unknown>): string {
  if (Array.isArray(val)) {
    return '[' + val.map(v => JSON.stringify(v)).join(', ') + ']';
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val).map(([k, v]) => {
      const vStr = Array.isArray(v) ? formatParamValue(v) : JSON.stringify(v);
      return `"${k}": ${vStr}`;
    });
    return '{' + entries.join(', ') + '}';
  }
  return JSON.stringify(val);
}

function generateNodeParams(data: AgentFlowNodeData, nodeType: string): string[] {
  const params: string[] = [];

  const skipDefault = (val: unknown, def: unknown) => {
    if (val === undefined || val === def) return true;
    if (Array.isArray(val) && val.length === 0) return true;
    return false;
  };

  if (nodeType === 'custom') {
    if (data.prompt !== undefined) params.push(`prompt=${formatParamValue(data.prompt)}`);
    if (!skipDefault(data.model, undefined)) params.push(`model=${JSON.stringify(data.model)}`);
    if (!skipDefault(data.tools, 'read_only')) params.push(`tools=${JSON.stringify(data.tools)}`);
    if (!skipDefault(data.mcps, [])) params.push(`mcps=${formatParamValue(data.mcps!)}`);
    if (!skipDefault(data.skills, [])) params.push(`skills=${formatParamValue(data.skills!)}`);
    if (!skipDefault(data.capture, 'final')) params.push(`capture=${JSON.stringify(data.capture)}`);
    if (!skipDefault(data.timeoutSeconds, 1800)) params.push(`timeout_seconds=${data.timeoutSeconds}`);
    if (!skipDefault(data.retries, 0)) params.push(`retries=${data.retries}`);
    return params;
  }

  if (nodeType === 'python_node') {
    if (data.code !== undefined) params.push(`code=${formatParamValue(data.code)}`);
  } else if (nodeType === 'shell') {
    if (data.script !== undefined) params.push(`script=${formatParamValue(data.script)}`);
  } else if (nodeType === 'sync') {
    if (data.mode !== undefined) params.push(`mode=${JSON.stringify(data.mode)}`);
  } else {
    if (data.prompt !== undefined) params.push(`prompt=${formatParamValue(data.prompt)}`);
  }

  if (!['python_node', 'shell', 'sync'].includes(nodeType)) {
    if (!skipDefault(data.model, undefined)) {
      params.push(`model=${JSON.stringify(data.model)}`);
    }
  }

  if (!['kimi', 'python_node', 'shell', 'sync', 'pi'].includes(nodeType)) {
    if (!skipDefault(data.tools, 'read_only')) {
      params.push(`tools=${JSON.stringify(data.tools)}`);
    }
  }

  if (!['kimi', 'python_node', 'shell', 'sync'].includes(nodeType)) {
    if (!skipDefault(data.mcps, [])) {
      params.push(`mcps=${formatParamValue(data.mcps!)}`);
    }
  }

  if (!skipDefault(data.skills, [])) {
    params.push(`skills=${formatParamValue(data.skills!)}`);
  }

  if (!skipDefault(data.capture, 'final')) {
    params.push(`capture=${JSON.stringify(data.capture)}`);
  }

  if (!skipDefault(data.timeoutSeconds, 1800)) {
    params.push(`timeout_seconds=${data.timeoutSeconds}`);
  }

  if (!skipDefault(data.retries, 0)) {
    params.push(`retries=${data.retries}`);
  }

  return params;
}

function generateNodeStatement(
  node: AgentFlowNode,
  varName: string,
  varMap: Map<string, string>
): string {
  const { nodeType, taskId, agentName, innerAgentType, evolveTarget, evolveOptimizer } = node.data;
  const isEvolve = nodeType === 'evolve';

  if (isEvolve) {
    return `${varName} = evolve(...)`;
  }

  if (nodeType === 'fanout') {
    const agentType = innerAgentType || 'codex';
    const params = generateNodeParams(node.data, agentType);
    const agentExpr = `${agentType}(\n        task_id="${taskId}"${params.length ? ',\n        ' + params.join(',\n        ') : ''}\n    )`;
    let source: string;
    if (node.data.fanoutSourceCount !== undefined) {
      source = String(node.data.fanoutSourceCount);
    } else if (node.data.fanoutSourceValues) {
      source = formatParamValue(node.data.fanoutSourceValues);
    } else if (node.data.fanoutSourceMatrix) {
      source = formatParamValue(node.data.fanoutSourceMatrix);
    } else {
      source = '1';
    }
    return `${varName} = fanout(${agentExpr}, ${source})`;
  }

  if (nodeType === 'merge') {
    const agentType = innerAgentType || 'codex';
    const params = generateNodeParams(node.data, agentType);
    const agentExpr = `${agentType}(\n        task_id="${taskId}"${params.length ? ',\n        ' + params.join(',\n        ') : ''}\n    )`;
    const sourceVar = node.data.mergeSourceNodeId ? varMap.get(node.data.mergeSourceNodeId) || '_source' : '_source';
    const extra: string[] = [];
    if (node.data.mergeBy && node.data.mergeBy.length > 0) {
      extra.push(`by=${formatParamValue(node.data.mergeBy)}`);
    }
    if (node.data.mergeSize !== undefined) {
      extra.push(`size=${node.data.mergeSize}`);
    }
    return `${varName} = merge(${agentExpr}, ${sourceVar}${extra.length ? ', ' + extra.join(', ') : ''})`;
  }

  if (nodeType === 'custom') {
    const params = generateNodeParams(node.data, 'custom');
    const name = agentName || 'custom';
    return `${varName} = agent("${name}"${params.length ? ',\n        ' + params.join(',\n        ') : ''})`;
  }

  const params = generateNodeParams(node.data, nodeType);
  return `${varName} = ${nodeType}(\n    task_id="${taskId}"${params.length ? ',\n    ' + params.join(',\n    ') : ''}\n)`;
}

function generateEvolveStatements(
  nodes: AgentFlowNode[],
  edges: AgentFlowEdge[],
  varMap: Map<string, string>,
  evolveIndex: { value: number }
): string[] {
  const evolveNodes = nodes.filter(n => n.data.nodeType === 'evolve');
  const statements: string[] = [];

  const incomingEdges = new Map<string, string[]>();
  edges.filter(e => !e.data?.isFailure).forEach(e => {
    incomingEdges.set(e.target, [...(incomingEdges.get(e.target) || []), e.source]);
  });

  evolveNodes.forEach(node => {
    const sources = incomingEdges.get(node.id) || [];
    const { evolveTarget = 'codex', evolveOptimizer = 'codex' } = node.data;
    const varName = `evolve_${evolveIndex.value++}`;
    varMap.set(node.id, varName);

    let sourceExpr: string;
    if (sources.length === 0) {
      sourceExpr = '_';
    } else if (sources.length === 1) {
      sourceExpr = varMap.get(sources[0]) || '_';
    } else {
      const sourceVars = sources.map(s => varMap.get(s) || '_');
      sourceExpr = '[' + sourceVars.join(', ') + ']';
    }

    const params: string[] = [];
    if (evolveTarget !== 'codex') params.push(`target="${evolveTarget}"`);
    if (evolveOptimizer !== 'codex') params.push(`optimizer="${evolveOptimizer}"`);

    statements.push(`${varName} = evolve(${sourceExpr}${params.length ? ', ' + params.join(', ') : ''})`);
  });

  return statements;
}

function generateEdgeStatements(
  nodes: AgentFlowNode[],
  edges: AgentFlowEdge[],
  varMap: Map<string, string>
): string[] {
  const statements: string[] = [];
  const failureEdges: string[] = [];

  const outEdges = new Map<string, AgentFlowEdge[]>();
  const inEdges = new Map<string, AgentFlowEdge[]>();

  edges.forEach(e => {
    if (e.data?.isFailure) {
      failureEdges.push(`${varMap.get(e.source) || e.source}.on_failure >> ${varMap.get(e.target) || e.target}`);
    } else {
      outEdges.set(e.source, [...(outEdges.get(e.source) || []), e]);
      inEdges.set(e.target, [...(inEdges.get(e.target) || []), e]);
    }
  });

  const processed = new Set<string>();
  const evolveNodeIds = new Set(nodes.filter(n => n.data.nodeType === 'evolve').map(n => n.id));

  const findChain = (startId: string): string[] => {
    const chain: string[] = [startId];
    let current = startId;
    while (true) {
      const outs = outEdges.get(current) || [];
      if (outs.length !== 1) break;
      const nextEdge = outs[0];
      const nextId = nextEdge.target;
      const nextIns = inEdges.get(nextId) || [];
      if (nextIns.length !== 1 || nextIns[0].source !== current) break;
      if (evolveNodeIds.has(nextId)) break;
      chain.push(nextId);
      current = nextId;
    }
    return chain;
  };

  const pendingStarts = [...outEdges.keys()].filter(id => !inEdges.has(id) || inEdges.get(id)!.every(e => evolveNodeIds.has(e.source)));

  while (pendingStarts.length > 0) {
    const startId = pendingStarts.shift()!;
    if (processed.has(startId)) continue;
    const chain = findChain(startId);
    if (chain.length === 0) {
      processed.add(startId);
      continue;
    }

    const lastId = chain[chain.length - 1];
    const outs = outEdges.get(lastId) || [];
    const nonEvolveOuts = outs.filter(e => !evolveNodeIds.has(e.target));

    if (nonEvolveOuts.length === 0) {
      if (chain.length > 1) {
        const chainVars = chain.map(id => varMap.get(id) || id);
        statements.push(chainVars.join(' >> '));
      }
      chain.forEach(id => processed.add(id));
      continue;
    }

    const targets = nonEvolveOuts.map(e => e.target);
    if (targets.length === 1 && !processed.has(targets[0])) {
      const targetId = targets[0];
      const targetIns = inEdges.get(targetId) || [];
      if (targetIns.length === 1) {
        pendingStarts.unshift(targetId);
      } else {
        if (chain.length > 1) {
          const chainVars = chain.map(id => varMap.get(id) || id);
          statements.push(chainVars.join(' >> ') + ' >> ' + (varMap.get(targetId) || targetId));
        } else {
          statements.push(`${varMap.get(startId) || startId} >> ${varMap.get(targetId) || targetId}`);
        }
        processed.add(targetId);
      }
    } else {
      const targetVars = targets.map(t => varMap.get(t) || t);
      if (chain.length > 1) {
        const chainVars = chain.map(id => varMap.get(id) || id);
        statements.push(`${chainVars.join(' >> ')} >> [${targetVars.join(', ')}]`);
      } else {
        statements.push(`${varMap.get(startId) || startId} >> [${targetVars.join(', ')}]`);
      }
      targets.forEach(t => {
        if (!processed.has(t)) pendingStarts.push(t);
      });
    }

    chain.forEach(id => {
      const nodeOuts = outEdges.get(id) || [];
      nodeOuts.forEach(e => {
        if (evolveNodeIds.has(e.target) && !processed.has(e.target)) {
          pendingStarts.push(e.target);
        }
      });
    });
    chain.forEach(id => processed.add(id));
  }

  const remaining = [...(outEdges.keys() || [])].filter(source =>
    (outEdges.get(source) || []).some(e => !evolveNodeIds.has(e.target) && !processed.has(e.target))
  );

  remaining.forEach(source => {
    if (processed.has(source)) return;
    const outs = (outEdges.get(source) || []).filter(e => !evolveNodeIds.has(e.target));
    if (outs.length === 0) return;

    const targets = outs.map(e => e.target);
    const sourcesToTarget = targets.map(t =>
      (inEdges.get(t) || []).filter(e => !evolveNodeIds.has(e.source) && !processed.has(e.source)).length
    );

    if (targets.length === 1 && sourcesToTarget[0] === 1) {
      const target = targets[0];
      if (!processed.has(target)) {
        statements.push(`${varMap.get(source) || source} >> ${varMap.get(target) || target}`);
        processed.add(target);
      }
    } else {
      const targetVars = targets.map(t => varMap.get(t) || t);
      statements.push(`${varMap.get(source) || source} >> [${targetVars.join(', ')}]`);
    }
    processed.add(source);
  });

  const multiSourceTargets = new Set<string>();
  edges.filter(e => !e.data?.isFailure && !evolveNodeIds.has(e.target)).forEach(e => {
    const sources = (inEdges.get(e.target) || []).filter(ie => !evolveNodeIds.has(ie.source));
    if (sources.length > 1) {
      multiSourceTargets.add(e.target);
    }
  });

  multiSourceTargets.forEach(target => {
    if (processed.has(target)) return;
    const sources = (inEdges.get(target) || [])
      .filter(e => !evolveNodeIds.has(e.source))
      .map(e => e.source);

    const allProcessed = sources.every(s => processed.has(s));
    if (allProcessed && sources.length > 1) {
      const sourceVars = sources.map(s => varMap.get(s) || s);
      statements.push(`[${sourceVars.join(', ')}] >> ${varMap.get(target) || target}`);
      processed.add(target);
    }
  });

  return [...statements, ...failureEdges];
}

export function generatePipelinePy(
  name: string,
  nodes: AgentFlowNode[],
  edges: AgentFlowEdge[]
): string {
  const symbols = collectImportSymbols(nodes);
  const importStmt = `from agentflow import ${symbols.join(', ')}`;

  const usedNames = new Set<string>();
  const varMap = new Map<string, string>();

  nodes.forEach(node => {
    if (node.data.nodeType !== 'evolve') {
      const varName = toPythonVarName(node.data.taskId, usedNames);
      varMap.set(node.id, varName);
    }
  });

  const sortedNodes = topologicalSort(nodes, edges);
  const evolveIndex = { value: 1 };

  const evolveStatements = generateEvolveStatements(nodes, edges, varMap, evolveIndex);

  const nonEvolveNodes = sortedNodes.filter(n => n.data.nodeType !== 'evolve');
  const nodeStatements: string[] = [];

  nonEvolveNodes.forEach(node => {
    const varName = varMap.get(node.id) || node.data.taskId;
    nodeStatements.push('    ' + generateNodeStatement(node, varName, varMap));
  });

  evolveStatements.forEach(stmt => {
    nodeStatements.push('    ' + stmt);
  });

  const edgeStatements = generateEdgeStatements(nodes, edges, varMap);

  const edgeStmts = edgeStatements.map(s => '    ' + s).join('\n');

  return `${importStmt}

with Graph("${name}") as g:
${nodeStatements.join('\n')}

${edgeStmts}`;
}
