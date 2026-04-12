import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

/**
 * POST /api/skills/predict-tasks
 * 创建异步预测任务
 */
export async function POST(request: Request) {
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

    const body = await request.json();
    const { taskName, taskDescription, workflowId, nodeId, topK = 5 } = body;

    // 验证必填字段
    if (!taskName || !taskDescription) {
      return NextResponse.json(
        { error: '缺少必填字段：taskName, taskDescription' },
        { status: 400 }
      );
    }

    // 创建任务
    const task = await prisma.skillPredictionTask.create({
      data: {
        userId: payload.userId,
        workflowId,
        nodeId,
        taskName,
        taskDescription,
        topK,
        status: 'pending',
      },
    });

    // 触发后台执行（不等待）
    executePredictionTask(task.id).catch(err => {
      console.error('[predict-tasks] 执行预测任务失败:', err);
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error('创建预测任务失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/skills/predict-tasks
 * 查询预测任务列表
 */
export async function GET(request: Request) {
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

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflowId');
    const nodeId = searchParams.get('nodeId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // 构建查询条件
    const where: any = { userId: payload.userId };
    if (workflowId) {
      where.workflowId = workflowId;
    }
    if (nodeId) {
      where.nodeId = nodeId;
    }
    if (status) {
      where.status = status;
    }

    // 查询任务
    const tasks = await prisma.skillPredictionTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    // 解析 matches 字段（存储为 JSON 字符串）
    const parsedTasks = tasks.map(task => ({
      ...task,
      matches: task.matches ? JSON.parse(task.matches) : null,
    }));

    return NextResponse.json({ tasks: parsedTasks });
  } catch (error) {
    console.error('查询预测任务失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

/**
 * 后台执行预测任务
 */
async function executePredictionTask(taskId: string) {
  try {
    console.log(`[predict-tasks] 开始执行任务: ${taskId}`);

    // 更新任务状态为运行中
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: {
        status: 'running',
        startedAt: new Date(),
        progress: 10,
      },
    });

    // 获取任务详情
    const task = await prisma.skillPredictionTask.findUnique({
      where: { id: taskId },
      include: {
        workflow: {
          select: { techStack: true },
        },
      },
    });

    if (!task) {
      throw new Error('任务不存在');
    }

    // 解析工作流技术栈
    let workflowTechStack: string[] = [];
    if (task.workflow?.techStack) {
      try {
        workflowTechStack = JSON.parse(task.workflow.techStack);
      } catch {
        // 忽略解析错误
      }
    }

    // 更新进度
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: { progress: 30 },
    });

    // 获取所有可用的 Skills
    const skills = await prisma.skill.findMany({
      where: {
        isActive: true,
        isLatest: true,
        OR: [
          { userId: null },
          { userId: task.userId },
        ],
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        category: true,
        techStack: true,
        cwe: true,
      },
    });

    if (skills.length === 0) {
      await prisma.skillPredictionTask.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          progress: 100,
          matches: '[]',
          matchCount: 0,
        },
      });
      return;
    }

    // 更新进度
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: { progress: 50 },
    });

    // 获取模型配置
    const modelConfig = await prisma.modelConfig.findFirst({
      where: {
        isActive: true,
        isDefault: true,
      },
    });

    // 构建技能列表摘要
    const skillSummaries = skills.map(skill => {
      let techStackArr: string[] = [];
      if (skill.techStack) {
        try {
          techStackArr = JSON.parse(skill.techStack);
        } catch {
          // 忽略解析错误
        }
      }
      return {
        id: skill.id,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        category: skill.category,
        techStack: techStackArr,
        cwe: skill.cwe,
      };
    });

    // 构建匹配 Prompt
    const prompt = buildMatchPrompt(
      task.taskName,
      task.taskDescription,
      workflowTechStack,
      skillSummaries,
      task.topK
    );

    // 更新进度
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: { progress: 70 },
    });

    // 执行匹配
    let matches: any[];
    let method: string;

    if (!modelConfig) {
      // 使用关键词匹配
      matches = simpleKeywordMatch(task.taskName, task.taskDescription, workflowTechStack, skillSummaries, task.topK);
      method = 'keyword';
    } else {
      // 调用 LLM 匹配
      try {
        matches = await callLLMForMatch(modelConfig, prompt, skillSummaries, task.topK);
        method = 'llm';
      } catch (error) {
        console.error('[predict-tasks] LLM 匹配失败，降级到关键词匹配:', error);
        matches = simpleKeywordMatch(task.taskName, task.taskDescription, workflowTechStack, skillSummaries, task.topK);
        method = 'keyword';
      }
    }

    // 更新进度
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: { progress: 90 },
    });

    // 保存结果
    const completedAt = new Date();
    const duration = task.startedAt ? completedAt.getTime() - task.startedAt.getTime() : null;

    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        completedAt,
        duration,
        progress: 100,
        matches: JSON.stringify(matches),
        method,
        matchCount: matches.length,
      },
    });

    // 同时保存到 SkillPrediction 表
    await prisma.skillPrediction.create({
      data: {
        userId: task.userId,
        workflowId: task.workflowId,
        taskName: task.taskName,
        taskDescription: task.taskDescription,
        matches: JSON.stringify(matches),
        method,
        workflowTechStack: workflowTechStack.length > 0 ? JSON.stringify(workflowTechStack) : null,
        matchCount: matches.length,
      },
    });

    console.log(`[predict-tasks] 任务完成: ${taskId}`);
  } catch (error) {
    console.error(`[predict-tasks] 任务失败: ${taskId}`, error);

    // 更新任务状态为失败
    await prisma.skillPredictionTask.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : '未知错误',
      },
    });
  }
}

