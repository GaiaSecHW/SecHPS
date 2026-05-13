/**
 * AgentFlow pipeline.py 解析器
 *
 * 从 Python DSL 源码中提取 pipeline 的 DAG 结构。
 * 支持所有 AgentFlow DSL 元素：
 * - 8 种内置 agent: codex, claude, kimi, opencode, pi, python_node, shell, sync
 * - 自定义 agent: agent("name", ...)
 * - fanout / merge / evolve
 * - >> 边（简单、扇出、汇聚、链式）
 * - on_failure 循环回退边
 */

export interface PipelineNode {
  id: string;
  agent: string;
  prompt?: string;
  model?: string;
  tools?: string;
  target?: string;
  capture?: string;
  dependsOn: string[];
  failureEdges?: string[];
  isFanout?: boolean;
}

export interface PipelineEdge {
  from: string;
  to: string;
  isFailure: boolean;
}

export interface PipelineData {
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  fanouts: Record<string, string[]>;
}

// 所有内置 agent 类型
const AGENT_FUNCS = ['codex', 'claude', 'kimi', 'opencode', 'pi', 'python_node', 'shell', 'sync'];
// prompt 在不同 agent 中的参数名
const PROMPT_KEYS: Record<string, string> = {
  python_node: 'code',
  shell: 'script',
  sync: 'mode',
};

