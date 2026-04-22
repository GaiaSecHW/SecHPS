/**
 * NodeExecution 预初始化服务
 * 
 * 在工作流启动时预先创建所有节点的执行记录
 */

import { prisma } from '@/lib/prisma';
import { generateIndexedId } from '@/lib/id-generator';
import type { UnifiedNodeDefinition } from '@/lib/workflow/types';

/**
 * 初始化节点执行记录
 * 
 * @param evaluationSessionId - 评估会话 ID
 * @param nodes - 统一节点定义列表
 */
export async function initializeNodeExecutions(
  evaluationSessionId: string,
  nodes: UnifiedNodeDefinition[]
): Promise<void> {
  await prisma.$transaction(
    nodes.map((node, index) =>
      prisma.nodeExecution.create({
        data: {
          id: generateIndexedId('nodeexec', index),
          evaluationSessionId,
          workflowNodeId: node.id,
          nodeLabel: node.label,
          nodeType: node.type ?? 'task',
          status: 'pending',
          order: node.fsmOrder ?? index,
          updatedAt: new Date(),
        },
      })
    )
  );
}