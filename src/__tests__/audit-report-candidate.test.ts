import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findAuditReportCandidate } from '../../codeswarm/packages/worker/src/daemon.js';

describe('findAuditReportCandidate', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-report-'));
    fs.mkdirSync(path.join(workspace, 'Report'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('accepts non-empty AUDIT_REPORT file with any non-temporary suffix', () => {
    const filePath = path.join(workspace, 'Report', 'AUDIT_REPORT.md');
    fs.writeFileSync(filePath, 'done');

    const candidate = findAuditReportCandidate(workspace);

    expect(candidate?.filePath).toBe(filePath);
    expect(candidate?.size).toBe(4);
  });

  it('rejects empty and temporary AUDIT_REPORT files', () => {
    fs.writeFileSync(path.join(workspace, 'Report', 'AUDIT_REPORT.json'), '');
    fs.writeFileSync(path.join(workspace, 'Report', 'AUDIT_REPORT.tmp'), 'done');
    fs.writeFileSync(path.join(workspace, 'Report', 'AUDIT_REPORT.partial'), 'done');
    fs.writeFileSync(path.join(workspace, 'Report', 'AUDIT_REPORT.lock'), 'done');

    expect(findAuditReportCandidate(workspace)).toBeNull();
  });

  it('requires AUDIT_REPORT basename inside Report directory', () => {
    fs.writeFileSync(path.join(workspace, 'AUDIT_REPORT.md'), 'done');
    fs.writeFileSync(path.join(workspace, 'Report', 'OTHER_REPORT.md'), 'done');

    expect(findAuditReportCandidate(workspace)).toBeNull();
  });
});
