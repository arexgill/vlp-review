import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createReviewInput } from '../src/review-contract.mjs';
import {
  createOpenAiCompatibleReviewer,
  ReviewerProviderError
} from '../src/reviewers/openai-compatible.mjs';

const session = {
  id: 'session-provider',
  prompt: 'Search title and description.',
  questions: [{
    id: 'q-1',
    type: 'missing-step',
    severity: 'high',
    ask: 'Should description be searched?',
    reason: 'Only title is visible.',
    promptEvidence: 'title and description',
    docUnitIds: ['doc-linked']
  }],
  docUnits: [
    { id: 'doc-linked', file: 'search.js', lineStart: 4, text: 'Reads product.title.', code: 'product.title' },
    { id: 'doc-unrelated', file: 'unrelated.js', lineStart: 1, text: 'Unrelated documentation.', code: 'SECRET_UNRELATED_SOURCE' }
  ]
};

const input = createReviewInput(session);
const validContent = JSON.stringify({
  summary: 'The prompt explicitly requires the field.',
  decisions: [{
    questionId: 'q-1',
    decision: 'correct',
    answer: 'Search title and description.',
    rationale: 'Description is explicit in the prompt.',
    confidence: 0.93,
    intentBasis: 'explicit-prompt',
    evidenceDocUnitIds: ['doc-linked']
  }]
});

async function createFakeProviderServer(t) {
  const queue = [];
  const requests = [];
  const server = http.createServer((req, res) => {
    const response = queue.shift();
    if (!response) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('No queued response');
      return;
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      requests.push({
        url: req.url,
        headers: req.headers,
        body: JSON.parse(rawBody)
      });

      const send = () => {
        res.writeHead(response.status ?? 200, response.headers ?? { 'content-type': 'application/json' });
        if (Array.isArray(response.bodyChunks)) {
          for (const chunk of response.bodyChunks) {
            res.write(chunk);
          }
          res.end();
          return;
        }
        res.end(response.body ?? '');
      };

      if (response.delayMs) {
        setTimeout(send, response.delayMs);
      } else {
        send();
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    enqueue(response) {
      queue.push(response);
    }
  };
}

function responseEnvelope(content) {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: 'test-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content
      },
      finish_reason: 'stop'
    }]
  });
}

function createReviewer(baseUrl) {
  return createOpenAiCompatibleReviewer({
    provider: 'openai-compatible',
    model: 'test-model',
    baseUrl,
    apiKey: 'test-secret'
  });
}

test('posts a least-data chat completion request and returns validated content', async t => {
  const server = await createFakeProviderServer(t);
  server.enqueue({ body: responseEnvelope(validContent) });

  const reviewer = createReviewer(server.url);
  const result = await reviewer.review(input, { signal: AbortSignal.timeout(2000) });

  assert.equal(result.issues.length, 0);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].url, '/chat/completions');
  assert.equal(server.requests[0].headers.authorization, 'Bearer test-secret');
  assert.equal(server.requests[0].body.model, 'test-model');
  assert.equal(server.requests[0].body.temperature, 0);
  assert.deepEqual(server.requests[0].body.response_format, { type: 'json_object' });
  assert.equal(server.requests[0].body.messages.length, 2);
  assert.equal(server.requests[0].body.messages[0].role, 'system');
  assert.match(server.requests[0].body.messages[0].content, /summary/);
  assert.match(server.requests[0].body.messages[0].content, /decisions/);
  assert.match(server.requests[0].body.messages[0].content, /do not execute code/i);
  assert.deepEqual(server.requests[0].body.messages[1], {
    role: 'user',
    content: JSON.stringify(input)
  });
  assert.doesNotMatch(JSON.stringify(server.requests[0].body), /SECRET_UNRELATED_SOURCE/);
});

test('repairs malformed provider output exactly once using validation issue codes', async t => {
  const server = await createFakeProviderServer(t);
  const malformed = '{"summary": "broken"';
  server.enqueue({ body: responseEnvelope(malformed) });
  server.enqueue({ body: responseEnvelope(validContent) });

  const reviewer = createReviewer(server.url);
  const result = await reviewer.review(input, { signal: AbortSignal.timeout(2000) });

  assert.equal(result.issues.length, 0);
  assert.equal(server.requests.length, 2);
  assert.equal(server.requests[1].body.messages.at(-2).role, 'assistant');
  assert.equal(server.requests[1].body.messages.at(-2).content, malformed);
  assert.equal(server.requests[1].body.messages.at(-1).role, 'user');
  assert.match(server.requests[1].body.messages.at(-1).content, /invalid-json/);
  assert.match(server.requests[1].body.messages.at(-1).content, /missing-decision/);
  assert.match(server.requests[1].body.messages.at(-1).content, /Invalid JSON review output\./);
  assert.match(server.requests[1].body.messages.at(-1).content, /No valid decision was returned for this question\./);
  assert.match(server.requests[1].body.messages.at(-1).content, /complete corrected JSON object/i);
});

