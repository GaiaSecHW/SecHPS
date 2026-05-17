import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { ndJsonStream } from './node_modules/.pnpm/@agentclientprotocol+sdk@0.20.0_zod@3.25.76/node_modules/@agentclientprotocol/sdk/src/index.ts';

const cwd = 'D:\\work\\claude-web-plaatform\\20260514\\claude-web-platform\\shared-workspace\\d7f2b420-b7d7-4b70-9e64-aa7f3d46af2b\\nazhua-agent-opencode';

console.log('[Test] Spawning opencode acp --pure --cwd', cwd);

const proc = spawn('opencode', ['acp', '--pure', '--cwd', cwd], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
  cwd,
  shell: true,
});

proc.stderr.on('data', (d) => process.stderr.write(`[stderr] ${d}`));
proc.on('exit', (code) => console.log(`[Test] Process exited with code ${code}`));
proc.on('error', (e) => console.error(`[Test] Process error:`, e));

const output = Writable.toWeb(proc.stdin);
const input = Readable.toWeb(proc.stdout);
const conn = ndJsonStream(output, input);

console.log('[Test] Connecting...');
const { Connection, PROTOCOL_VERSION } = await import('@agentclientprotocol/sdk');
const connection = new Connection(conn);

await connection.initialize({
  protocolVersion: PROTOCOL_VERSION,
  clientInfo: { name: 'test-client', version: '0.1.0' },
  clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
});
console.log('[Test] Initialized');

const session = await connection.newSession({ cwd, mcpServers: [] });
console.log('[Test] Session created:', session.sessionId);
console.log('[Test] Available modes:', session.modes?.availableModes?.map(m => m.id));
console.log('[Test] Current mode:', session.modes?.currentModeId);

// Switch to nazhua-audit mode
if (session.modes?.availableModes?.find(m => m.id === 'nazhua-audit')) {
  console.log('[Test] Switching to nazhua-audit mode...');
  await connection.setSessionMode({ sessionId: session.sessionId, modeId: 'nazhua-audit' });
}

console.log('[Test] Sending prompt...');
const result = await connection.prompt({
  sessionId: session.sessionId,
  prompt: [{ type: 'text', text: '/nazhua-audit' }],
});

console.log('[Test] Prompt completed, stopReason:', result.stopReason);
proc.kill();
process.exit(0);
