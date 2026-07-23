import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentReviewService } from '../src/agent-review-service.mjs';

const reviewerInfo = { provider: 'openai-compatible', model: 'test-model' };

const session = {
  id: 'session-1',
  prompt: 'Check the search behavior.',
  questions: [{
    id: 'q-1',
    type: 'missing-step',
    severity: 'high',
    ask: 'Should description be searched?',
    reason: 'Only title is visible.',
    promptEvidence: 'title and description',
    docUnitIds: ['doc-1']
  }],
  docUnits: [{
    id: 'doc-1',
    file: 'search.js',
    lineStart: 4,
    text: 'Reads product.title.',
    code: 'product.title'
  }]
};

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createClock(values) {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? '2026-07-22T00:00:00.000Z';
}

function approvedReview(overrides = {}) {
  return {
    summary: 'Everything matches the prompt.',
    decisions: [{
      questionId: 'q-1',
      decision: 'accept',
      answer: '',
      rationale: 'The prompt explicitly asks for this behavior.',
      confidence: 0.9,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: ['doc-1'],
      ...overrides
    }],
    issues: []
  };
}

test('deduplicates concurrent runs and records an approved result', async () => {
  const review = createDeferred();
  let reviewerCalls = 0;
  const service = createAgentReviewService({
    session,
    reviewerInfo,
    clock: createClock(['2026-07-22T00:00:00.000Z', '2026-07-22T00:00:01.000Z']),
    reviewer: {
      review(input, { signal } = {}) {
        reviewerCalls += 1;
        assert.equal(input.questions.length, 1);
        assert.equal(typeof signal?.aborted, 'boolean');
        return review.promise;
      }
    }
  });

  const first = service.run();
  const second = service.run();

  assert.strictEqual(first, second);
  assert.equal(service.getState().status, 'running');
  assert.equal(reviewerCalls, 1);

  review.resolve(approvedReview());
  const state = await first;

  assert.equal(state.status, 'approved');
  assert.equal(state.startedAt, '2026-07-22T00:00:00.000Z');
  assert.equal(state.completedAt, '2026-07-22T00:00:01.000Z');
  assert.equal(state.results[0].status, 'approved');
});

test('rejects runs when no reviewer is configured', async () => {
  const service = createAgentReviewService({ session });

  assert.equal(service.getState().status, 'not-configured');
  await assert.rejects(service.run(), error => error?.code === 'reviewer-not-configured');
  assert.equal(service.getState().status, 'not-configured');
});

test('exposes configuration errors without rejecting run', async () => {
  const service = createAgentReviewService({
    session,
    reviewerInfo,
    configurationError: 'Set VLP_REVIEWER_API_KEY before running agent review.'
  });

  const initial = service.getState();
  assert.equal(initial.status, 'failed');
  assert.equal(initial.error.code, 'reviewer-configuration');
  assert.match(initial.error.message, /VLP_REVIEWER_API_KEY/);

  const result = await service.run();
  assert.equal(result.status, 'failed');
  assert.notStrictEqual(result, service.getState());
  result.error.message = 'changed';
  assert.match(service.getState().error.message, /VLP_REVIEWER_API_KEY/);
});

test('marks the review as needs-human when any result escalates', async () => {
  const service = createAgentReviewService({
    session,
    reviewerInfo,
    reviewer: {
      async review() {
        return approvedReview({ confidence: 0.79 });
      }
    }
  });

  const state = await service.run();
  assert.equal(state.status, 'needs-human');
  assert.equal(state.results[0].status, 'escalated');
  assert.deepEqual(state.results[0].escalationReasons, ['confidence-below-threshold']);
});

test('approves empty sessions without invoking the reviewer', async () => {
  let reviewerCalls = 0;
  const service = createAgentReviewService({
    session: { ...session, questions: [] },
    reviewerInfo,
    reviewer: {
      async review() {
        reviewerCalls += 1;
        return approvedReview();
      }
    }
  });

  const state = await service.run();
  assert.equal(state.status, 'approved');
  assert.equal(state.summary, 'No targeted mismatches were available for agent review.');
  assert.deepEqual(state.results, []);
  assert.equal(reviewerCalls, 0);
});

