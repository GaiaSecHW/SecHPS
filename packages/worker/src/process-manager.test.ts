import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as processManager from './process-manager.js';

test('builds opencode run args with print logs for session recovery', () => {
  assert.deepEqual(
    processManager.buildOpencodeRunArgs('reviewer', '检查代码'),
    ['run', '--print-logs', '--agent', 'reviewer', '检查代码'],
  );
});

test('builds separate opencode stdout and stderr log file paths', () => {
  assert.deepEqual(
    processManager.buildOpencodeLogFilePaths('/workspace/task'),
    {
      stdout: path.join('/workspace/task', 'opencode_stdout.logs'),
      stderr: path.join('/workspace/task', 'opencode_stderr.logs'),
    },
  );
});

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

test('builds script env with virtual API key, model, and provider base URL', () => {
  const env = processManager.buildAgentEnvironment({
    engine: 'script',
    apiKey: 'virtual_api_key',
    model: 'openai/gpt-4.1',
    apiBaseUrl: 'https://aigw.example.com/v1',
    baseEnv: { PATH: '/usr/bin' },
    env: { TASK_ENV: 'task-value' },
  });

  assert.deepEqual(env, {
    PATH: '/usr/bin',
    TASK_ENV: 'task-value',
    CODESWARM_API_KEY: 'virtual_api_key',
    CODESWARM_MODEL: 'openai/gpt-4.1',
    CODESWARM_API_BASE_URL: 'https://aigw.example.com/v1',
    OPENAI_API_KEY: 'virtual_api_key',
    OPENAI_BASE_URL: 'https://aigw.example.com/v1',
    ANTHROPIC_API_KEY: 'virtual_api_key',
    ANTHROPIC_BASE_URL: 'https://aigw.example.com/v1',
    ANTHROPIC_MODEL: 'openai/gpt-4.1',
  });
});

test('writes a debug env snapshot for script env variables', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeswarm-env-'));
  const workspace = path.join(tmpDir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });

  const snapshotPath = processManager.writeDebugEnvSnapshot({
    workspacePath: workspace,
    engine: 'script',
    env: {
      CODESWARM_API_KEY: 'virtual_api_key',
      CODESWARM_API_BASE_URL: 'https://aigw.example.com/v1',
      CODESWARM_MODEL: 'openai/gpt-4.1',
      OPENAI_API_KEY: 'virtual_api_key',
      OPENAI_BASE_URL: 'https://aigw.example.com/v1',
      ANTHROPIC_API_KEY: 'virtual_api_key',
      ANTHROPIC_BASE_URL: 'https://aigw.example.com/v1',
      ANTHROPIC_MODEL: 'openai/gpt-4.1',
    },
  });

  assert.equal(snapshotPath, path.join(workspace, '.env.codeswarm.debug'));
  assert.equal(fs.readFileSync(snapshotPath, 'utf8'), [
    'ENGINE=script',
    'CODESWARM_API_KEY=virtual_api_key',
    'CODESWARM_API_BASE_URL=https://aigw.example.com/v1',
    'CODESWARM_MODEL=openai/gpt-4.1',
    'ANTHROPIC_AUTH_TOKEN=<unset>',
    'CLAUDE_API_KEY=<unset>',
    'ANTHROPIC_API_KEY=virtual_api_key',
    'ANTHROPIC_BASE_URL=https://aigw.example.com/v1',
    'ANTHROPIC_MODEL=openai/gpt-4.1',
    'OPENAI_API_KEY=virtual_api_key',
    'OPENAI_BASE_URL=https://aigw.example.com/v1',
    '',
  ].join('\n'));
});

test('writes a debug env snapshot for claudecode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeswarm-env-'));
  const workspace = path.join(tmpDir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });

  const snapshotPath = processManager.writeDebugEnvSnapshot({
    workspacePath: workspace,
    engine: 'claudecode',
    env: {
      ANTHROPIC_AUTH_TOKEN: 'virtual_auth_token',
      CLAUDE_API_KEY: 'virtual_claude_key',
      ANTHROPIC_API_KEY: 'should_not_be_written',
      ANTHROPIC_BASE_URL: 'https://aigw.example.com',
      ANTHROPIC_MODEL: 'anthropic/claude-opus-4-8',
    },
  });

  assert.equal(snapshotPath, path.join(workspace, '.env.codeswarm.debug'));
  assert.equal(fs.readFileSync(snapshotPath, 'utf8'), [
    'ENGINE=claudecode',
    'CODESWARM_API_KEY=<unset>',
    'CODESWARM_API_BASE_URL=<unset>',
    'CODESWARM_MODEL=<unset>',
    'ANTHROPIC_AUTH_TOKEN=virtual_auth_token',
    'CLAUDE_API_KEY=virtual_claude_key',
    'ANTHROPIC_API_KEY=should_not_be_written',
    'ANTHROPIC_BASE_URL=https://aigw.example.com',
    'ANTHROPIC_MODEL=anthropic/claude-opus-4-8',
    'OPENAI_API_KEY=<unset>',
    'OPENAI_BASE_URL=<unset>',
    '',
  ].join('\n'));
});
