export interface DisplayEvent {
  type?: string;
  data?: unknown;
  content?: string;
  message?: string;
  output?: string;
  phase?: string;
  success?: boolean;
  level?: string;
  stream?: string;
  [key: string]: unknown;
}

interface EventBadge {
  badge: string;
  color: string;
}

export function getEventPayload(event: DisplayEvent): DisplayEvent {
  if (typeof event.data === 'string') {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...parsed, ...event };
      }
    } catch {
      return event;
    }
  }

  if (event.data && typeof event.data === 'object' && !Array.isArray(event.data)) {
    return { ...(event.data as Record<string, unknown>), ...event };
  }

  return event;
}

export function cleanEventText(text: string, max = 150): string {
  if (!text) return '';
  let clean = text;
  try { clean = JSON.parse(`"${clean}"`); } catch {}
  clean = clean.replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\\"/g, '"').replace(/  +/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

export function getEventContent(event: DisplayEvent): string {
  const payload = getEventPayload(event);

  if (event.type === 'phase_start' || event.type === 'phase_complete' || event.type === 'phase_error') {
    return [payload.phase, payload.message].filter(Boolean).join(' - ');
  }

  if (typeof payload.content === 'string') return payload.content;
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.output === 'string') return cleanEventText(payload.output, 150);
  if (typeof event.data === 'string') return event.data;

  return '';
}

export function getEventBadge(event: DisplayEvent): EventBadge {
  const payload = getEventPayload(event);
  const type = event.type;

  if (type === 'tool_call') return { badge: 'Tool', color: 'bg-yellow-900/50 text-yellow-400' };
  if (type === 'tool_result' || type === 'tool_call_update') return { badge: 'Result', color: 'bg-blue-900/50 text-blue-300' };
  if (type === 'error') return { badge: 'Error', color: 'bg-red-900/50 text-red-400' };
  if (type === 'phase_error') return { badge: 'Phase Error', color: 'bg-red-900/50 text-red-400' };
  if (type === 'skill_start') return { badge: 'Skill', color: 'bg-purple-900/50 text-purple-400' };
  if (type === 'skill_complete') return { badge: 'Skill✓', color: 'bg-purple-900/40 text-purple-300' };
  if (type === 'phase_start') return { badge: 'Phase Start', color: 'bg-cyan-900/50 text-cyan-400' };
  if (type === 'phase_complete') {
    return payload.success === false
      ? { badge: 'Phase Failed', color: 'bg-red-900/50 text-red-400' }
      : { badge: 'Phase Done', color: 'bg-emerald-900/40 text-emerald-300' };
  }
  if (type === 'log_chunk' || type === 'agent_log_chunk') {
    const level = typeof payload.level === 'string' ? payload.level : 'agent';
    const stream = typeof payload.stream === 'string' ? payload.stream.toUpperCase() : 'LOG';
    if (payload.stream === 'stderr') return { badge: `${level === 'worker' ? 'Worker' : 'Agent'} ${stream}`, color: 'bg-orange-900/40 text-orange-300' };
    return { badge: `${level === 'worker' ? 'Worker' : 'Agent'} ${stream}`, color: 'bg-gray-700 text-gray-300' };
  }
  if (type === 'agent_message_chunk') return { badge: 'Agent', color: 'bg-gray-700 text-gray-300' };

  return { badge: type || 'Event', color: 'bg-gray-700 text-gray-300' };
}
