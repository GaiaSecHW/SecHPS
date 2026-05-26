// src/lib/monitoring/alert-notifier.ts

import { prisma } from '@/lib/prisma';
import type { AlertInstance, NotificationChannelType } from '@/types/monitoring';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 发送告警通知
 */
export async function sendAlertNotification(
  alert: AlertInstance,
  channels: string[]
): Promise<void> {
  // 获取启用的通知渠道配置
  const channelConfigs = await prisma.notificationChannel.findMany({
    where: {
      name: { in: channels },
      enabled: true,
    },
  });

  const notifiedChannels: string[] = [];

  for (const config of channelConfigs) {
    try {
      const success = await sendToChannel(config.type as NotificationChannelType, config.config, alert);
      if (success) {
        notifiedChannels.push(config.name);
      }
    } catch (error) {
      logger.error(LOG_MODULES.MONITOR, `Failed to send alert to ${config.name}`, { details: { error: error instanceof Error ? error.message : String(error) } });
    }
  }

  // 更新已通知渠道
  if (notifiedChannels.length > 0) {
    await prisma.alertInstance.update({
      where: { id: alert.id },
      data: {
        notifiedChannels: JSON.stringify(notifiedChannels),
      },
    });
  }
}

/**
 * 发送到指定渠道
 */
async function sendToChannel(
  type: NotificationChannelType,
  configStr: string,
  alert: AlertInstance
): Promise<boolean> {
  const config = JSON.parse(configStr);

  switch (type) {
    case 'webhook':
      return sendWebhook(config, alert);
    case 'email':
      return sendEmail(config, alert);
    case 'slack':
      return sendSlack(config, alert);
    case 'dingtalk':
      return sendDingTalk(config, alert);
    case 'wechat':
      return sendWeChat(config, alert);
    default:
      logger.warn(LOG_MODULES.MONITOR, `Unknown notification channel type: ${type}`);
      return false;
  }
}

/**
 * Webhook 通知
 */
async function sendWebhook(
  config: { url: string; headers?: Record<string, string> },
  alert: AlertInstance
): Promise<boolean> {
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        alertId: alert.id,
        ruleName: alert.ruleName,
        severity: alert.severity,
        status: alert.status,
        message: alert.message,
        value: alert.value,
        threshold: alert.threshold,
        triggeredAt: alert.triggeredAt,
      }),
    });

    return response.ok;
  } catch (error) {
    logger.error(LOG_MODULES.MONITOR, 'Webhook notification failed:', { details: { error: error instanceof Error ? error.message : String(error) } });
    return false;
  }
}

/**
 * 邮件通知
 */
async function sendEmail(
  config: { recipients: string[]; smtpConfig?: Record<string, unknown> },
  alert: AlertInstance
): Promise<boolean> {
  // 邮件发送需要配置 SMTP，这里仅记录日志
  logger.info(LOG_MODULES.MONITOR, `[EMAIL ALERT] To: ${config.recipients.join(', ')}`);
  logger.info(LOG_MODULES.MONITOR, `[EMAIL ALERT] Subject: [${alert.severity.toUpperCase()}] ${alert.ruleName}`);
  logger.info(LOG_MODULES.MONITOR, `[EMAIL ALERT] Body: ${alert.message}`);

  // TODO: 实现实际邮件发送逻辑
  // 需要配置 nodemailer 或其他邮件服务
  return true;
}

/**
 * Slack 通知
 */
async function sendSlack(
  config: { webhookUrl: string },
  alert: AlertInstance
): Promise<boolean> {
  try {
    const color = getSeverityColor(alert.severity);

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [{
          color,
          title: `[${alert.severity.toUpperCase()}] ${alert.ruleName}`,
          text: alert.message,
          fields: [
            { title: '当前值', value: alert.value.toFixed(2), short: true },
            { title: '阈值', value: alert.threshold.toFixed(2), short: true },
            { title: '触发时间', value: alert.triggeredAt.toISOString(), short: false },
          ],
        }],
      }),
    });

    return response.ok;
  } catch (error) {
    logger.error(LOG_MODULES.MONITOR, 'Slack notification failed:', { details: { error: error instanceof Error ? error.message : String(error) } });
    return false;
  }
}

/**
 * 钉钉通知
 */
async function sendDingTalk(
  config: { webhookUrl: string; secret?: string },
  alert: AlertInstance
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      msgtype: 'markdown',
      markdown: {
        title: `[${alert.severity.toUpperCase()}] ${alert.ruleName}`,
        text: `### ${alert.ruleName}\n\n` +
              `**严重级别**: ${alert.severity}\n\n` +
              `**消息**: ${alert.message}\n\n` +
              `**当前值**: ${alert.value.toFixed(2)}\n\n` +
              `**阈值**: ${alert.threshold.toFixed(2)}\n\n` +
              `**触发时间**: ${alert.triggeredAt.toISOString()}`,
      },
    };

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return response.ok;
  } catch (error) {
    logger.error(LOG_MODULES.MONITOR, 'DingTalk notification failed:', { details: { error: error instanceof Error ? error.message : String(error) } });
    return false;
  }
}

/**
 * 企业微信通知
 */
async function sendWeChat(
  config: { webhookUrl: string },
  alert: AlertInstance
): Promise<boolean> {
  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content: `### ${alert.ruleName}\n` +
                   `> **严重级别**: ${alert.severity}\n` +
                   `> **消息**: ${alert.message}\n` +
                   `> **当前值**: ${alert.value.toFixed(2)}\n` +
                   `> **阈值**: ${alert.threshold.toFixed(2)}\n` +
                   `> **触发时间**: ${alert.triggeredAt.toISOString()}`,
        },
      }),
    });

    return response.ok;
  } catch (error) {
    logger.error(LOG_MODULES.MONITOR, 'WeChat notification failed:', { details: { error: error instanceof Error ? error.message : String(error) } });
    return false;
  }
}

/**
 * 获取严重级别颜色
 */
function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return '#FF0000';
    case 'high':
      return '#FF6600';
    case 'medium':
      return '#FFCC00';
    case 'low':
      return '#3399FF';
    case 'info':
      return '#999999';
    default:
      return '#999999';
  }
}