test('sanitizes provider failures and clears results', async () => {
  const service = createAgentReviewService({
    session,
    reviewerInfo,
    reviewer: {
      async review() {
        const error = new Error('authentication failed: api-secret');
        error.code = 'authentication-failed';
        throw error;
      }
    }
  });

  const state = await service.run();
  assert.equal(state.status, 'failed');
  assert.equal(state.error.code, 'authentication-failed');
  assert.equal(state.error.message, 'Reviewer request failed. Check provider configuration and retry.');
  assert.deepEqual(state.results, []);
  assert.doesNotMatch(JSON.stringify(state), /api-secret/);
});

test('aborts long-running reviews at the injected timeout', async () => {
  const service = createAgentReviewService({
    session,
    reviewerInfo,
    timeoutMs: 5,
    reviewer: {
      review(_input, { signal } = {}) {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('timed out api-secret');
            error.name = 'AbortError';
            error.code = 'review-timeout';
            reject(error);
          }, { once: true });
        });
      }
    }
  });

  const state = await service.run();
  assert.equal(state.status, 'failed');
  assert.equal(state.error.code, 'review-timeout');
  assert.equal(state.error.message, 'Reviewer request failed. Check provider configuration and retry.');
  assert.deepEqual(state.results, []);
  assert.doesNotMatch(JSON.stringify(state), /api-secret/);
});

test('re-runs atomically replace complete results and use the injected clock', async () => {
  const firstReview = createDeferred();
  const secondReview = createDeferred();
  let callIndex = 0;
  const service = createAgentReviewService({
    session,
    reviewerInfo,
    clock: createClock([
      '2026-07-22T00:00:00.000Z',
      '2026-07-22T00:00:01.000Z',
      '2026-07-22T00:00:02.000Z',
      '2026-07-22T00:00:03.000Z'
    ]),
    reviewer: {
      review() {
        callIndex += 1;
        return callIndex === 1 ? firstReview.promise : secondReview.promise;
      }
    }
  });

  firstReview.resolve(approvedReview({ rationale: 'First rationale.' }));
  const firstState = await service.run();
  assert.equal(firstState.results[0].rationale, 'First rationale.');
  assert.equal(firstState.startedAt, '2026-07-22T00:00:00.000Z');
  assert.equal(firstState.completedAt, '2026-07-22T00:00:01.000Z');

  const rerun = service.run();
  const during = service.getState();
  assert.equal(during.status, 'running');
  assert.equal(during.startedAt, '2026-07-22T00:00:02.000Z');
  assert.equal(during.results[0].rationale, 'First rationale.');

  secondReview.resolve(approvedReview({
    decision: 'correct',
    answer: 'Search title and description.',
    rationale: 'Second rationale.'
  }));
  const secondState = await rerun;

  assert.equal(secondState.status, 'approved');
  assert.equal(secondState.completedAt, '2026-07-22T00:00:03.000Z');
  assert.equal(secondState.results[0].rationale, 'Second rationale.');
  assert.equal(secondState.results[0].effectiveDecision, 'correct');
});

test('returns defensive snapshots from getState', async () => {
  const service = createAgentReviewService({
    session,
    reviewerInfo,
    reviewer: {
      async review() {
        return approvedReview();
      }
    }
  });

  await service.run();
  const snapshot = service.getState();
  snapshot.status = 'failed';
  snapshot.results[0].rationale = 'mutated';
  snapshot.results[0].evidenceDocUnitIds.push('doc-2');

  const fresh = service.getState();
  assert.equal(fresh.status, 'approved');
  assert.equal(fresh.results[0].rationale, 'The prompt explicitly asks for this behavior.');
  assert.deepEqual(fresh.results[0].evidenceDocUnitIds, ['doc-1']);
});