/**
 * 构建匹配 Prompt
 */
function buildMatchPrompt(
  taskName: string,
  taskDescription: string,
  workflowTechStack: string[],
  skills: Array<{
    id: string;
    name: string;
    displayName: string;
    description: string;
    category: string;
    techStack: string[];
    cwe: string | null;
  }>,
  topK: number
): string {
  const techStackStr = workflowTechStack.length > 0
    ? workflowTechStack.join(', ')
    : '未指定';

  const skillsTable = skills.map(s =>
    `| ${s.id} | ${s.displayName} | ${s.description.substring(0, 100)}${s.description.length > 100 ? '...' : ''} | ${s.category} | ${s.techStack.join(', ') || '通用'} | ${s.cwe || '-'} |`
  ).join('\n');

  return `你是一个Skill匹配专家。分析以下任务，从可用的Skills中选择最匹配的。

## 任务信息
- 名称: ${taskName}
- 描述: ${taskDescription}

## 编排信息
- 适合的技术栈: ${techStackStr}

## 可用Skills列表
| ID | 名称 | 描述 | 类别 | 技术栈 | CWE |
|----|------|------|------|--------|-----|
${skillsTable}

## 匹配要求
1. 优先匹配技术栈一致的Skills
2. 技术栈为空的Skills视为通用Skill，也应当考虑
3. 根据任务描述判断核心需求（安全检测？代码审计？认证相关？）
4. 考虑Skill的类别和CWE编号的关联性
5. 返回最相关的Top-${topK} Skills

## 输出格式
严格返回JSON数组，不要包含任何其他文字:
[
  {
    "skillId": "Skill的ID",
    "relevance": 0.95,
    "reason": "简短的中文解释为什么匹配"
  }
]`;
}

/**
 * 调用 LLM 进行匹配
 */
