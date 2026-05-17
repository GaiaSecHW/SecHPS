import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { Connection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk';

const cwd = 'D:\\work\\claude-web-plaatform\\20260514\\claude-web-platform\\shared-workspace\\d7f2b420-b7d7-4b70-9e64-aa7f3d46af2b\\nazhua-agent-opencode';

console.log('[Test] Spawning opencode acp --pure --cwd', cwd);

const proc = spawn('opencode', ['acp', '--pure', '--cwd', cwd], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
  cwd,
  shell: true,
});

proc.stderr.on('data', (d) => process.stderr.write(`[stderr] ${d}`));
proc.on('exit', (code) => { console.log(`[Test] Process exited with code ${code}`); process.exit(code ?? 1); });
proc.on('error', (e) => console.error(`[Test] Process error:`, e));

const output = Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>;
const input = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
const stream = ndJsonStream(output, input);
const connection = new Connection(stream);

async function main() {
console.log('[Test] Connecting...');
await connection.initialize({
  protocolVersion: PROTOCOL_VERSION,
  clientInfo: { name: 'test-client', version: '0.1.0' },
  clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
});
console.log('[Test] Initialized');

const session = await connection.newSession({ cwd, mcpServers: [] });
console.log('[Test] Session:', session.sessionId, 'modes:', session.modes?.availableModes?.map((m: any) => m.id));

if (session.modes?.availableModes?.find((m: any) => m.id === 'nazhua-audit')) {
  console.log('[Test] Switching to nazhua-audit...');
  await connection.setSessionMode({ sessionId: session.sessionId, modeId: 'nazhua-audit' });
}

console.log('[Test] Sending prompt: /nazhua-audit');
const result = await connection.prompt({
  sessionId: session.sessionId,
  prompt: [{ type: 'text', text: '/nazhua-audit' }],
});

console.log('[Test] DONE stopReason:', result.stopReason);
proc.kill();
process.exit(0);
}

main().catch(e => { console.error('[Test] FATAL:', e); proc.kill(); process.exit(1); });
