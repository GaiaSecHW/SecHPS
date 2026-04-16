// src/services/evaluation/history.ts

import { prisma } from '@/lib/prisma';
import { AIMessage } from '@/services/ai';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
}

/**
 * 对话历史管理
 */
export class ConversationHistory {
  /**
   * 获取对话历史
   */
  async getMessages(evaluationId: string): Promise<ConversationMessage[]> {
    const messages = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: evaluationId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: m.createdAt,
    }));
  }

  /**
   * 添加用户消息
   */
  async addUserMessage(evaluationId: string, content: string): Promise<ConversationMessage> {
    const message = await prisma.sessionMessage.create({
      data: {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        evaluationSessionId: evaluationId,
        role: 'user',
        content,
      },
    });

    // 更新消息计数
    await this.updateMessageCount(evaluationId);

    return {
      id: message.id,
      role: 'user',
      content: message.content,
      createdAt: message.createdAt,
    };
  }

  /**
   * 添加助手消息
   */
  async addAssistantMessage(evaluationId: string, content: string): Promise<ConversationMessage> {
    const message = await prisma.sessionMessage.create({
      data: {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        evaluationSessionId: evaluationId,
        role: 'assistant',
        content,
      },
    });

    // 更新消息计数
    await this.updateMessageCount(evaluationId);

    return {
      id: message.id,
      role: 'assistant',
      content: message.content,
      createdAt: message.createdAt,
    };
  }

  /**
   * 更新评估会话的消息计数
   */
  private async updateMessageCount(evaluationId: string): Promise<void> {
    try {
      const count = await prisma.sessionMessage.count({
        where: { evaluationSessionId: evaluationId },
      });

      await prisma.evaluationSession.update({
        where: { id: evaluationId },
        data: {
          messageCount: count,
          lastActivity: new Date(),
        },
      });
    } catch (error) {
      console.error('更新消息计数失败:', error);
    }
  }

  /**
   * 获取最近的对话历史（用于上下文窗口）
   */
  async getRecentMessages(
    evaluationId: string,
    maxTokens: number = 100000
  ): Promise<AIMessage[]> {
    // 获取所有消息
    const messages = await this.getMessages(evaluationId);

    // 简单估算：平均 1 token ≈ 4 字符（中文约 1.5 字符/token）
    const maxChars = maxTokens * 3;
    let totalChars = 0;
    const result: AIMessage[] = [];

    // 从最新消息开始，向前累积
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      totalChars += msg.content.length;
      if (totalChars > maxChars && result.length > 0) break;
      result.unshift({
        role: msg.role,
        content: msg.content,
      });
    }

    return result;
  }

  /**
   * 清除对话历史
   */
  async clearHistory(evaluationId: string): Promise<void> {
    await prisma.sessionMessage.deleteMany({
      where: { evaluationSessionId: evaluationId },
    });
  }

  /**
   * 获取对话统计
   */
  async getStats(evaluationId: string): Promise<{
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
  }> {
    const messages = await this.getMessages(evaluationId);
    return {
      totalMessages: messages.length,
      userMessages: messages.filter(m => m.role === 'user').length,
      assistantMessages: messages.filter(m => m.role === 'assistant').length,
    };
  }
}
