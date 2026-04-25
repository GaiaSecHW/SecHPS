export function parseContextWindowFromError(error: string | any): number | null {
  const errorStr = typeof error === 'string' ? error : (error?.message || JSON.stringify(error));
  if (!errorStr) return null;
  const patterns = [
    /context length is only (\d+) tokens/i,
    /model's context length is only (\d+)/i,
    /context window is (\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = errorStr.match(pattern);
    if (match && match[1]) {
      const value = parseInt(match[1], 10);
      if (value > 1000 && value < 2000000) return value;
    }
  }
  return null;
}

export function parseInputTokensFromError(error: string | any): number | null {
  const errorStr = typeof error === 'string' ? error : (error?.message || JSON.stringify(error));
  if (!errorStr) return null;
  const match = errorStr.match(/passed (\d+) input tokens/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

export function parseContextError(error: string | any): {contextWindow: number|null, inputTokens: number|null, overflow: number|null} {
  const contextWindow = parseContextWindowFromError(error);
  const inputTokens = parseInputTokensFromError(error);
  return { contextWindow, inputTokens, overflow: contextWindow && inputTokens ? inputTokens - contextWindow : null };
}