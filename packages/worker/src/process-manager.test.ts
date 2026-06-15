import assert from 'node:assert/strict';
import test from 'node:test';
import * as processManager from './process-manager.js';

test('builds opencode stream log event for stderr chunks', () => {
  assert.deepEqual(
    processManager.buildOpencodeStreamLogEvent('stderr line', 'stderr'),
    {
      type: 'log_chunk',
      content: 'stderr line',
      level: 'agent',
      stream: 'stderr',
    },
  );
});

test('extracts text from the last assistant message in opencode export', () => {
  const messages = [
    {
      info: { role: 'assistant' },
      parts: [
        { type: 'text', text: 'old response' },
      ],
    },
    {
      info: { role: 'user' },
      parts: [
        { type: 'text', text: '你是什么模型' },
      ],
    },
    {
      info: { role: 'assistant' },
      parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'internal reasoning' },
        { type: 'text', text: '\n\n我是 mini 模型' },
        { type: 'text', text: ' (custom-mini/mini)。' },
      ],
    },
  ];

  assert.equal(
    processManager.extractOpencodeAssistantText(messages),
    '我是 mini 模型\n (custom-mini/mini)。',
  );
});

test('returns empty string when opencode export contains no assistant text', () => {
  const messages = [
    {
      info: { role: 'assistant' },
      parts: [
        { type: 'reasoning', text: 'hidden' },
        { type: 'step-finish', reason: 'stop' },
      ],
    },
  ];

  assert.equal(processManager.extractOpencodeAssistantText(messages), '');
});