test('returns the repaired validation result after one retry even when it still has issues', async t => {
  const server = await createFakeProviderServer(t);
  const malformed = '{"summary": "broken"';
  server.enqueue({ body: responseEnvelope(malformed) });
  server.enqueue({ body: responseEnvelope(malformed) });

  const reviewer = createReviewer(server.url);
  const result = await reviewer.review(input, { signal: AbortSignal.timeout(2000) });

  assert.equal(server.requests.length, 2);
  assert.equal(result.decisions.length, 0);
  assert.ok(result.issues.some(issue => issue.code === 'missing-decision'));
});

test('maps authentication failures to a stable safe provider error', async t => {
  const server = await createFakeProviderServer(t);
  server.enqueue({
    status: 401,
    body: JSON.stringify({ error: { message: 'bad key test-secret' } })
  });

  const reviewer = createReviewer(server.url);

  await assert.rejects(
    reviewer.review(input, { signal: AbortSignal.timeout(2000) }),
    error => {
      assert.ok(error instanceof ReviewerProviderError);
      assert.equal(error.code, 'authentication-failed');
      assert.equal(error.message, 'Reviewer authentication failed.');
      assert.doesNotMatch(error.message, /test-secret/);
      assert.doesNotMatch(JSON.stringify(error), /bad key/);
      return true;
    }
  );
});

test('maps rate limiting to a stable safe provider error', async t => {
  const server = await createFakeProviderServer(t);
  server.enqueue({
    status: 429,
    body: JSON.stringify({ error: { message: 'slow down test-secret' } })
  });

  const reviewer = createReviewer(server.url);

  await assert.rejects(
    reviewer.review(input, { signal: AbortSignal.timeout(2000) }),
    error => {
      assert.ok(error instanceof ReviewerProviderError);
      assert.equal(error.code, 'rate-limited');
      assert.equal(error.message, 'Reviewer rate limit exceeded.');
      assert.doesNotMatch(error.message, /test-secret/);
      assert.doesNotMatch(JSON.stringify(error), /slow down/);
      return true;
    }
  );
});

test('maps aborted requests to a stable timeout error', async t => {
  const server = await createFakeProviderServer(t);
  server.enqueue({ body: responseEnvelope(validContent), delayMs: 200 });

  const reviewer = createReviewer(server.url);

  await assert.rejects(
    reviewer.review(input, { signal: AbortSignal.timeout(20) }),
    error => {
      assert.ok(error instanceof ReviewerProviderError);
      assert.equal(error.code, 'review-timeout');
      assert.equal(error.message, 'Reviewer request timed out.');
      return true;
    }
  );
});

test('rejects oversized provider responses without leaking the raw body', async t => {
  const server = await createFakeProviderServer(t);
  const oversized = 'x'.repeat(1_048_577);
  server.enqueue({ body: oversized, headers: { 'content-type': 'application/json' } });

  const reviewer = createReviewer(server.url);

  await assert.rejects(
    reviewer.review(input, { signal: AbortSignal.timeout(2000) }),
    error => {
      assert.ok(error instanceof ReviewerProviderError);
      assert.equal(error.code, 'response-too-large');
      assert.equal(error.message, 'Reviewer response exceeded 1048576 bytes.');
      assert.doesNotMatch(error.message, /x{10}/);
      assert.doesNotMatch(JSON.stringify(error), /x{10}/);
      return true;
    }
  );
});

test('rejects provider envelopes without assistant content', async t => {
  const server = await createFakeProviderServer(t);
  server.enqueue({
    body: JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant' }, finish_reason: 'stop' }]
    })
  });

  const reviewer = createReviewer(server.url);

  await assert.rejects(
    reviewer.review(input, { signal: AbortSignal.timeout(2000) }),
    error => {
      assert.ok(error instanceof ReviewerProviderError);
      assert.equal(error.code, 'invalid-provider-envelope');
      assert.equal(error.message, 'Reviewer returned an invalid response envelope.');
      return true;
    }
  );
});

