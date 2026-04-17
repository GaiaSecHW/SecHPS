import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { NODE_TYPE_MAP } from '@/types/workflow';

// 获取工作流预览（Markdown 格式）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    // 获取工作流配置（用于开始/结束节点的标签）
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'workflow' },
    });

    let workflowConfig = {
      startNodeLabel: '开始',
      startNodeDescription: 'Agent编排的起始点',
      endNodeLabel: '结束',
      endNodeDescription: 'Agent编排的结束点',
    };

    if (config?.value) {
      try {
        const parsed = JSON.parse(config.value);
        workflowConfig = { ...workflowConfig, ...parsed };
      } catch (e) {
        // 使用默认配置
      }
    }

    // 查询工作流及其节点和边
    const workflow = await prisma.workflow.findFirst({
      where: {
        id,
        OR: [
          { userId: payload.userId },
          { WorkflowShare: { some: { sharedWith: payload.userId } } },
        ],
      },
      include: {
        WorkflowNode: true,
        WorkflowEdge: true,
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在或无权访问' }, { status: 404 });
    }

    // 转换节点数据
    const nodes = workflow.WorkflowNode.map((node) => ({
      id: node.id,
      type: node.type,
      position: {
        x: node.positionX,
        y: node.positionY,
      },
      data: node.data ? JSON.parse(node.data) : {},
    }));

    // 转换边数据
    const edges = workflow.WorkflowEdge.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      data: edge.data ? JSON.parse(edge.data) : undefined,
    }));

    // 生成 Markdown 预览
    const markdown = generatePreviewMarkdown(nodes, edges, workflowConfig, workflow.name);

    return NextResponse.json({
      workflowId: id,
      workflowName: workflow.name,
      markdown,
    });
  } catch (error) {
    console.error('Get workflow preview error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * 生成工作流的 Markdown 预览
 */
function generatePreviewMarkdown(
  nodes: any[],
  edges: any[],
  workflowConfig: {
    startNodeLabel: string;
    startNodeDescription: string;
    endNodeLabel: string;
    endNodeDescription: string;
  },
  workflowName: string
): string {
  let markdown = `# ${workflowName}\n\n`;

  // 找到开始节点
  const startNode = nodes.find(n => n.type === 'start');
  // 找到结束节点
  const endNode = nodes.find(n => n.type === 'end');
  // 找到所有任务节点（从开始节点直接连接的）
  const taskNodes: { node: typeof nodes[0]; subtasks: typeof nodes }[] = [];

  // 构建边的关系映射
  const outEdges = new Map<string, typeof edges>();
  edges.forEach(e => {
    if (!outEdges.has(e.source)) {
      outEdges.set(e.source, []);
    }
    outEdges.get(e.source)!.push(e);
  });

  // 记录已处理的节点
  const processedNodes = new Set<string>();

  // 从开始节点开始，按顺序获取任务节点
  if (startNode) {
    processedNodes.add(startNode.id);
    const startEdges = outEdges.get(startNode.id) || [];

    // 遍历从开始节点出发的边，找到任务节点
    const processTask = (taskId: string) => {
      const taskNode = nodes.find(n => n.id === taskId && n.type === 'task');
      if (!taskNode || processedNodes.has(taskId)) return;
      processedNodes.add(taskId);

      const subtasks: typeof nodes = [];

      // 找到从任务节点底部(subtask handle)连接出去的子任务
      const taskOutEdges = outEdges.get(taskId) || [];
      taskOutEdges.forEach(edge => {
        // 检查是否是子任务连接（sourceHandle 为 'subtask' 或底部连接）
        const isSubtaskEdge = edge.sourceHandle === 'subtask' ||
          (edge.sourceHandle === null && nodes.find(n => n.id === edge.target)?.type === 'subtask');

        if (isSubtaskEdge) {
          // 收集所有子任务（包括链式连接的子任务）
          const collectSubtasks = (subtaskId: string) => {
            const subtaskNode = nodes.find(n => n.id === subtaskId && n.type === 'subtask');
            if (subtaskNode && !processedNodes.has(subtaskId)) {
              processedNodes.add(subtaskId);
              subtasks.push(subtaskNode);

              // 检查这个子任务是否连接到其他子任务
              const subtaskOutEdges = outEdges.get(subtaskId) || [];
              subtaskOutEdges.forEach(subEdge => {
                collectSubtasks(subEdge.target);
              });
            }
          };
          collectSubtasks(edge.target);
        }
      });

      taskNodes.push({ node: taskNode, subtasks });
    };

    // 按边的顺序处理任务节点
    startEdges.forEach(edge => {
      if (edge.target) {
        const targetNode = nodes.find(n => n.id === edge.target);
        if (targetNode?.type === 'task') {
          processTask(edge.target);
        }
      }
    });

    // 处理链式任务连接（任务到任务）
    let currentTask: typeof nodes[0] | undefined = taskNodes.length > 0 ? taskNodes[taskNodes.length - 1].node : undefined;
    while (currentTask) {
      const taskOutEdges = outEdges.get(currentTask.id) || [];
      const nextTaskEdge = taskOutEdges.find(e => (e.sourceHandle === 'out' || !e.sourceHandle) && nodes.find(n => n.id === e.target)?.type === 'task');
      if (nextTaskEdge) {
        processTask(nextTaskEdge.target);
        currentTask = taskNodes.find(t => t.node.id === nextTaskEdge.target)?.node;
      } else {
        break;
      }
    }
  }

  // 输出开始节点
  if (startNode) {
    const startLabel = workflowConfig.startNodeLabel || '开始';
    const startDesc = workflowConfig.startNodeDescription || 'Agent编排的起始点';
    const startType = NODE_TYPE_MAP[startNode.type as keyof typeof NODE_TYPE_MAP];
    markdown += `## 1. ${startLabel}\n`;
    markdown += `**类型**: ${startType?.label || startNode.type}  \n`;
    markdown += `**描述**: ${startDesc}\n\n`;
  }

  // 输出任务节点和子任务
  taskNodes.forEach((task, taskIdx) => {
    const taskData = task.node.data || {};
    const taskNumber = taskIdx + 2; // 从2开始（1是开始节点）
    const taskType = NODE_TYPE_MAP[task.node.type as keyof typeof NODE_TYPE_MAP];

    markdown += `## ${taskNumber}. ${taskData.label || taskType?.label || '任务'}\n`;
    markdown += `**类型**: ${taskType?.label || task.node.type}  \n`;
    if (taskData.description) {
      markdown += `**描述**: ${taskData.description}`;
    }
    markdown += '\n\n';

    // 输出子任务
    task.subtasks.forEach((subtask, subtaskIdx) => {
      const subtaskData = subtask.data || {};
      const subtaskType = NODE_TYPE_MAP[subtask.type as keyof typeof NODE_TYPE_MAP];
      const subtaskNumber = `${taskNumber}.${subtaskIdx + 1}`;

      markdown += `### ${subtaskNumber}. ${subtaskData.label || subtaskType?.label || '子任务'}\n`;
      markdown += `**类型**: ${subtaskType?.label || subtask.type}  \n`;
      if (subtaskData.description) {
        markdown += `**描述**: ${subtaskData.description}`;
      }
      markdown += '\n\n';
    });
  });

  // 输出结束节点
  if (endNode) {
    const endLabel = workflowConfig.endNodeLabel || '结束';
    const endDesc = workflowConfig.endNodeDescription || 'Agent编排的结束点';
    const endNumber = taskNodes.length + 2; // 开始节点 + 任务节点数 + 1
    const endType = NODE_TYPE_MAP[endNode.type as keyof typeof NODE_TYPE_MAP];
    markdown += `## ${endNumber}. ${endLabel}\n`;
    markdown += `**类型**: ${endType?.label || endNode.type}  \n`;
    markdown += `**描述**: ${endDesc}\n\n`;
  }

  return markdown;
}
