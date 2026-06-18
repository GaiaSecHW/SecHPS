import assert from 'node:assert/strict';
import test from 'node:test';
import { getEngineBadge, getEngineLabel } from './engine-display.js';

test('renders script engine as Script instead of OpenCode', () => {
  assert.equal(getEngineLabel('script'), 'Script');
  assert.deepEqual(getEngineBadge('script'), {
    label: 'Script',
    color: 'bg-cyan-900/30 text-cyan-400',
  });
});
