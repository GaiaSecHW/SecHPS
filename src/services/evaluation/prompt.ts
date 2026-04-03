// src/services/evaluation/prompt.ts

import { AIMessage } from '@/services/ai';

export interface PromptContext {
  projectName: string;
  projectDescription?: string;
  environmentUrl?: string;
  files: Array<{
    name: string;
    type: string;
    size: number;
  }>;
  taskDescription?: string;
  conversationHistory?: AIMessage[];
}

/**
 * Prompt 构建器
 */
export class PromptBuilder {
  /**
   * 构建系统提示词
   */
  buildSystemPrompt(): string {
    return `你是一个专业的代码评估专家。你的任务是对项目进行全面评估，包括：

1. 分析项目结构和代码质量
2. 识别潜在的安全漏洞
3. 评估代码的可维护性和可扩展性
4. 提供改进建议
5. 给项目整体评分（1-10 分）

请使用专业的语气，提供具体、可操作的建议。如果用户有后续问题，请基于之前的评估内容进行回答。`;
  }

  /**
   * 构建用户提示词（首次评估）
   */
  buildUserPrompt(context: PromptContext): string {
    let prompt = `## 项目信息\n`;
    prompt += `- 项目名称: ${context.projectName}\n`;

    if (context.projectDescription) {
      prompt += `- 项目描述: ${context.projectDescription}\n`;
    }

    if (context.environmentUrl) {
      prompt += `- 环境地址: ${context.environmentUrl}\n`;
    }

    prompt += `\n## 上传的文件\n`;
    if (context.files.length > 0) {
      prompt += context.files
        .map(f => `- ${f.name} (${f.type}, ${this.formatFileSize(f.size)})`)
        .join('\n');
    } else {
      prompt += '（暂无上传文件）';
    }
    prompt += `\n\n`;

    if (context.taskDescription) {
      prompt += `## 评估任务\n`;
      prompt += context.taskDescription;
    } else {
      prompt += `## 评估要求\n`;
      prompt += `1. 分析项目结构和代码质量\n`;
      prompt += `2. 识别潜在的安全漏洞\n`;
      prompt += `3. 评估代码的可维护性和可扩展性\n`;
      prompt += `4. 提供改进建议\n`;
      prompt += `5. 给项目整体评分（1-10 分）\n\n`;
      prompt += `请开始你的评估：`;
    }

    return prompt;
  }

  /**
   * 构建完整的消息列表
   */
  buildMessages(context: PromptContext): AIMessage[] {
    const messages: AIMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
    ];

    // 添加对话历史
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      messages.push(...context.conversationHistory);
    } else {
      // 首次评估，添加初始用户消息
      messages.push({
        role: 'user',
        content: this.buildUserPrompt(context),
      });
    }

    return messages;
  }

  /**
   * 格式化文件大小
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
