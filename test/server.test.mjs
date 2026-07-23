import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVlpServer, listen } from '../src/server.mjs';

const session = {
  id: 'session-http',
  prompt: 'Search all product fields.',
  sources: [],
  diagnostics: [],
  questions: [
    {
      id: 'q-approved',
      type: 'wrong-value',
      severity: 'medium',
      title: 'Result limit',
      ask: 'Is 25 intended?',
      reason: 'The value is unstated.',
      promptEvidence: '',
      docUnitIds: ['doc-1']
    },
    {
      id: 'q-escalated',
      type: 'api-use',
      severity: 'medium',
      title: 'Errors',
      ask: 'How should errors surface?',
      reason: 'No error path.',
      promptEvidence: '',
      docUnitIds: ['doc-2']
    }
  ],
  docUnits: [
    { id: 'doc-1', file: 'search.js', lineStart: 6, text: 'It limits to 25.', code: 'slice(0, 25)' },
    { id: 'doc-2', file: 'search.js', lineStart: 9, text: 'It throws a generic error.', code: 'throw new Error()' }
  ],
  meta: {}
};

const notConfiguredReview = {
  status: 'not-configured',
  provider: null,
  model: null,
  threshold: 0.8,
  startedAt: null,
  completedAt: null,
  summary: '',
  results: [],
  error: null
};

const readyAgentReview = {
  status: 'ready',
  provider: 'server-provider',
  model: 'server-model',
  threshold: 0.8,
  startedAt: null,
  completedAt: null,
  summary: '',
  results: [],
  error: null
};

const runningAgentReview = {
  ...readyAgentReview,
  status: 'running',
  startedAt: '2026-07-22T10:00:00.000Z'
};

const approvedAgentReview = {
  status: 'approved',
  provider: 'server-provider',
  model: 'server-model',
  threshold: 0.8,
  startedAt: '2026-07-22T10:00:00.000Z',
  completedAt: '2026-07-22T10:00:01.000Z',
  summary: 'Agent approved the review.',
  results: [
    {
      questionId: 'q-approved',
      status: 'approved',
      proposedDecision: 'accept',
      effectiveDecision: 'accept',
      answer: '25 results is correct.',
      rationale: 'Matches the intended limit.',
      confidence: 0.93,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: ['doc-1'],
      escalationReasons: []
    },
    {
      questionId: 'q-escalated',
      status: 'approved',
      proposedDecision: 'correct',
      effectiveDecision: 'correct',
      answer: 'Surface a typed search error.',
      rationale: 'The prompt requires an actionable error.',
      confidence: 0.91,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: ['doc-2'],
      escalationReasons: []
    }
  ],
  error: null
};

function createFakeReviewService(initial, completed = initial) {
  let state = structuredClone(initial);
  let runCalls = 0;
  return {
    get runCalls() {
      return runCalls;
    },
    getState() {
      return structuredClone(state);
    },
    async run() {
      runCalls += 1;
      state = structuredClone(completed);
      return structuredClone(state);
    }
  };
}

