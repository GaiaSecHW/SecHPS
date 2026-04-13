/**
 * idle-trigger.ts
 * 闲时自动触发逻辑：在配置的时间窗口内，若无评估任务运行，则触发增量提取
 */

import { prisma } from '@/lib/prisma';

export interface IdleTriggerConfig {
  enabled: boolean;
  windowStart: string; // "HH:MM"
  windowEnd: string;   // "HH:MM"
  pollIntervalMinutes: number;
  maxSequencesPerRun: number;
}

const DEFAULT_CONFIG: IdleTriggerConfig = {
  enabled: false,
  windowStart: '00:00',
  windowEnd: '06:00',
  pollIntervalMinutes: 30,
  maxSequencesPerRun: 20,
};

const CONFIG_KEY = 'autonomous_evolution_idle_trigger';

export async function getIdleTriggerConfig(): Promise<IdleTriggerConfig> {
  try {
    const record = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    if (record) return { ...DEFAULT_CONFIG, ...JSON.parse(record.value) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

export async function saveIdleTriggerConfig(config: Partial<IdleTriggerConfig>): Promise<void> {
  const current = await getIdleTriggerConfig();
  const merged = { ...current, ...config };
  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify(merged), description: '执行自主进化 - 闲时触发配置' },
    update: { value: JSON.stringify(merged) },
  });
}

function parseTime(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

function isInWindow(config: IdleTriggerConfig): boolean {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const start = parseTime(config.windowStart);
  const end = parseTime(config.windowEnd);
  const startMinutes = start.h * 60 + start.m;
  const endMinutes = end.h * 60 + end.m;

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Overnight window (e.g. 22:00 - 06:00)
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/**
 * 检查当前是否有正在运行的评估任务
 */
export async function hasRunningEvaluations(): Promise<boolean> {
  const count = await prisma.evaluationSession.count({
    where: { status: { in: ['running', 'pending'] } },
  });
  return count > 0;
}

/**
 * 判断是否应该触发闲时提取
 */
export async function shouldTriggerIdle(): Promise<boolean> {
  const config = await getIdleTriggerConfig();
  if (!config.enabled) return false;
  if (!isInWindow(config)) return false;
  if (await hasRunningEvaluations()) return false;
  return true;
}

/**
 * 记录最后一次自动提取时间
 */
export async function recordLastAutoExtract(): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: 'autonomous_evolution_last_auto_extract' },
    create: {
      key: 'autonomous_evolution_last_auto_extract',
      value: new Date().toISOString(),
      description: '执行自主进化 - 最后自动提取时间',
    },
    update: { value: new Date().toISOString() },
  });
}

export async function getLastAutoExtract(): Promise<string | null> {
  try {
    const record = await prisma.systemConfig.findUnique({
      where: { key: 'autonomous_evolution_last_auto_extract' },
    });
    return record?.value || null;
  } catch {
    return null;
  }
}
