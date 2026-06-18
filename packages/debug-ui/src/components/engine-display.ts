export function getEngineLabel(engine: string | null | undefined): string {
  if (engine === 'claudecode') return 'Claude Code';
  if (engine === 'opencode') return 'OpenCode';
  if (engine === 'script') return 'Script';
  return engine || '-';
}

export function getEngineBadge(engine: string | null | undefined): { label: string; color: string } {
  if (engine === 'claudecode') {
    return { label: 'Claude Code', color: 'bg-purple-900/30 text-purple-400' };
  }
  if (engine === 'script') {
    return { label: 'Script', color: 'bg-cyan-900/30 text-cyan-400' };
  }
  return { label: getEngineLabel(engine), color: 'bg-orange-900/20 text-orange-400' };
}
