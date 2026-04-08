import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    
    if (!payload) {
      return NextResponse.json({ error: '无效的 token' }, { status: 401 });
    }

    const body = await request.json();
    const { intent, research } = body;

    if (!intent || !research) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 基于 intent 和 research 生成 Skill 定义
    const skill = generateSkillFromInput(intent, research);

    return NextResponse.json({ skill });
  } catch (error) {
    console.error('生成 Skill 失败:', error);
    return NextResponse.json(
      { error: '生成失败' },
      { status: 500 }
    );
  }
}

function generateSkillFromInput(intent: any, research: any) {
  // 生成名称（转换为 kebab-case）
  const name = intent.name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  // 生成系统提示词
  const systemPrompt = generateSystemPrompt(intent, research);
  
  // 生成用户提示词
  const userPrompt = generateUserPrompt(intent, research);
  
  // 确定工具
  const tools = determineTools(research.dependencies);
  
  return {
    name,
    displayName: intent.name || name,
    description: intent.description || '',
    category: intent.category || 'code-audit',
    cwe: intent.cwe,
    severity: determineSeverity(intent.category),
    systemPrompt,
    userPrompt,
    tools,
    parameters: {},
  };
}

function generateSystemPrompt(intent: any, research: any) {
  const parts = [
    `你是一个专业的安全审计专家，专注于${intent.whatDoesItDo || '代码安全分析'}。`,
    '',
    '## 任务',
    intent.whatDoesItDo || '检测代码中的安全漏洞',
    '',
    '## 触发条件',
    intent.whenShouldItTrigger || '当用户请求安全审计时',
    '',
    '## 期望输出',
    intent.expectedOutput || '结构化的安全审计报告',
  ];

  if (research.edgeCases && research.edgeCases.length > 0) {
    parts.push('', '## 边缘情况');
    research.edgeCases.forEach((ec: string) => {
      parts.push(`- ${ec}`);
    });
  }

  if (research.successCriteria && research.successCriteria.length > 0) {
    parts.push('', '## 成功标准');
    research.successCriteria.forEach((sc: string) => {
      parts.push(`- ${sc}`);
    });
  }

  if (research.inputOutputFormats) {
    parts.push('', '## 输入输出格式');
    parts.push(research.inputOutputFormats);
  }

  parts.push('', '## 工作流程');
  parts.push('1. 仔细分析输入内容');
  parts.push('2. 识别潜在的安全问题');
  parts.push('3. 评估风险等级');
  parts.push('4. 提供详细的修复建议');
  parts.push('', '## 注意事项');
  parts.push('- 保持客观和专业');
  parts.push('- 提供具体和可操作的建议');
  parts.push('- 考虑实际情况和性能影响');

  return parts.join('\n');
}

function generateUserPrompt(intent: any, research: any) {
  const parts = [
    '请分析以下内容，识别其中的安全问题：',
    '',
    '{{input}}',
    '',
    '请按照以下格式输出：',
    '',
    '### 发现的问题',
    '- 问题描述',
    '',
    '### 风险等级',
    '- [严重/高危/中危/低危/信息]',
    '',
    '### 详细说明',
    '- 技术细节和影响范围',
    '',
    '### 修复建议',
    '- 具体的修复步骤',
  ];

  return parts.join('\n');
}

function determineTools(dependencies: string[]): string[] {
  // 默认工具集
  const defaultTools = ['read_file', 'search_pattern'];
  
  if (!dependencies || dependencies.length === 0) {
    return defaultTools;
  }

  // 映射依赖到工具
  const toolMapping: Record<string, string> = {
    'read_file': 'read_file',
    'write_file': 'write_file',
    'search_pattern': 'search_pattern',
    'grep': 'grep',
    'bash': 'bash',
    'python': 'python',
    'node': 'node',
    'database': 'read_file', // 需要文件访问
  };

  const tools = new Set(defaultTools);
  
  dependencies.forEach(dep => {
    const normalizedDep = dep.toLowerCase().trim();
    if (toolMapping[normalizedDep]) {
      tools.add(toolMapping[normalizedDep]);
    }
  });

  return Array.from(tools);
}

function determineSeverity(category: string): string {
  const severityMap: Record<string, string> = {
    'code-audit': 'high',
    'auth': 'critical',
    'sensitive': 'high',
    'api': 'medium',
    'config': 'medium',
    'crypto': 'high',
    'web': 'medium',
    'business': 'medium',
    'client': 'low',
    'cloud': 'high',
  };

  return severityMap[category] || 'medium';
}
