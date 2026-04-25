const BUFFER = 1000;
const MIN_TOKENS = 1024;

export function calculateSafeMaxTokens(maxTokens: number, contextWindow: number, inputTokens: number): number {
  if (contextWindow <= 0) return Math.max(maxTokens, MIN_TOKENS);
  const availableTokens = contextWindow - inputTokens - BUFFER;
  return Math.max(Math.min(maxTokens, availableTokens), MIN_TOKENS);
}

export { BUFFER, MIN_TOKENS };