async function runningServer(t, { sessionData = session, agentReviewService = null } = {}) {
  const publicDir = await mkdtemp(path.join(tmpdir(), 'vlp-public-'));
  await writeFile(path.join(publicDir, 'index.html'), '<h1>VLP</h1>');
  await writeFile(path.join(publicDir, 'app.js'), 'console.log("VLP")');
  await writeFile(path.join(publicDir, 'styles.css'), 'body{}');
  const server = createVlpServer({ session: sessionData, publicDir, agentReviewService });
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
    body: JSON.stringify({
      responses: [
        { questionId: 'q-approved', decision: 'accept', answer: '25 results is correct.' },
        { questionId: 'q-escalated', decision: 'correct', answer: 'Surface a typed search error.' }
      ]
    })
  });
  assert.equal(report.status, 200);
  assert.match((await report.json()).markdown, /VLP Review Report/);

  assert.equal((await fetch(`${address.url}/`)).status, 200);
  assert.equal((await fetch(`${address.url}/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(`${address.url}/../package.json`)).status, 404);
  assert.equal((await fetch(`${address.url}/unknown`)).status, 404);
});

test('serves the agent review API from server-owned state', async t => {
  const fakeService = createFakeReviewService(readyAgentReview, approvedAgentReview);
  const address = await runningServer(t, { agentReviewService: fakeService });

  const initial = await fetch(`${address.url}/api/agent-review`);
  assert.equal(initial.status, 200);
  assert.deepEqual(await initial.json(), fakeService.getState());

  const run = await fetch(`${address.url}/api/agent-review`, { method: 'POST' });
  assert.equal(run.status, 200);
  assert.equal((await run.json()).status, 'approved');
  assert.equal(fakeService.runCalls, 1);

  const wrongMethod = await fetch(`${address.url}/api/agent-review`, { method: 'DELETE' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET, POST');
});

test('ignores forged agent review payloads and rejects browser overrides of agent-approved questions', async t => {
  const fakeService = createFakeReviewService(approvedAgentReview);
  const address = await runningServer(t, { agentReviewService: fakeService });

  const forged = await fetch(`${address.url}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      responses: [],
      agentReview: {
        status: 'approved',
        provider: 'forged-provider',
        model: 'forged-model',
        threshold: 0.1,
        startedAt: null,
        completedAt: null,
        summary: 'forged-summary',
        results: []
      }
    })
  });
  assert.equal(forged.status, 200);
  const forgedMarkdown = (await forged.json()).markdown;
  assert.match(forgedMarkdown, /Reviewer: server-provider \/ server-model/);
  assert.match(forgedMarkdown, /25 results is correct\./);
  assert.match(forgedMarkdown, /Surface a typed search error\./);
  assert.doesNotMatch(forgedMarkdown, /forged-provider|forged-model|forged-summary/);

  const override = await fetch(`${address.url}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      responses: [{
        questionId: 'q-approved',
        decision: 'correct',
        answer: 'Override the approved answer.'
      }]
    })
  });
  assert.equal(override.status, 400);
  assert.deepEqual(await override.json(), { error: 'Invalid report responses' });
});

test('maps explicit report-validation errors to a safe 400 response', async t => {
  const manualAddress = await runningServer(t);
  const approvedAgentAddress = await runningServer(t, {
    agentReviewService: createFakeReviewService(approvedAgentReview)
  });
  const readyAgentAddress = await runningServer(t, {
    agentReviewService: createFakeReviewService(readyAgentReview)
  });

  for (const [address, payload] of [
    [manualAddress, { responses: [{ questionId: 'does-not-exist', decision: 'accept', answer: '' }] }],
    [manualAddress, { responses: [{ questionId: 'q-approved', decision: 'maybe', answer: '' }] }],
    [manualAddress, { responses: [
      { questionId: 'q-approved', decision: 'accept', answer: '' },
      { questionId: 'q-approved', decision: 'accept', answer: '' }
    ] }],
    [manualAddress, { responses: [{ questionId: 'q-approved', decision: 'correct', answer: ' ' }] }],
    [manualAddress, { responses: [{ questionId: 'q-approved', decision: 'correct', answer: 'x'.repeat(4001) }] }],
    [approvedAgentAddress, { responses: [{ questionId: 'q-approved', decision: 'correct', answer: 'Override the approved answer.' }] }],
    [readyAgentAddress, { responses: [{ questionId: 'q-escalated', decision: 'correct', answer: 'Surface a typed search error.' }] }]
  ]) {
    const report = await fetch(`${address.url}/api/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(report.status, 400);
    assert.deepEqual(await report.json(), { error: 'Invalid report responses' });
  }
});

test('classifies report-validation errors without message regex coupling', async () => {
  const serverSource = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(serverSource, /INVALID_REPORT_ERROR_PATTERNS|isInvalidReportError/);
});

test('leaves unexpected report bugs as generic 500 responses', async t => {
  const brokenSession = {
    ...session,
    id: {
      toString() {
        throw new Error('boom');
      }
    }
  };
  const address = await runningServer(t, { sessionData: brokenSession });

  const report = await fetch(`${address.url}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      responses: [{
        questionId: 'q-approved',
        decision: 'accept',
        answer: ''
      }]
    })
  });

  assert.equal(report.status, 500);
  assert.deepEqual(await report.json(), { error: 'Internal server error' });
});

test('rejects report generation while the agent review is running', async t => {
  const fakeService = createFakeReviewService(runningAgentReview);
  const address = await runningServer(t, { agentReviewService: fakeService });

  const report = await fetch(`${address.url}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ responses: [] })
  });

  assert.equal(report.status, 409);
  assert.deepEqual(await report.json(), { error: 'Agent review is still running' });
});

test('falls back to not-configured review state and preserves manual reports without a service', async t => {
  const address = await runningServer(t);

  const reviewState = await fetch(`${address.url}/api/agent-review`);
  assert.equal(reviewState.status, 200);
  assert.deepEqual(await reviewState.json(), notConfiguredReview);

  const run = await fetch(`${address.url}/api/agent-review`, { method: 'POST' });
  assert.equal(run.status, 409);
  assert.deepEqual(await run.json(), { error: 'Reviewer is not configured' });

  const report = await fetch(`${address.url}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      responses: [
        { questionId: 'q-approved', decision: 'accept', answer: '25 results is correct.' },
        { questionId: 'q-escalated', decision: 'correct', answer: 'Surface a typed search error.' }
      ],
      agentReview: approvedAgentReview
    })
  });
  assert.equal(report.status, 200);
  const markdown = (await report.json()).markdown;
  assert.match(markdown, /## Accepted Generated Behavior/);
  assert.doesNotMatch(markdown, /## Agent Review Audit/);
  assert.doesNotMatch(markdown, /Reviewer: server-provider \/ server-model/);
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
