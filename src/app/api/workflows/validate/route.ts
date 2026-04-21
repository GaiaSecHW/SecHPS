import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { validateWorkflow } from '@/lib/workflow-validator';
import { logger, LOG_MODULES } from '@/lib/logger';

// 验证工作流数据
export async function POST(request: Request) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_READ });
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }
    const payload = auth.payload;

    // 解析请求体
    const body = await request.json();
    const { nodes, edges, strict } = body;

    // 验证数据格式
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return NextResponse.json(
        { details: { error: 'nodes 和 edges 必须是数组' } },
        { status: 400 }
      );
    }

    // 验证工作流结构（strict=true 表示启用时的严格验证）
    const validation = validateWorkflow(nodes, edges, strict === true);

    return NextResponse.json({
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, 'Validate workflow error', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
