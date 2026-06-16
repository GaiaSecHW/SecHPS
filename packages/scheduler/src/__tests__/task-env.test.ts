import { describe, expect, test } from 'vitest';
import { normalizeSubmitTaskEnv } from '../routes/task.js';

describe('normalizeSubmitTaskEnv', () => {
  test('uses env reserved keys for project dir, tool work dir, and platform task id', () => {
    const result = normalizeSubmitTaskEnv({
      env: {
        INPUT_DIR: '/data/project',
        TOOL_WORK_DIR: '/data/tool-work',
        PLATFORM_TASK_ID: 'platform-123',
        CUSTOM_KEY: 'custom-value',
      },
      projectPath: '/legacy/project',
      toolWorkDir: '/legacy/tool-work',
      platformTaskId: 'legacy-platform',
    });

    expect(result.projectDir).toBe('/data/project');
    expect(result.toolWorkDir).toBe('/data/tool-work');
    expect(result.platformTaskId).toBe('platform-123');
    expect(result.env).toEqual({
      INPUT_DIR: '/data/project',
      TOOL_WORK_DIR: '/data/tool-work',
      PLATFORM_TASK_ID: 'platform-123',
      CUSTOM_KEY: 'custom-value',
    });
  });

  test('falls back to legacy top-level fields during migration', () => {
    const result = normalizeSubmitTaskEnv({
      env: {
        CUSTOM_KEY: 'custom-value',
      },
      projectPath: '/legacy/project',
      toolWorkDir: '/legacy/tool-work',
      platformTaskId: 'legacy-platform',
    });

    expect(result.projectDir).toBe('/legacy/project');
    expect(result.toolWorkDir).toBe('/legacy/tool-work');
    expect(result.platformTaskId).toBe('legacy-platform');
    expect(result.env).toEqual({
      CUSTOM_KEY: 'custom-value',
      INPUT_DIR: '/legacy/project',
      TOOL_WORK_DIR: '/legacy/tool-work',
      PLATFORM_TASK_ID: 'legacy-platform',
    });
  });
});
