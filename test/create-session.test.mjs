import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/create-session.mjs';

const input = {
  promptPath: '/Users/example/private/prompt.md',
  codeRoot: '/Users/example/private/project',
  prompt: 'Return the item name.',
  sources: [
    { path: 'good.js', language: 'javascript', content: 'export const name = item => item.name;' },
    { path: 'broken.ts', language: 'typescript', content: 'const broken: = 1;' },
    { path: 'app.py', language: 'python', content: `
from fastapi import FastAPI
app = FastAPI()
@app.get("/")
def read_root():
    return {"Hello": "World"}
` }
  ]
};

test('creates a stable session without leaking absolute input paths', async () => {
  const first = await createSession(input);
  const second = await createSession(input);
  assert.equal(first.id, second.id);
  assert.equal(first.meta.sourceCount, 3);
  assert.equal(first.meta.engine, 'heuristic-local-poc');
  assert.equal(JSON.stringify(first).includes('/Users/example/private'), false);
  assert.ok(first.docUnits.some(unit => unit.file === 'good.js'));
  assert.equal(first.diagnostics[0].file, 'broken.ts');
  assert.ok(first.fastapiStaticContracts.some(route => route.file === 'app.py' && route.path === '/'));
  assert.equal(Object.isFrozen(first), true);
});
