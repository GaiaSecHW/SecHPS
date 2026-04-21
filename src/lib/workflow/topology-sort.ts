/**
 * Topology Sort Utilities
 * 
 * Provides topological sorting for DAG workflows and FSM node ordering.
 */

import { prisma } from '@/lib/prisma';
import type { UnifiedNodeDefinition } from './types';

/**
 * Parse node data field (JSON string) to extract label
 */
function parseNodeData(dataString: string): Record<string, unknown> {
  try {
    return JSON.parse(dataString);
  } catch {
    return {};
  }
}

/**
 * Extract label from node data
 */
function extractLabel(data: Record<string, unknown>, fallbackId: string): string {
  if (typeof data.label === 'string') return data.label;
  if (typeof data.name === 'string') return data.name;
  return fallbackId;
}

/**
 * Parse JSON array field (vulnerabilityCategories or skills)
 */
function parseJsonArray(jsonString: string | null | undefined): string[] | null {
  if (!jsonString) return null;
  try {
    const parsed = JSON.parse(jsonString);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Convert WorkflowNode to UnifiedNodeDefinition
 */
function convertToUnifiedNode(node: {
  id: string;
  workflowId: string;
  roleId: string | null;
  type: string;
  positionX: number;
  positionY: number;
  data: string;
  vulnerabilityCategories: string | null;
  skills: string | null;
  fsmPhase: number | null;
  fsmFixed: boolean | null;
  fsmOrder: number | null;
  skillPath: string | null;
}): UnifiedNodeDefinition {
  const parsedData = parseNodeData(node.data);
  const label = extractLabel(parsedData, node.id);

  return {
    id: node.id,
    workflowId: node.workflowId,
    roleId: node.roleId,
    type: node.type,
    positionX: node.positionX,
    positionY: node.positionY,
    data: parsedData,
    label,
    fsmPhase: node.fsmPhase,
    fsmFixed: node.fsmFixed,
    fsmOrder: node.fsmOrder,
    skillPath: node.skillPath,
    vulnerabilityCategories: parseJsonArray(node.vulnerabilityCategories),
    skills: parseJsonArray(node.skills),
  };
}

/**
 * Topological Sort for DAG Workflow using Kahn's Algorithm
 * 
 * @param workflowId - The workflow ID to sort
 * @returns Array of UnifiedNodeDefinition in topological order
 * @throws Error if cycle detected or workflow not found
 */
export async function topologicalSortDAG(workflowId: string): Promise<UnifiedNodeDefinition[]> {
  // Query all nodes for this workflow
  const nodes = await prisma.workflowNode.findMany({
    where: { workflowId },
    orderBy: { createdAt: 'asc' },
  });

  if (nodes.length === 0) {
    return [];
  }

  // Query all edges for this workflow
  const edges = await prisma.workflowEdge.findMany({
    where: { workflowId },
  });

  // Build adjacency list and in-degree map
  const adjacencyList: Map<string, string[]> = new Map();
  const inDegree: Map<string, number> = new Map();

  // Initialize all nodes with 0 in-degree
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacencyList.set(node.id, []);
  }

  // Build graph from edges
  for (const edge of edges) {
    const sourceId = edge.sourceId;
    const targetId = edge.targetId;

    // Add edge to adjacency list
    const neighbors = adjacencyList.get(sourceId) || [];
    neighbors.push(targetId);
    adjacencyList.set(sourceId, neighbors);

    // Increment in-degree of target node
    const currentInDegree = inDegree.get(targetId) || 0;
    inDegree.set(targetId, currentInDegree + 1);
  }

  // Kahn's algorithm: find all nodes with 0 in-degree
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  // Process nodes in topological order
  const sortedNodeIds: string[] = [];

  while (queue.length > 0) {
    // Sort queue by createdAt to ensure deterministic order for nodes with same in-degree
    // (nodes without edges should maintain their creation order)
    const currentNodeId = queue.shift()!;
    sortedNodeIds.push(currentNodeId);

    // Get all neighbors and decrement their in-degree
    const neighbors = adjacencyList.get(currentNodeId) || [];
    for (const neighborId of neighbors) {
      const currentDegree = inDegree.get(neighborId) || 0;
      const newDegree = currentDegree - 1;
      inDegree.set(neighborId, newDegree);

      if (newDegree === 0) {
        queue.push(neighborId);
      }
    }
  }

  // Check for cycle (if not all nodes processed)
  if (sortedNodeIds.length !== nodes.length) {
    const unprocessedNodes = nodes
      .filter(n => !sortedNodeIds.includes(n.id))
      .map(n => n.id);
    throw new Error(
      `Cycle detected in workflow ${workflowId}. Unprocessed nodes: ${unprocessedNodes.join(', ')}`
    );
  }

  // Convert to UnifiedNodeDefinition in sorted order
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const sortedNodes: UnifiedNodeDefinition[] = sortedNodeIds.map(nodeId => {
    const node = nodeMap.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found in workflow ${workflowId}`);
    }
    return convertToUnifiedNode(node);
  });

  return sortedNodes;
}

/**
 * Sort FSM Nodes by fsmOrder or fsmPhase
 * 
 * FSM nodes have a defined execution order based on:
 * 1. fsmOrder field (explicit ordering)
 * 2. fsmPhase field (phase number 1-4)
 * 
 * @param fsmTemplateId - The FSM template ID (stored as workflowId in WorkflowNode)
 * @returns Array of UnifiedNodeDefinition in FSM execution order
 */
export async function sortFSMNodes(fsmTemplateId: string): Promise<UnifiedNodeDefinition[]> {
  // Query all FSM nodes for this template
  // FSM nodes are stored as WorkflowNode with type "fsm_phase"
  const nodes = await prisma.workflowNode.findMany({
    where: {
      workflowId: fsmTemplateId,
      type: 'fsm_phase',
    },
  });

  if (nodes.length === 0) {
    return [];
  }

  // Sort by fsmOrder first, then by fsmPhase
  const sortedNodes = nodes.sort((a, b) => {
    // Primary sort: fsmOrder (explicit ordering)
    const orderA = a.fsmOrder ?? Infinity;
    const orderB = b.fsmOrder ?? Infinity;
    
    if (orderA !== orderB) {
      return orderA - orderB;
    }

    // Secondary sort: fsmPhase (phase number)
    const phaseA = a.fsmPhase ?? Infinity;
    const phaseB = b.fsmPhase ?? Infinity;
    
    if (phaseA !== phaseB) {
      return phaseA - phaseB;
    }

    // Tertiary sort: createdAt (fallback for deterministic order)
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  // Convert to UnifiedNodeDefinition
  return sortedNodes.map(node => convertToUnifiedNode(node));
}

/**
 * Get all nodes for a workflow (unsorted)
 * 
 * Useful for debugging or when order doesn't matter.
 * 
 * @param workflowId - The workflow ID
 * @returns Array of UnifiedNodeDefinition
 */
export async function getAllWorkflowNodes(workflowId: string): Promise<UnifiedNodeDefinition[]> {
  const nodes = await prisma.workflowNode.findMany({
    where: { workflowId },
    orderBy: { createdAt: 'asc' },
  });

  return nodes.map(node => convertToUnifiedNode(node));
}

/**
 * Check if a workflow has a valid DAG structure (no cycles)
 * 
 * @param workflowId - The workflow ID to check
 * @returns true if valid DAG, false if cycle detected
 */
export async function isValidDAG(workflowId: string): Promise<boolean> {
  try {
    await topologicalSortDAG(workflowId);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cycle detected')) {
      return false;
    }
    throw error;
  }
}