export function parsePipelinePy(source: string): PipelineData | null {
  try {
    // 1. 提取 Graph 名称
    const nameMatch = source.match(/Graph\s*\(\s*["']([^"']+)["']/);
    const name = nameMatch?.[1] ?? 'unknown-pipeline';

    const nodeMap = new Map<string, { id: string; agent: string; prompt?: string; model?: string; tools?: string; target?: string; capture?: string }>();

    // 2a. 提取标准 agent 节点: var = codex(task_id="xxx", ...)
    const agentPattern = new RegExp(`(\\w+)\\s*=\\s*(${AGENT_FUNCS.join('|')})\\s*\\(`, 'g');
    let match;
    while ((match = agentPattern.exec(source)) !== null) {
      const varName = match[1];
      const agent = match[2];
      const argsText = extractBalancedParens(source, match.index + match[0].length - 1);
      if (!argsText) continue;

      const taskId = extractKwarg(argsText, 'task_id');
      if (!taskId) continue;

      const promptKey = PROMPT_KEYS[agent] ?? 'prompt';
      nodeMap.set(varName, {
        id: taskId,
        agent,
        prompt: extractTruncated(argsText, promptKey, 100),
        model: extractKwarg(argsText, 'model') || undefined,
        tools: extractKwarg(argsText, 'tools') || undefined,
        target: extractTarget(argsText),
        capture: extractKwarg(argsText, 'capture') || undefined,
      });
    }

    // 2b. 提取自定义 agent 节点: var = agent("name", task_id="xxx", ...)
    const customAgentPattern = /(\w+)\s*=\s*agent\s*\(\s*["']([^"']+)["']/g;
    while ((match = customAgentPattern.exec(source)) !== null) {
      const varName = match[1];
      const agentName = match[2];
      const argsText = extractBalancedParens(source, source.indexOf('(', match.index));
      if (!argsText) continue;

      const taskId = extractKwarg(argsText, 'task_id');
      if (!taskId) continue;

      nodeMap.set(varName, {
        id: taskId,
        agent: agentName,
        prompt: extractTruncated(argsText, 'prompt', 100),
        model: extractKwarg(argsText, 'model') || undefined,
        tools: extractKwarg(argsText, 'tools') || undefined,
        target: extractTarget(argsText),
      });
    }

    // 2c. 提取 evolve 节点: var = evolve(source, ...)
    const evolvePattern = /(\w+)\s*=\s*evolve\s*\(/g;
    while ((match = evolvePattern.exec(source)) !== null) {
      const varName = match[1];
      const argsText = extractBalancedParens(source, match.index + match[0].length - 1);
      if (!argsText) continue;
      const taskId = extractKwarg(argsText, 'task_id') ?? `evolve_${varName}`;
      nodeMap.set(varName, { id: taskId, agent: 'evolve', prompt: 'Agent Evolution' });
    }

    // 3. 提取 fanout / merge 定义（即使 nodeMap 为空也要处理，因为 agent 可能全部嵌套）
    const fanoutGroups: Record<string, string[]> = {};

    // fanout: var = fanout(node_expr, source)
    const fanoutPattern = /(\w+)\s*=\s*fanout\s*\(/g;
    while ((match = fanoutPattern.exec(source)) !== null) {
      const fanoutVar = match[1];
      const argsText = extractBalancedParens(source, match.index + match[0].length - 1);
      if (!argsText) continue;

      // 找内部 agent 调用
      const innerAgentMatch = argsText.match(new RegExp(`(${AGENT_FUNCS.join('|')})\\s*\\(`));
      if (innerAgentMatch) {
        const innerArgsText = extractBalancedParens(argsText, argsText.indexOf(innerAgentMatch[0]) + innerAgentMatch[0].length - 1);
        if (innerArgsText) {
          const taskId = extractKwarg(innerArgsText, 'task_id');
          if (taskId) {
            const promptKey = PROMPT_KEYS[innerAgentMatch[1]] ?? 'prompt';
            nodeMap.set(taskId, {
              id: taskId,
              agent: innerAgentMatch[1],
              prompt: extractTruncated(innerArgsText, promptKey, 100),
              model: extractKwarg(innerArgsText, 'model') || undefined,
              tools: extractKwarg(innerArgsText, 'tools') || undefined,
            });

            const listMatch = argsText.match(/\[\s*\{[^}]+\}\s*(?:,\s*\{[^}]+\}\s*)*\]/);
            const intMatch = argsText.match(/,\s*(\d+)\s*[,\)]/);
            let count = 3;
            if (listMatch) count = listMatch[0].split('{').length - 1;
            else if (intMatch) count = Math.min(parseInt(intMatch[1]), 20);

            const members: string[] = [];
            for (let i = 0; i < count; i++) members.push(`${taskId}_${i}`);
            fanoutGroups[taskId] = members;
          }
        }
      }
      nodeMap.set(fanoutVar, {
        id: nodeMap.get(fanoutVar)?.id ?? fanoutVar,
        agent: nodeMap.get(fanoutVar)?.agent ?? 'fanout',
      });
    }

    // merge: var = merge(node_expr, source, by=[...] / size=N)
    const mergePattern = /(\w+)\s*=\s*merge\s*\(/g;
    while ((match = mergePattern.exec(source)) !== null) {
      const mergeVar = match[1];
      const argsText = extractBalancedParens(source, match.index + match[0].length - 1);
      if (!argsText) continue;

      const innerAgentMatch = argsText.match(new RegExp(`(${AGENT_FUNCS.join('|')})\\s*\\(`));
      if (innerAgentMatch) {
        const innerArgsText = extractBalancedParens(argsText, argsText.indexOf(innerAgentMatch[0]) + innerAgentMatch[0].length - 1);
        if (innerArgsText) {
          const taskId = extractKwarg(innerArgsText, 'task_id') ?? mergeVar;
          const promptKey = PROMPT_KEYS[innerAgentMatch[1]] ?? 'prompt';
          nodeMap.set(mergeVar, {
            id: taskId,
            agent: innerAgentMatch[1] ?? 'merge',
            prompt: extractTruncated(innerArgsText, promptKey, 100) ?? 'Merge / Reduce',
            model: extractKwarg(innerArgsText, 'model') || undefined,
            tools: extractKwarg(innerArgsText, 'tools') || undefined,
          });
        }
      } else {
        nodeMap.set(mergeVar, { id: mergeVar, agent: 'merge', prompt: 'Merge / Reduce' });
      }
    }

    if (nodeMap.size === 0) return null;

    // 4. 提取所有边
    const edgeList: Array<{ from: string[]; to: string[]; isFailure: boolean }> = [];

    // 用行 + 续行处理（处理多行语句）
    const stmts = source.replace(/\\\n/g, ' ').split('\n');
    for (const stmt of stmts) {
      const trimmed = stmt.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('with') || trimmed.startsWith('print')) continue;

      // 按 >> 分割处理链式边: plan >> review >> summary
      // 但要先识别 [a, b] >> c 的模式
      const tokens: Array<{ type: 'var' | 'list'; value: string[]; isFailure: boolean }> = [];
      // 用 >> 分割，保留每段
      const parts = trimmed.split(/\s*>>\s*/);
      for (let i = 0; i < parts.length; i++) {
        let part = parts[i].trim();
        if (!part) continue;
        // 去掉行尾注释
        const commentIdx = part.indexOf('#');
        if (commentIdx >= 0) part = part.substring(0, commentIdx).trim();
        if (!part) continue;
        const isFailure = part.includes('.on_failure');
        const clean = part.replace(/\.on_failure/g, '');
        if (clean.startsWith('[') && clean.endsWith(']')) {
          tokens.push({ type: 'list', value: parseVarList(clean), isFailure });
        } else {
          tokens.push({ type: 'var', value: [clean], isFailure });
        }
      }

      // 从 tokens 构建边：相邻 token 之间
      for (let i = 0; i < tokens.length - 1; i++) {
        const from = tokens[i];
        const to = tokens[i + 1];
        const isFailure = from.isFailure || to.isFailure;
        edgeList.push({ from: from.value, to: to.value, isFailure });
      }
    }

    // 5. 构建结果
    const nodes: PipelineNode[] = [];
    const edges: PipelineEdge[] = [];
    const varToId = new Map<string, string>();
    for (const [v, info] of nodeMap.entries()) varToId.set(v, info.id);

    // 解析边的依赖
    const dependsMap = new Map<string, string[]>();
    const failureMap = new Map<string, string[]>();

    for (const edge of edgeList) {
      const fromIds = edge.from.map(v => varToId.get(v) ?? v).filter(Boolean);
      const toIds = edge.to.map(v => varToId.get(v) ?? v).filter(Boolean);

      for (const toId of toIds) {
        for (const fromId of fromIds) {
          edges.push({ from: fromId, to: toId, isFailure: edge.isFailure });

          if (edge.isFailure) {
            const list = failureMap.get(toId) ?? [];
            if (!list.includes(fromId)) list.push(fromId);
            failureMap.set(toId, list);
          } else {
            const list = dependsMap.get(toId) ?? [];
            if (!list.includes(fromId)) list.push(fromId);
            dependsMap.set(toId, list);
          }
        }
      }
    }

    // Fanout 成员节点
    for (const [groupId, members] of Object.entries(fanoutGroups)) {
      for (let i = 0; i < members.length; i++) {
        const src = nodeMap.get(groupId) ?? { id: groupId, agent: 'unknown' };
        nodes.push({
          id: members[i],
          agent: src.agent ?? 'unknown',
          prompt: src.prompt ? `${src.prompt} [#${i + 1}]` : `Fanout #${i + 1}`,
          model: src.model,
          tools: src.tools,
          target: src.target,
          dependsOn: dependsMap.get(members[i]) ?? dependsMap.get(groupId) ?? [],
        });
      }
    }

    // 普通节点
    const fanoutIds = new Set(Object.keys(fanoutGroups));
    for (const [, info] of nodeMap.entries()) {
      if (fanoutIds.has(info.id) && Object.keys(fanoutGroups).length > 0) continue;
      if (nodes.some(n => n.id === info.id)) continue;
      nodes.push({
        id: info.id,
        agent: info.agent,
        prompt: info.prompt,
        model: info.model,
        tools: info.tools,
        target: info.target,
        capture: info.capture,
        dependsOn: dependsMap.get(info.id) ?? [],
        failureEdges: failureMap.get(info.id),
      });
    }

    return { name, nodes, edges, fanouts: fanoutGroups };
  } catch {
    return null;
  }
}

function extractBalancedParens(source: string, openIndex: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '(') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (source[i] === ')') {
      depth--;
      if (depth === 0 && start >= 0) return source.substring(start, i);
    }
  }
  return null;
}

function extractKwarg(argsText: string, key: string): string | null {
  const strMatch = argsText.match(new RegExp(`${key}\\s*=\\s*["']([^"']*?)["']`));
  if (strMatch) return strMatch[1];
  const multiMatch = argsText.match(new RegExp(`${key}\\s*=\\s*(?:"""|''')([\\s\\S]*?)(?:"""|''')`));
  if (multiMatch) return multiMatch[1].trim();
  const parenMatch = argsText.match(new RegExp(`${key}\\s*=\\s*\\(([\\s\\S]*?)\\)\\s*[,)]`));
  if (parenMatch) return parenMatch[1].replace(/\s+/g, ' ').trim();
  return null;
}

function extractTruncated(argsText: string, key: string, max: number): string | undefined {
  const val = extractKwarg(argsText, key);
  if (!val) return undefined;
  return val.length <= max ? val : val.substring(0, max) + '...';
}

function extractTarget(argsText: string): string | undefined {
  const m = argsText.match(/target\s*=\s*\{[^}]*"kind"\s*:\s*"(\w+)"/);
  return m?.[1] ?? undefined;
}

function parseVarList(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
  }
  return [trimmed];
}
