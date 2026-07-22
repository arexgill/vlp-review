import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/create-session.mjs';

const input = {
  promptPath: '/Users/example/private/prompt.md',
  codeRoot: '/Users/example/private/project',
  prompt: 'Return the item name.',
  sources: [
    { path: 'good.js', language: 'javascript', content: 'export const name = item => item.name;' },
    { path: 'broken.ts', language: 'typescript', content: 'const broken: = 1;' }
  ]
};

test('creates a stable session without leaking absolute input paths', () => {
  const first = createSession(input);
  const second = createSession(input);
  assert.equal(first.id, second.id);
  assert.equal(first.meta.sourceCount, 2);
  assert.equal(first.meta.engine, 'heuristic-local-poc');
  assert.equal(JSON.stringify(first).includes('/Users/example/private'), false);
  assert.ok(first.docUnits.some(unit => unit.file === 'good.js'));
  assert.equal(first.diagnostics[0].file, 'broken.ts');
  assert.equal(Object.isFrozen(first), true);
});
