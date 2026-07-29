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

test('injects collectFastApiOpenApi to build drift questions and sanitize payloads', async () => {
  const fakeInput = {
    ...input,
    runtime: 'fastapi',
    fastapiApp: 'app:app',
    sources: [
      {
        path: 'app.py', language: 'python', content: `
from fastapi import FastAPI
app = FastAPI()
@app.get("/items")
def get_items(): pass
`
      }
    ]
  };

  const fakeCollect = async (opts) => {
    assert.equal(opts.appTarget, 'app:app');
    assert.equal(opts.codePath, '/Users/example/private/project');
    return {
      openapi: {
        paths: {
          '/items': {
            post: { operationId: 'create_item' }
          }
        }
      },
      diagnostic: null
    };
  };

  const session = await createSession(fakeInput, { collectFastApiOpenApi: fakeCollect });

  assert.equal(session.fastapiApp, 'app:app');
  assert.ok(session.openapi.paths['/items'].post);

  const drift = session.questions.find(q => q.type === 'method-drift');
  assert.ok(drift);
  assert.equal(drift.promptEvidence, 'app.py:4');
  assert.equal(drift.docUnitIds[0], 'openapi:/items');
});

test('handles collectFastApiOpenApi diagnostic injection securely', async () => {
  const fakeInput = {
    ...input,
    runtime: 'fastapi',
    fastapiApp: 'app:app'
  };

  const fakeCollect = async () => {
    return {
      openapi: null,
      diagnostic: { type: 'docker_error', message: 'Fake missing docker' }
    };
  };

  const session = await createSession(fakeInput, { collectFastApiOpenApi: fakeCollect });

  assert.equal(session.runtimeDiagnostic, 'docker_error: Fake missing docker');
  assert.equal(session.openapi, null);

  const diagQuestion = session.questions.find(q => q.type === 'runtime-diagnostic');
  assert.ok(diagQuestion);
  assert.equal(diagQuestion.reason, 'Sandbox execution rejected the container or startup crashed safely.');
});
