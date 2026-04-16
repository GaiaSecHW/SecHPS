// src/lib/monitoring/alert-engine.ts

import { prisma } from '@/lib/prisma';
import type { AlertCondition, MetricType } from '@/types/monitoring';
import { metricsCollector } from '@/lib/metrics/collector';
import { sendAlertNotification } from './alert-notifier';

/**
 * 告警引擎
 * 评估指标并触发告警
 */
export class AlertEngine {
  private checkInterval: number;
  private checkTimer?: NodeJS.Timeout;

  constructor(checkIntervalSeconds: number = 60) {
    this.checkInterval = checkIntervalSeconds * 1000;
  }

  /**
   * 启动告警检查
   */
  start(): void {
    this.checkTimer = setInterval(() => {
      this.checkAllRules().catch(console.error);
    }, this.checkInterval);
  }

  /**
   * 停止告警检查
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
  }

  /**
   * 检查所有启用的规则
   */
  async checkAllRules(): Promise<void> {
    const rules = await prisma.alertRule.findMany({
      where: { enabled: true },
    });

    for (const rule of rules) {
      try {
        await this.checkRule(rule);
      } catch (error) {
        console.error(`Error checking rule ${rule.name}:`, error);
      }
    }
  }

  /**
   * 检查单个规则
   */
  async checkRule(rule: {
    id: string;
    name: string;
    metricType: string;
    condition: string;
    severity: string;
    cooldownPeriod: number;
    lastTriggeredAt: Date | null;
    notificationChannels: string;
    tags: string | null;
  }): Promise<void> {
    const condition = JSON.parse(rule.condition) as AlertCondition;
    const metricType = rule.metricType as MetricType;
    const tags = rule.tags ? JSON.parse(rule.tags) : undefined;

    // 检查冷却期
    if (rule.lastTriggeredAt) {
      const cooldownEnd = new Date(
        rule.lastTriggeredAt.getTime() + rule.cooldownPeriod * 1000
      );
      if (new Date() < cooldownEnd) {
        return; // 还在冷却期
      }
    }

    // 评估条件
    const evaluation = await this.evaluateCondition(metricType, condition, tags);

    if (evaluation.triggered) {
      await this.triggerAlert(rule, evaluation.value, evaluation.threshold);
    }
  }

  /**
   * 评估告警条件
   */
  private async evaluateCondition(
    metricType: MetricType,
    condition: AlertCondition,
    tags?: Record<string, string>
  ): Promise<{ triggered: boolean; value: number; threshold: number }> {
    // 获取最近5分钟的聚合数据
    const aggregationPeriod = 300; // 5分钟
    const metrics = metricsCollector.getMetrics(undefined, metricType);

    // 过滤时间范围内的数据
    const now = Date.now();
    const periodStart = now - aggregationPeriod * 1000;
    const recentMetrics = metrics.filter(
      (m) => m.timestamp.getTime() >= periodStart
    );

    // 过滤标签
    const filteredMetrics = tags
      ? recentMetrics.filter((m) =>
          Object.entries(tags).every(([k, v]) => m.tags[k] === v)
        )
      : recentMetrics;

    if (filteredMetrics.length === 0) {
      return { triggered: false, value: 0, threshold: 0 };
    }

    const values = filteredMetrics.map((m) => m.value);
    const avgValue = values.reduce((a, b) => a + b, 0) / values.length;

    switch (condition.type) {
      case 'threshold': {
        const threshold = condition.value;
        let triggered = false;

        switch (condition.operator) {
          case 'gt':
            triggered = avgValue > threshold;
            break;
          case 'lt':
            triggered = avgValue < threshold;
            break;
          case 'gte':
            triggered = avgValue >= threshold;
            break;
          case 'lte':
            triggered = avgValue <= threshold;
            break;
          case 'eq':
            triggered = avgValue === threshold;
            break;
        }

        return { triggered, value: avgValue, threshold };
      }

      case 'rate': {
        // 计算错误率等
        const threshold = condition.threshold;
        const errorCount = filteredMetrics.filter(
          (m) => m.tags.status?.startsWith('4') || m.tags.status?.startsWith('5')
        ).length;
        const rate = filteredMetrics.length > 0 ? errorCount / filteredMetrics.length : 0;
        return { triggered: rate > threshold, value: rate, threshold };
      }

      case 'absence': {
        // 检查是否有数据缺失
        const threshold = 0;
        const hasData = filteredMetrics.length > 0;
        return { triggered: !hasData, value: filteredMetrics.length, threshold };
      }

      default:
        return { triggered: false, value: 0, threshold: 0 };
    }
  }

  /**
   * 触发告警
   */
  private async triggerAlert(
    rule: {
      id: string;
      name: string;
      severity: string;
      notificationChannels: string;
    },
    value: number,
    threshold: number
  ): Promise<void> {
    // 创建告警实例
    const alert = await prisma.alertInstance.create({
      data: {
        id: `alert-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        status: 'active',
        message: `${rule.name}: 当前值 ${value.toFixed(2)}, 阈值 ${threshold}`,
        value,
        threshold,
        triggeredAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // 更新规则触发时间
    await prisma.alertRule.update({
      where: { id: rule.id },
      data: {
        lastTriggeredAt: new Date(),
        triggerCount: { increment: 1 },
      },
    });

    // 发送通知
    const channels = JSON.parse(rule.notificationChannels) as string[];
    await sendAlertNotification(alert as any, channels);
  }

  /**
   * 确认告警
   */
  async acknowledgeAlert(alertId: string, userId: string) {
    const alert = await prisma.alertInstance.update({
      where: { id: alertId },
      data: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
      },
    });

    return alert;
  }

  /**
   * 解决告警
   */
  async resolveAlert(alertId: string) {
    const alert = await prisma.alertInstance.update({
      where: { id: alertId },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
      },
    });

    return alert;
  }
}

// 全局告警引擎实例
export const alertEngine = new AlertEngine();
