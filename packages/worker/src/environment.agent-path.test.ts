import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { EnvironmentFactory } from './environment.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('copies agentPath directory into provided workspace before resolving agent config', async () => {
  const workspacePath = tempDir('codeswarm-workspace-');
  const agentPath = tempDir('codeswarm-agent-');
  fs.writeFileSync(path.join(agentPath, 'instruction.txt'), 'instruction from agentPath');
  fs.writeFileSync(path.join(agentPath, 'opencode.json'), JSON.stringify({ default_agent: 'agent-from-path' }));

  const factory = new EnvironmentFactory({ workspaceBasePath: tempDir('codeswarm-base-') });

  const result = await factory.build({
    taskId: 'task-agent-path',
    instruction: 'payload instruction',
    projectPath: '',
    skills: [],
    scripts: [],
    mcps: [],
    workspacePath,
    agentPath,
  });

  assert.equal(fs.readFileSync(path.join(workspacePath, 'instruction.txt'), 'utf-8'), 'instruction from agentPath');
  assert.equal(fs.existsSync(path.join(workspacePath, 'opencode.json')), true);
  assert.equal(result.workspacePath, workspacePath);
  assert.equal(result.instruction, 'instruction from agentPath');
  assert.equal(result.agent, 'agent-from-path');
});
