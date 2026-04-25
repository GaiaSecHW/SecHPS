/**
 * Token 计数工具
 */
export function countTokens(messages: Array<{role: string; content: string | any[]}>): number {
  let total = 0;
  for (const msg of messages) {
    total += 4;
    if (typeof msg.content === 'string') {
      total += Math.ceil(msg.content.length / 4);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          total += Math.ceil(part.text.length / 4);
        }
      }
    }
  }
  return total;
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}