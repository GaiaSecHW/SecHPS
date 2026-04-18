// src/services/evaluation/prompt.ts

import { AIMessage } from '@/services/ai';
import type { LoadedSkill, Severity } from '@/services/skills';

export interface PromptContext {
  projectName: string;
  projectDescription?: string;
  environmentUrl?: string;
  projectPath?: string;  // 新增：项目路径
  files: Array<{
    name: string;
    type: string;
    size: number;
  }>;
  taskDescription?: string;
  conversationHistory?: AIMessage[];
  skills?: LoadedSkill[];  // 新增：激活的 Skills
  skillsContext?: {        // 新增：Skills 上下文变量
    projectPath?: string;
    targetFiles?: string[];
    customVariables?: Record<string, string>;
  };
}

/**
 * Prompt 构建器
 */
export class PromptBuilder {
  /**
   * 构建系统提示词
   */
  buildSystemPrompt(context?: PromptContext): string {
    let systemPrompt = `你是一个专业的代码评估专家。你的任务是对项目进行全面评估，包括：

1. 分析项目结构和代码质量
2. 识别潜在的安全漏洞
3. 评估代码的可维护性和可扩展性
4. 提供改进建议
5. 给项目整体评分（1-10 分）

请使用专业的语气，提供具体、可操作的建议。如果用户有后续问题，请基于之前的评估内容进行回答。`;

    // 如果有项目路径，提示 Claude 会自动发现 Skills
    if (context?.projectPath) {
      systemPrompt += '\n\n';
      systemPrompt += `项目路径: ${context.projectPath}\n`;
      systemPrompt += '\n';
      systemPrompt += `注意：该项目目录下可能包含自定义 Skills（.claude/skills/），`;
      systemPrompt += `请根据评估需求自动加载和使用这些 Skills。`;
      systemPrompt += `你可以在评估过程中根据需要调用特定的 Skill，例如：`;
      systemPrompt += `- /sql-injection - 检测 SQL 注入漏洞`;
      systemPrompt += `- /xss-detection - 检测 XSS 漏洞`;
      systemPrompt += `- /auth-bypass - 检测认证绕过漏洞`;
      systemPrompt += `- /hardcoded-secrets - 检测硬编码密钥`;
      systemPrompt += `\n`;
      systemPrompt += `Skills 会根据其 description 字段自动匹配你的评估需求。`;
    }

    return systemPrompt;
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
      { role: 'system', content: this.buildSystemPrompt(context) },
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

/**
 * 获取分类标签
 */
function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    'code-audit': '代码审计',
    'auth': '认证鉴权',
    'sensitive': '敏感信息',
    'api': 'API 安全',
    'config': '配置安全',
    'crypto': '加密解密',
    'web': 'Web 安全',
    'business': '业务逻辑',
    'client': '客户端安全',
    'cloud': '云安全',
  };
  return labels[category] || category;
}

/**
 * 获取严重程度标签
 */
function getSeverityLabel(severity: Severity): string {
  const labels: Record<Severity, string> = {
    critical: '严重',
    high: '高危',
    medium: '中危',
    low: '低危',
    info: '信息',
  };
  return labels[severity] || severity;
}
