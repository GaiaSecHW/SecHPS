// src/app/api/skills/evolution/config/route.ts
// GET - 获取进化配置
// PUT - 更新进化配置

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { getConfig, updateConfig, resetToDefaults, validateThresholds } from '@/services/skill-evolution/config-manager';

export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const config = await getConfig();
    return NextResponse.json({ config });
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '[EvolutionConfigAPI] Error fetching config', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: 'Failed to fetch evolution config' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const body = await request.json();

    // Validate thresholds before updating
    const validation = validateThresholds(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: `Validation failed: ${validation.errors.join(', ')}` },
        { status: 400 }
      );
    }

    const updatedConfig = await updateConfig(body);
    return NextResponse.json({ config: updatedConfig });
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '[EvolutionConfigAPI] Error updating config', { details: { error: error instanceof Error ? error.message : String(error) } });
    const message = error instanceof Error ? error.message : 'Failed to update evolution config';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// POST - 重置为默认配置
export async function POST(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const body = await request.json();

    if (body.action === 'reset') {
      const resetConfig = await resetToDefaults();
      return NextResponse.json({ config: resetConfig });
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '[EvolutionConfigAPI] Error resetting config', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: 'Failed to reset evolution config' },
      { status: 500 }
    );
  }
}