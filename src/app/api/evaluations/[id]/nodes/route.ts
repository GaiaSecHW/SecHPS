// src/app/api/evaluations/[id]/nodes/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { generateId, generateIndexedId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/evaluations/[id]/nodes - 获取评估会话的节点执行状态
// 数据隔离：普通用户只能查看自己项目评估的节点，管理员可以查看所有
// 返回所有工作流节点（从 WorkflowNode 配置）合并执行状态（从 NodeExecution）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 获取评估会话并验证所有权
    let where: any = { id };
    
    const evaluation = await prisma.evaluationSession.findFirst({
      where,
      select: {
        id: true,
        projectId: true,
        workflowId: true,
        status: true,
        opencodeSessionId: true,
        roleModels: true,
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // Separate query for Project
    const project = evaluation.projectId ? await prisma.project.findUnique({
      where: { id: evaluation.projectId },
      select: { userId: true, configId: true, techStack: true },
    }) : null;

    // Separate query for NodeExecution
    const nodeExecutions = await prisma.nodeExecution.findMany({
      where: { evaluationSessionId: evaluation.id },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        workflowNodeId: true,
        nodeLabel: true,
        nodeType: true,
        status: true,
        skipped: true,
        skipReason: true,
        startedAt: true,
        completedAt: true,
        order: true,
        modelConfigId: true,
        modelName: true,
        inputTokens: true,
        outputTokens: true,
      },
    });

    // 归属校验（管理员绕过）
    if (!userIsAdmin && project?.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 获取系统配置中的 workflowConfig（用于 start/end 节点名称）
    let workflowConfig: {
      startNodeLabel?: string;
      startNodeDescription?: string;
      endNodeLabel?: string;
      endNodeDescription?: string;
    } | null = null;
    
    // 优先使用项目关联的配置，否则使用全局激活配置
    const projectConfigId = project?.configId;
    if (projectConfigId) {
      const projectConfig = await prisma.opencodeConfig.findUnique({
        where: { id: projectConfigId },
        select: { workflowConfig: true },
      });
      if (projectConfig?.workflowConfig) {
        try {
          workflowConfig = JSON.parse(projectConfig.workflowConfig);
        } catch (e) {
          logger.warn(LOG_MODULES.EVALUATION, '解析项目配置 workflowConfig 失败', { error: String(e) });
        }
      }
    }
    
    // 如果项目没有配置，尝试获取全局激活配置
    if (!workflowConfig) {
      const globalConfig = await prisma.opencodeConfig.findFirst({
        where: { isActive: true },
        select: { workflowConfig: true },
      });
      if (globalConfig?.workflowConfig) {
        try {
          workflowConfig = JSON.parse(globalConfig.workflowConfig);
        } catch (e) {
          logger.warn(LOG_MODULES.EVALUATION, '解析全局配置 workflowConfig 失败', { error: String(e) });
        }
      }
    }
    
    // 获取工作流节点配置（如果有 workflowId）
    let workflowNodes: any[] = [];
    let roleModels: any[] = [];
    
    if (evaluation.workflowId) {
      // 获取工作流
      const workflow = await prisma.workflow.findUnique({
        where: { id: evaluation.workflowId },
        include: {
          WorkflowNode: {
            include: {
              WorkflowRole: true, // 包含角色信息
            },
          },
          WorkflowEdge: true, // 包含边信息（用于拓扑排序）
          WorkflowRole: true,
          FSMTemplate: true, // 包含 FSM 模板
        },
      });
      
      if (workflow) {
        // 检查是否是 FSM 工作流（有 FSMTemplate）
        if (workflow.FSMTemplate && workflow.FSMTemplate.nodes) {
          // FSM 工作流：从 FSMTemplate.nodes JSON 解析节点
          // 并合并用户编排的节点（替换占位节点 fsm-node-penetration）
          try {
            const fsmNodes = JSON.parse(workflow.FSMTemplate.nodes);
            
            // 1. 过滤掉占位节点（skillPath=null && fsmPhase=6）
            const filteredNodes = fsmNodes.filter((node: any) => {
              const isPlaceholder = node.skillPath === null && node.fsmPhase === 6;
              return !isPlaceholder;
            });
            
            // 2. 添加用户编排的 task 节点（在 fsmPhase=6 位置插入）
            const userNodes = workflow.WorkflowNode.filter(n => n.type === 'task');
            
            // 按 positionX 排序用户节点
            const sortedUserNodes = [...userNodes].sort((a, b) => a.positionX - b.positionX);
            
            // 3. 构建 workflowNodes 列表
            workflowNodes = filteredNodes.map((node: any, index: number) => ({
              id: node.id,
              label: node.label || `Phase ${node.fsmPhase}`,
              type: 'fsm_phase',
              roleId: node.roleId || null,
              roleName: null,
              roleColor: null,
              fsmPhase: node.fsmPhase,
              fsmOrder: node.fsmOrder || node.fsmPhase || index,
              fsmFixed: node.fsmFixed,
              skills: node.skills || [],
              vulnerabilityCategories: [],
              description: node.description || null,
              skillPath: node.skillPath || null,
              data: node,
              // FSM 顺序执行：前一阶段是前置，后一阶段是后继
              prevNodeIds: index > 0 ? [filteredNodes[index - 1].id] : [],
              nextNodeIds: index < filteredNodes.length - 1 ? [filteredNodes[index + 1].id] : [],
            }));
            
            // 4. 在 fsmPhase=5 之后、fsmPhase=7 之前插入用户节点
            const p5Index = workflowNodes.findIndex(n => n.fsmPhase === 5);
            const insertIndex = p5Index >= 0 ? p5Index + 1 : workflowNodes.length;
            
            for (let i = 0; i < sortedUserNodes.length; i++) {
              const wn = sortedUserNodes[i];
              const nodeData = wn.data ? JSON.parse(wn.data) : {};
              const userNode = {
                id: wn.id,
                label: nodeData.label || '用户节点',
                type: wn.type,
                roleId: wn.roleId || null,
                roleName: null,
                roleColor: null,
                fsmPhase: 6,  // 渗透测试阶段
                fsmOrder: 6 + i * 0.1,  // 6.0, 6.1, 6.2...
                fsmFixed: false,
                skills: wn.skills ? JSON.parse(wn.skills) : [],
                vulnerabilityCategories: wn.vulnerabilityCategories ? JSON.parse(wn.vulnerabilityCategories) : [],
                description: nodeData.description || null,
                skillPath: null,
                data: nodeData,
                // 用户节点关系
                prevNodeIds: [],
                nextNodeIds: [],
              };
              workflowNodes.splice(insertIndex + i, 0, userNode);
            }
            
            // 5. 按 fsmOrder 排序
            workflowNodes.sort((a, b) => (a.fsmOrder || 0) - (b.fsmOrder || 0));
          } catch (e) {
            logger.error(LOG_MODULES.EVALUATION, '解析 FSMTemplate.nodes 失败', { error: String(e) });
          }
        } else if (workflow.WorkflowNode && workflow.WorkflowNode.length > 0) {
          // DAG 工作流：按拓扑排序获取节点
          
          // 构建邻接表和入度映射
          const adjacencyList: Map<string, string[]> = new Map();
          const inDegree: Map<string, number> = new Map();
          
          // 初始化所有节点入度为 0
          for (const node of workflow.WorkflowNode) {
            inDegree.set(node.id, 0);
            adjacencyList.set(node.id, []);
          }
          
          // 从边构建图
          for (const edge of workflow.WorkflowEdge) {
            const neighbors = adjacencyList.get(edge.sourceId) || [];
            neighbors.push(edge.targetId);
            adjacencyList.set(edge.sourceId, neighbors);
            
            const currentDegree = inDegree.get(edge.targetId) || 0;
            inDegree.set(edge.targetId, currentDegree + 1);
          }
          
          // 构建节点关系映射（前置节点和后继节点）
          const prevNodesMap: Map<string, string[]> = new Map();
          const nextNodesMap: Map<string, string[]> = new Map();
          
          for (const edge of workflow.WorkflowEdge) {
            // sourceId -> targetId: sourceId 的后继是 targetId
            const nextList = nextNodesMap.get(edge.sourceId) || [];
            nextList.push(edge.targetId);
            nextNodesMap.set(edge.sourceId, nextList);
            
            // targetId 的前置是 sourceId
            const prevList = prevNodesMap.get(edge.targetId) || [];
            prevList.push(edge.sourceId);
            prevNodesMap.set(edge.targetId, prevList);
          }
          
          // Kahn 算法拓扑排序
          const queue: string[] = [];
          for (const [nodeId, degree] of inDegree.entries()) {
            if (degree === 0) {
              queue.push(nodeId);
            }
          }
          
          const sortedNodeIds: string[] = [];
          while (queue.length > 0) {
            const currentNodeId = queue.shift()!;
            sortedNodeIds.push(currentNodeId);
            
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
          
          // 如果拓扑排序完成，使用排序后的顺序；否则使用原始顺序
          const nodeOrder = sortedNodeIds.length === workflow.WorkflowNode.length 
            ? sortedNodeIds 
            : workflow.WorkflowNode.map(n => n.id);
          
          // 创建节点映射
          const nodeMap = new Map(workflow.WorkflowNode.map(n => [n.id, n]));
          
          // 按拓扑顺序构建节点列表
          workflowNodes = nodeOrder.map((nodeId, index) => {
            const node = nodeMap.get(nodeId);
            if (!node) return null;
            
            const nodeData = node.data ? JSON.parse(node.data) : {};
            
            // 根据节点类型获取 label
            let label: string;
            if (node.type === 'start') {
              // 开始节点：优先使用系统配置，其次 nodeData，最后默认值
              label = workflowConfig?.startNodeLabel || nodeData.label || nodeData.name || '开始';
            } else if (node.type === 'end') {
              // 结束节点：优先使用系统配置，其次 nodeData，最后默认值
              label = workflowConfig?.endNodeLabel || nodeData.label || nodeData.name || '结束';
            } else {
              // 其他节点：使用 nodeData 中的 label
              label = nodeData.label || nodeData.name || `节点 ${node.id.substring(0, 8)}`;
            }
            
            // 获取前置节点和后继节点列表
            const prevNodeIds = prevNodesMap.get(node.id) || [];
            const nextNodeIds = nextNodesMap.get(node.id) || [];
            
            return {
              id: node.id,
              label,
              type: node.type,
              roleId: node.roleId,
              roleName: node.WorkflowRole?.name || null,
              roleColor: node.WorkflowRole?.color || null,
              fsmPhase: node.fsmPhase,
              fsmOrder: index, // 使用拓扑排序后的顺序
              skills: node.skills ? JSON.parse(node.skills) : [],
              vulnerabilityCategories: node.vulnerabilityCategories ? JSON.parse(node.vulnerabilityCategories) : [],
              data: nodeData,
              // 节点关系
              prevNodeIds,
              nextNodeIds,
            };
          }).filter((n): n is NonNullable<typeof n> => n !== null);
          
          logger.debug(LOG_MODULES.EVALUATION, 'DAG 节点拓扑排序完成', { 
            nodeCount: workflowNodes.length,
            order: workflowNodes.map((n: any) => n.label)
          });
        }
        
        // 获取工作流角色列表
        roleModels = workflow.WorkflowRole.map(role => ({
          id: role.id,
          name: role.name,
          description: role.description,
          color: role.color,
          order: role.order,
        }));
      }
    }
    
    // 解析 roleModels 配置（从 evaluation.roleModels JSON）
    let roleModelConfig: Record<string, string> = {}; // roleId -> modelId/modelName
    if (evaluation.roleModels) {
      try {
        const parsed = JSON.parse(evaluation.roleModels);
        if (Array.isArray(parsed)) {
          parsed.forEach((rm: any) => {
            if (rm.roleId && rm.modelId) {
              roleModelConfig[rm.roleId] = rm.modelId;
            } else if (rm.roleId && rm.modelName) {
              roleModelConfig[rm.roleId] = rm.modelName;
            }
          });
        }
      } catch (e) {
        logger.warn(LOG_MODULES.EVALUATION, '解析 roleModels 失败:', { details: { error: String(e) } });
      }
    }

    // skillsDetails 直接从 SkillExecution 构建，不需要额外查询
    
    // 查询 SkillExecution 获取每个节点的 skill 执行状态（包含 Skill 信息）
    const skillExecutionsByNode: Record<string, Record<string, { id: string; skillId: string; status: string; order: number; startedAt: string | null; completedAt: string | null; duration: number | null; Skill: { id: string; name: string; displayName: string } | null }>> = {};
    const allSkillIds: string[] = [];
    
    if (evaluation.id) {
      const skillExecutions = await prisma.skillExecution.findMany({
        where: {
          evaluationId: evaluation.id,
          nodeId: { not: null },
        },
        select: {
          id: true,
          skillId: true,
          nodeId: true,
          status: true,
          order: true,
          startedAt: true,
          completedAt: true,
          duration: true,
          Skill: {
            select: {
              id: true,
              name: true,
              displayName: true,
            },
          },
        },
        orderBy: { order: 'asc' },
      });
      
      skillExecutions.forEach(exec => {
        if (exec.nodeId) {
          if (!skillExecutionsByNode[exec.nodeId]) {
            skillExecutionsByNode[exec.nodeId] = {};
          }
          skillExecutionsByNode[exec.nodeId][exec.skillId] = {
            id: exec.id,
            skillId: exec.skillId,
            status: exec.status,
            order: exec.order,
            startedAt: exec.startedAt?.toISOString() || null,
            completedAt: exec.completedAt?.toISOString() || null,
            duration: exec.duration,
            Skill: exec.Skill,
          };
          
          if (!allSkillIds.includes(exec.skillId)) {
            allSkillIds.push(exec.skillId);
          }
        }
      });
    }
    
    // 批量查询 Skill 表获取 displayName（用于兜底）
    const skillDetailsMap: Record<string, { id: string; name: string; displayName: string }> = {};
    if (allSkillIds.length > 0) {
      const skills = await prisma.skill.findMany({
        where: { id: { in: allSkillIds } },
        select: { id: true, name: true, displayName: true },
      });
      skills.forEach(skill => {
        skillDetailsMap[skill.id] = {
          id: skill.id,
          name: skill.name,
          displayName: skill.displayName,
};
      });
    }

    // 合并节点配置和执行状态
    // 如果有 workflowNodes，则基于 workflowNodes 显示所有节点
    // 否则，只显示 NodeExecution 记录
    let mergedNodes: any[];
    
    if (workflowNodes.length > 0) {
      // 创建执行记录映射
      const executionMap = new Map<string, any>();
      nodeExecutions.forEach(exec => {
        executionMap.set(exec.workflowNodeId, exec);
      });
      
      // 合并所有工作流节点
      mergedNodes = workflowNodes.map((wn, index) => {
        const exec = executionMap.get(wn.id);
        const modelFromRole = roleModelConfig[wn.roleId] || null;
        
        // 直接从 SkillExecution 构建 skillsDetails（按 order 排序）
        const nodeSkillExecutions = (skillExecutionsByNode[wn.id] 
          ? Object.values(skillExecutionsByNode[wn.id])
              .sort((a, b) => a.order - b.order)
          : []);
        
        // 构建 skillsDetails（直接使用 SkillExecution 中的 Skill 信息）
        const skillsDetails = nodeSkillExecutions
          .map(execStatus => {
            // 使用 SkillExecution 中的 Skill 信息，或兜底使用 skillDetailsMap
            const skillInfo = execStatus.Skill || skillDetailsMap[execStatus.skillId];
            if (!skillInfo) return undefined;
            return {
              id: skillInfo.id,
              name: skillInfo.name,
              displayName: skillInfo.displayName,
              executionId: execStatus.id,
              executionOrder: execStatus.order,
              executionStatus: execStatus.status,
              executionStartedAt: execStatus.startedAt,
              executionCompletedAt: execStatus.completedAt,
              executionDuration: execStatus.duration,
            };
          })
          .filter((s: any) => s !== undefined);

        // 解析 vulnerabilityCategories 为数组（前端需要）
        let parsedVulnerabilityCategories: string[] = [];
        if (wn.vulnerabilityCategories) {
          if (Array.isArray(wn.vulnerabilityCategories)) {
            // 已经是数组，直接使用
            parsedVulnerabilityCategories = wn.vulnerabilityCategories;
          } else if (typeof wn.vulnerabilityCategories === 'string') {
            // 是字符串，需要解析
            try {
              parsedVulnerabilityCategories = JSON.parse(wn.vulnerabilityCategories);
            } catch {}
          }
        }
        
        return {
          id: wn.id,
          workflowNodeId: wn.id,
          label: wn.label,
          type: wn.type,
          roleId: wn.roleId,
          roleName: wn.roleName,
          roleColor: wn.roleColor,
          fsmPhase: wn.fsmPhase,
          fsmOrder: wn.fsmOrder ?? index,
          skills: skillsDetails.map((s: any) => s.id),  // 从 skillsDetails 提取 skillId 列表
          skillsDetails,
          skillLoadingMode: wn.data?.skillLoadingMode || null,
          vulnerabilityCategories: parsedVulnerabilityCategories,  // 返回解析后的数组
          // 执行状态
          status: exec?.status || 'pending',
          skipped: exec?.skipped || false,
          skipReason: exec?.skipReason || null,
          startedAt: exec?.startedAt || null,
          completedAt: exec?.completedAt || null,
          order: exec?.order ?? wn.fsmOrder ?? index,
          // 模型信息
          modelName: exec?.modelName || modelFromRole || null,
          modelConfigId: exec?.modelConfigId || null,
          // Token 信息
          inputTokens: exec?.inputTokens || null,
          outputTokens: exec?.outputTokens || null,
          // 节点关系
          prevNodeIds: wn.prevNodeIds || [],
          nextNodeIds: wn.nextNodeIds || [],
        };
      });
    } else {
      // 没有工作流配置，只显示执行记录
      mergedNodes = nodeExecutions.map(exec => ({
        id: exec.workflowNodeId || exec.id,
        workflowNodeId: exec.workflowNodeId,
        label: exec.nodeLabel,
        type: exec.nodeType,
        status: exec.status,
        skipped: exec.skipped || false,
        skipReason: exec.skipReason || null,
        startedAt: exec.startedAt,
        completedAt: exec.completedAt,
        order: exec.order,
        modelName: exec.modelName,
        modelConfigId: exec.modelConfigId,
        inputTokens: exec.inputTokens,
        outputTokens: exec.outputTokens,
        // 无工作流配置时，关系为空
        prevNodeIds: [],
        nextNodeIds: [],
      }));
    }

    // 计算进度统计
    const totalNodes = mergedNodes.length;
    const completedNodes = mergedNodes.filter(n => n.status === 'completed' && !n.skipped).length;
    const skippedNodes = mergedNodes.filter(n => n.skipped).length;
    const runningNodes = mergedNodes.filter(n => n.status === 'running').length;
    const pendingNodes = mergedNodes.filter(n => n.status === 'pending').length;
    const failedNodes = mergedNodes.filter(n => n.status === 'failed').length;
    
    // 找到当前运行的节点
    const currentRunningNode = mergedNodes.find(n => n.status === 'running');

    return NextResponse.json({
      nodes: mergedNodes,
      executions: nodeExecutions,
      workflowNodes,
      roleModels,
      roleModelConfig,
      // 进度统计
      progress: {
        total: totalNodes,
        completed: completedNodes,
        skipped: skippedNodes,
        running: runningNodes,
        pending: pendingNodes,
        failed: failedNodes,
        currentRunningNode: currentRunningNode ? {
          id: currentRunningNode.id,
          label: currentRunningNode.label,
          modelName: currentRunningNode.modelName,
        } : null,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '获取评估节点错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/evaluations/[id]/nodes - 更新节点执行状态
// 数据隔离：普通用户只能更新自己项目评估的节点，管理员可以更新所有
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const { nodeId, nodeLabel, nodeType, status, order } = body;

    if (!nodeId || !status) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 验证评估会话存在并验证所有权
    let where: any = { id };

    const evaluation = await prisma.evaluationSession.findFirst({
      where,
      select: { id: true, projectId: true },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // Separate query for Project
    const postProject = evaluation.projectId ? await prisma.project.findUnique({
      where: { id: evaluation.projectId },
      select: { userId: true },
    }) : null;

    // 归属校验（管理员绕过）
    if (!userIsAdmin && postProject?.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 查找现有节点执行记录
    const existingExecution = await prisma.nodeExecution.findFirst({
      where: {
        evaluationSessionId: id,
        workflowNodeId: nodeId,
      },
    });

    // 更新或创建节点执行记录
    const execution = existingExecution
      ? await prisma.nodeExecution.update({
          where: { id: existingExecution.id },
          data: {
            status,
            startedAt: status === 'running' ? new Date() : undefined,
            completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined,
            nodeLabel: nodeLabel || undefined,
            nodeType: nodeType || undefined,
            order: order ?? undefined,
            updatedAt: new Date(),
          },
        })
      : await prisma.nodeExecution.create({
          data: {
            id: generateId('nodeexec'),
            evaluationSessionId: id,
            workflowNodeId: nodeId,
            nodeLabel: nodeLabel || '',
            nodeType: nodeType || 'task',
            status,
            order: order ?? 0,
            startedAt: status === 'running' ? new Date() : null,
            completedAt: status === 'completed' || status === 'failed' ? new Date() : null,
            updatedAt: new Date(),
          },
        });

    return NextResponse.json({ success: true, execution });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '更新节点执行错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/evaluations/[id]/nodes - 批量初始化节点执行记录
// 数据隔离：普通用户只能初始化自己项目评估的节点，管理员可以初始化所有
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const { nodes } = body as { nodes: Array<{ nodeId: string; nodeLabel: string; nodeType: string; order: number }> };

    if (!nodes || !Array.isArray(nodes)) {
      return NextResponse.json({ error: '缺少节点数据' }, { status: 400 });
    }

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 验证评估会话存在并验证所有权
    let where: any = { id };

    const evaluation = await prisma.evaluationSession.findFirst({
      where,
      select: { id: true, projectId: true },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // Separate query for Project
    const putProject = evaluation.projectId ? await prisma.project.findUnique({
      where: { id: evaluation.projectId },
      select: { userId: true },
    }) : null;

    // 归属校验（管理员绕过）
    if (!userIsAdmin && putProject?.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 批量创建节点执行记录
    const executions = await prisma.$transaction(
      nodes.map((node, index) =>
        prisma.nodeExecution.create({
          data: {
            id: generateIndexedId('nodeexec', index),
            evaluationSessionId: id,
            workflowNodeId: node.nodeId,
            nodeLabel: node.nodeLabel,
            nodeType: node.nodeType,
            status: 'pending',
            order: node.order ?? index,
            updatedAt: new Date(),
          },
        })
      )
    );

    return NextResponse.json({ success: true, count: executions.length });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '初始化节点执行错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}