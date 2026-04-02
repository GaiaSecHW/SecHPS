import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { validateWorkflow } from '@/lib/workflow-validator';

// 验证工作流数据
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

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 解析请求体
    const body = await request.json();
    const { nodes, edges } = body;

    // 验证数据格式
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return NextResponse.json(
        { error: 'nodes 和 edges 必须是数组' },
        { status: 400 }
      );
    }

    // 验证工作流结构
    const validation = validateWorkflow(nodes, edges);

    return NextResponse.json({
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    });
  } catch (error) {
    console.error('Validate workflow error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
