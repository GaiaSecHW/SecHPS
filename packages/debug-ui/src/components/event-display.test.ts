import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventBadge, getEventContent } from './event-display.js';

test('renders phase events from flattened event fields', () => {
  const event = {
    type: 'phase_complete',
    phase: 'building',
    message: '环境构建完成: /data/work/run',
    success: true,
    timestamp: '2026-06-15T01:00:00.000Z',
  };

  assert.deepEqual(getEventBadge(event), {
    badge: 'Phase Done',
    color: 'bg-emerald-900/40 text-emerald-300',
  });
  assert.equal(getEventContent(event), 'building - 环境构建完成: /data/work/run');
});

test('renders phase events from JSON data payload', () => {
  const event = {
    type: 'phase_start',
    data: JSON.stringify({ phase: 'workkey', message: '正在获取虚拟 API Key...' }),
  };

  assert.deepEqual(getEventBadge(event), {
    badge: 'Phase Start',
    color: 'bg-cyan-900/50 text-cyan-400',
  });
  assert.equal(getEventContent(event), 'workkey - 正在获取虚拟 API Key...');
});

test('renders opencode stderr log chunks from flattened event fields', () => {
  const event = {
    type: 'log_chunk',
    content: 'opencode stderr line',
    level: 'agent',
    stream: 'stderr',
  };

  assert.deepEqual(getEventBadge(event), {
    badge: 'Agent STDERR',
    color: 'bg-orange-900/40 text-orange-300',
  });
  assert.equal(getEventContent(event), 'opencode stderr line');
});