async function callLLMForMatch(
  modelConfig: {
    apiBaseUrl: string;
    apiKey: string;
    models: string;
    providerType: string;
  },
  prompt: string,
  skills: Array<{ id: string; name: string; displayName: string; description: string; category: string; techStack: string[] }>,
  topK: number
): Promise<any[]> {
  // 解析 models JSON 字符串并取第一个模型
  let modelName = 'default';
  try {
    const parsedModels = JSON.parse(modelConfig.models);
    modelName = Array.isArray(parsedModels) ? parsedModels[0] : modelConfig.models;
  } catch {
    modelName = modelConfig.models.split(',')[0].trim();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${modelConfig.apiKey}`,
  };

  // 处理 API URL 和请求格式
  let apiUrl = modelConfig.apiBaseUrl;
  let body: Record<string, unknown>;

  if (modelConfig.providerType === 'claude') {
    // Claude API
    if (!apiUrl.includes('/v1/messages') && !apiUrl.endsWith('/messages')) {
      apiUrl = apiUrl.replace(/\/$/, '') + '/v1/messages';
    }
    // Claude 使用不同的 headers
    delete headers['Authorization'];
    headers['x-api-key'] = modelConfig.apiKey;
    headers['anthropic-version'] = '2023-06-01';

    // Claude 请求格式
    body = {
      model: modelName,
      max_tokens: 2000,
      system: prompt,
      messages: [{ role: 'user', content: '请从上面的 Skills 列表中选择最匹配的Skills并返回JSON格式结果' }],
    };
  } else {
    // OpenAI 兼容 API
    if (!apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl.replace(/\/$/, '') + '/v1/chat/completions';
    }

    body = {
      model: modelName,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    };
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  const llmResponse = await response.json();

  // 解析响应
  let content = '';
  if (modelConfig.providerType === 'claude') {
    // Claude 响应格式
    if (Array.isArray(llmResponse.content)) {
      const textBlock = llmResponse.content.find((block: any) => block.type === 'text');
      content = textBlock?.text || '';
    } else if (typeof llmResponse.content === 'string') {
      content = llmResponse.content;
    }
  } else {
    // OpenAI 响应格式
    content = llmResponse.choices?.[0]?.message?.content || '';
  }

  // 解析 LLM 返回的 JSON
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [];
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // 构建 SkillMatch 结果
  const matches: any[] = [];
  for (const item of parsed) {
    const skill = skills.find(s => s.id === item.skillId);
    if (skill) {
      matches.push({
        skillId: skill.id,
        skillName: skill.name,
        displayName: skill.displayName,
        category: skill.category,
        techStack: skill.techStack,
        relevance: Math.min(1, Math.max(0, item.relevance || 0.5)),
        reason: item.reason || '匹配成功',
      });
    }
  }

  return matches.slice(0, topK);
}

/**
 * 简单关键词匹配（作为降级方案）
 */
function simpleKeywordMatch(
  taskName: string,
  taskDescription: string,
  workflowTechStack: string[],
  skills: Array<{
    id: string;
    name: string;
    displayName: string;
    description: string;
    category: string;
    techStack: string[];
  }>,
  topK: number
): any[] {
  const searchText = `${taskName} ${taskDescription}`.toLowerCase();

  // 关键词权重映射
  const categoryKeywords: Record<string, string[]> = {
    'code-audit': ['sql', '注入', 'injection', 'xss', '漏洞', '漏洞检测', '代码审计', '审计', '安全检测'],
    'auth': ['认证', '授权', '登录', '密码', 'jwt', 'oauth', '鉴权', 'authentication', 'authorization'],
    'sensitive': ['敏感', '密钥', '泄露', '硬编码', 'password', 'secret', 'key'],
    'api': ['api', '接口', 'rest', 'graphql', 'endpoint'],
    'config': ['配置', 'config', '设置', 'setting'],
    'crypto': ['加密', '解密', 'crypto', 'cipher', 'ssl', 'tls'],
    'web': ['web', '网页', '网站', 'http', '请求'],
    'business': ['业务', '逻辑', '流程', 'workflow'],
    'client': ['客户端', 'client', '前端', 'frontend'],
    'cloud': ['云', 'cloud', 'aws', 'azure', 'kubernetes', 'docker'],
  };

  // 计算每个 Skill 的得分
  const scoredSkills = skills.map(skill => {
    let score = 0;
    const skillText = `${skill.name} ${skill.displayName} ${skill.description}`.toLowerCase();

    // 1. 类别匹配得分
    const keywords = categoryKeywords[skill.category] || [];
    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        score += 0.3;
        break;
      }
    }

    // 2. 技术栈匹配得分
    if (workflowTechStack.length > 0 && skill.techStack.length > 0) {
      const matchCount = skill.techStack.filter(ts =>
        workflowTechStack.some(wts =>
          ts.toLowerCase() === wts.toLowerCase() ||
          ts.toLowerCase().includes(wts.toLowerCase()) ||
          wts.toLowerCase().includes(ts.toLowerCase())
        )
      ).length;
      if (matchCount > 0) {
        score += 0.4 * (matchCount / skill.techStack.length);
      }
    }

    // 3. 名称/描述相似度
    const skillWords = skillText.split(/\s+/);
    const taskWords = searchText.split(/\s+/);
    const commonWords = skillWords.filter(w => taskWords.includes(w));
    score += Math.min(0.3, commonWords.length * 0.05);

    return {
      skill,
      score,
    };
  });

  // 排序并返回 Top-K
  const sorted = scoredSkills
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return sorted.map(s => ({
    skillId: s.skill.id,
    skillName: s.skill.name,
    displayName: s.skill.displayName,
    category: s.skill.category,
    techStack: s.skill.techStack,
    relevance: Math.min(1, s.score),
    reason: `关键词匹配得分: ${(s.score * 100).toFixed(0)}%`,
  }));
}
