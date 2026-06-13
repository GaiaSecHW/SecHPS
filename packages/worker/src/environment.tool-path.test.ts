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

test('copies toolPath directory into provided workspace before resolving tool config', async () => {
  const workspacePath = tempDir('codeswarm-workspace-');
  const toolPath = tempDir('codeswarm-tool-');
  fs.writeFileSync(path.join(toolPath, 'instruction.txt'), 'instruction from toolPath');
  fs.writeFileSync(path.join(toolPath, 'opencode.json'), JSON.stringify({ default_agent: 'tool-from-path' }));

  const factory = new EnvironmentFactory({ workspaceBasePath: tempDir('codeswarm-base-') });

  const result = await factory.build({
    taskId: 'task-tool-path',
    instruction: 'payload instruction',
    projectPath: '',
    skills: [],
    scripts: [],
    mcps: [],
    workspacePath,
    toolPath,
  });

  assert.equal(fs.readFileSync(path.join(workspacePath, 'instruction.txt'), 'utf-8'), 'instruction from toolPath');
  assert.equal(fs.existsSync(path.join(workspacePath, 'opencode.json')), true);
  assert.equal(result.workspacePath, workspacePath);
  assert.equal(result.instruction, 'instruction from toolPath');
  assert.equal(result.agent, 'tool-from-path');
});
