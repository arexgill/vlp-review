import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVlpServer, listen } from '../src/server.mjs';

const session = {
  id: 'session-http',
  prompt: 'Prompt',
  sources: [],
  docUnits: [],
  diagnostics: [],
  questions: [],
  meta: {}
};

async function runningServer(t) {
  const publicDir = await mkdtemp(path.join(tmpdir(), 'vlp-public-'));
  await writeFile(path.join(publicDir, 'index.html'), '<h1>VLP</h1>');
  await writeFile(path.join(publicDir, 'app.js'), 'console.log("VLP")');
  await writeFile(path.join(publicDir, 'styles.css'), 'body{}');
  const server = createVlpServer({ session, publicDir });
  const address = await listen(server, { port: 0 });
  t.after(() => server.close());
  return address;
}

test('serves the session, report API, static allowlist, and security headers', async t => {
  const address = await runningServer(t);

  const response = await fetch(`${address.url}/api/session`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, 'session-http');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);

  const report = await fetch(`${address.url}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ responses: [] })
  });
  assert.equal(report.status, 200);
  assert.match((await report.json()).markdown, /VLP Review Report/);

  assert.equal((await fetch(`${address.url}/`)).status, 200);
  assert.equal((await fetch(`${address.url}/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(`${address.url}/../package.json`)).status, 404);
  assert.equal((await fetch(`${address.url}/unknown`)).status, 404);
});

test('rejects malformed, oversized, and disallowed API requests', async t => {
  const address = await runningServer(t);

  const malformed = await fetch(`${address.url}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not-json'
  });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /JSON/i);

  const wrongMethod = await fetch(`${address.url}/api/report`);
  assert.equal(wrongMethod.status, 405);

  const oversized = await fetch(`${address.url}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ responses: [], padding: 'x'.repeat(257 * 1024) })
  });
  assert.equal(oversized.status, 413);
});
