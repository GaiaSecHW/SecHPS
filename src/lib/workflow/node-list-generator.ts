/**
 * Node List Generator Service
 * 
 * Generates unified node definitions from workflows, supporting both FSM and DAG modes.
 */

import { prisma } from '@/lib/prisma';
import type { UnifiedNodeDefinition } from './types';

/**
 * Parse FSMTemplate.nodes JSON string into node definitions
 */
function parseFSMNodes(nodesJson: string): UnifiedNodeDefinition[] {
  try {
    const fsmNodes = JSON.parse(nodesJson);
    return fsmNodes.map((node: Record<string, unknown>, index: number) => ({
      id: String(node.id ?? `fsm-${index}`),
      label: String(node.label ?? `Phase ${node.fsmPhase ?? index}`),
      type: 'fsm_phase',
      roleId: node.roleId ? String(node.roleId) : null,
      fsmPhase: typeof node.fsmPhase === 'number' ? node.fsmPhase : null,
      fsmOrder: typeof node.fsmOrder === 'number' ? node.fsmOrder : (typeof node.fsmPhase === 'number' ? node.fsmPhase : index),
      fsmFixed: typeof node.fsmFixed === 'boolean' ? node.fsmFixed : null,
      skills: Array.isArray(node.skills) ? node.skills.map(String) : null,
      vulnerabilityCategories: [],
      description: node.description ? String(node.description) : null,
      skillPath: node.skillPath ? String(node.skillPath) : null,
      data: node as Record<string, unknown>,
    }));
  } catch {
    return [];
  }
}

/**
 * Topological sort using Kahn's algorithm for DAG workflows
 */
function topologicalSortDAG(
  nodes: Array<{ id: string }>,
  edges: Array<{ sourceId: string; targetId: string }>
): string[] {
  const adjacencyList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacencyList.set(node.id, []);
  }

  // Build graph
  for (const edge of edges) {
    const neighbors = adjacencyList.get(edge.sourceId) || [];
    neighbors.push(edge.targetId);
    adjacencyList.set(edge.sourceId, neighbors);
    inDegree.set(edge.targetId, (inDegree.get(edge.targetId) || 0) + 1);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(nodeId);
  }

  const sortedIds: string[] = [];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    sortedIds.push(currentId);
    for (const neighborId of adjacencyList.get(currentId) || []) {
      const newDegree = (inDegree.get(neighborId) || 0) - 1;
      inDegree.set(neighborId, newDegree);
      if (newDegree === 0) queue.push(neighborId);
    }
  }

  return sortedIds.length === nodes.length ? sortedIds : nodes.map(n => n.id);
}

/**
 * Convert WorkflowNode database record to UnifiedNodeDefinition
 */
function convertWorkflowNode(
  node: Record<string, unknown>,
  order: number
): UnifiedNodeDefinition {
  const data = typeof node.data === 'string' ? JSON.parse(node.data) : {};
  const label = data.label || data.name || `Node ${String(node.id).slice(0, 8)}`;

  return {
    id: String(node.id),
    workflowId: String(node.workflowId),
    label,
    type: String(node.type),
    roleId: node.roleId ? String(node.roleId) : null,
    positionX: typeof node.positionX === 'number' ? node.positionX : undefined,
    positionY: typeof node.positionY === 'number' ? node.positionY : undefined,
    data,
    fsmPhase: typeof node.fsmPhase === 'number' ? node.fsmPhase : null,
    fsmOrder: order,
    fsmFixed: typeof node.fsmFixed === 'boolean' ? node.fsmFixed : null,
    skills: typeof node.skills === 'string' ? JSON.parse(node.skills) : null,
    vulnerabilityCategories: typeof node.vulnerabilityCategories === 'string' ? JSON.parse(node.vulnerabilityCategories) : null,
    skillPath: node.skillPath ? String(node.skillPath) : null,
  };
}

/**
 * Generate unified node list from a workflow
 * 
 * Supports two modes:
 * - FSM: Parse FSMTemplate.nodes JSON string
 * - DAG: Topological sort WorkflowNode + WorkflowEdge
 * 
 * @param workflowId - The workflow ID
 * @returns Array of UnifiedNodeDefinition in execution order
 */
export async function generateNodeList(workflowId: string): Promise<UnifiedNodeDefinition[]> {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: {
      FSMTemplate: true,
      WorkflowNode: true,
      WorkflowEdge: true,
    },
  });

  if (!workflow) return [];

  // FSM mode: parse FSMTemplate.nodes JSON
  if (workflow.FSMTemplate?.nodes) {
    return parseFSMNodes(workflow.FSMTemplate.nodes);
  }

  // DAG mode: topological sort
  if (workflow.WorkflowNode.length > 0) {
    const sortedIds = topologicalSortDAG(
      workflow.WorkflowNode.map(n => ({ id: n.id })),
      workflow.WorkflowEdge.map(e => ({ sourceId: e.sourceId, targetId: e.targetId }))
    );

    const nodeMap = new Map(workflow.WorkflowNode.map(n => [n.id, n]));
    return sortedIds.map((id, order) => convertWorkflowNode(nodeMap.get(id)!, order));
  }

  return [];
}

// Re-export type for convenience
export type { UnifiedNodeDefinition } from './types';