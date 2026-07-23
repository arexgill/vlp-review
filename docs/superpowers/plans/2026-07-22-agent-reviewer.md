# Agent Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pluggable OpenAI-compatible reviewer agent that can approve grounded VLP decisions automatically, deterministically escalate uncertain decisions, and produce an auditable repair report without changing source files.

**Architecture:** Keep the existing heuristic question generator, then build a least-data review payload containing the prompt and linked evidence only. An OpenAI-compatible adapter obtains structured proposals, a local policy converts them to approved or escalated results, and an in-memory review service supplies the HTTP API, report generator, CLI auto-review path, and browser UI. Manual mode remains unchanged when no reviewer is configured.

**Tech Stack:** Node.js 20+ ESM, built-in `fetch`/HTTP/test runner, dependency-free browser JavaScript, existing `@babel/parser`; no new runtime dependencies.

## Global Constraints

- Work on `feature/agent-reviewer`, based on `main`.
- Keep Node.js `>=20` and add no dependencies.
- Never execute reviewed source or let the reviewer modify files.
- Send only the full original prompt, targeted questions, and linked documentation/code excerpts; never send complete source files or unrelated documentation.
- Read credentials only from `VLP_REVIEWER_API_KEY`; never accept or expose an API key through CLI flags, browser JSON, reports, logs, errors, or snapshots.
- Require HTTPS reviewer URLs except exact loopback hosts `localhost`, `127.0.0.1`, and `::1`, where HTTP is allowed.
- Use policy threshold `0.80`, request timeout `60_000` ms, response limit `1 MiB`, and at most one malformed-output repair request.
- Agent `accept`/`correct` decisions require `intentBasis: "explicit-prompt"`; low-confidence, invalid, missing, inferred, or absent intent must escalate according to the spec.
- Treat model output as untrusted text and render it only with `textContent`.
- Preserve the existing manual workflow when `--reviewer` is absent.
- Do not call a real model endpoint from tests.

---

### Task 1: Reviewer CLI Configuration

**Files:**
- Create: `src/reviewer-config.mjs`
- Modify: `src/parse-args.mjs`
- Test: `test/reviewer-config.test.mjs`
- Test: `test/parse-args.test.mjs`

**Interfaces:**
- Produces: `normalizeReviewerBaseUrl(value) -> string`
- Produces: `createReviewerConfig(options, env?) -> null | { provider, model, baseUrl, apiKey }`
- Produces: parsed options `reviewer`, `reviewerModel`, `reviewerBaseUrl`, and `autoReview` for later CLI wiring.

- [ ] **Step 1: Write failing reviewer configuration tests**

Create `test/reviewer-config.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReviewerConfig,
  normalizeReviewerBaseUrl
} from '../src/reviewer-config.mjs';

const baseOptions = {
  reviewer: 'openai-compatible',
  reviewerModel: 'review-model',
  reviewerBaseUrl: 'https://api.example.test/v1'
};

test('creates reviewer config and reads the key only from the environment', () => {
  assert.deepEqual(createReviewerConfig(baseOptions, { VLP_REVIEWER_API_KEY: ' secret ' }), {
    provider: 'openai-compatible',
    model: 'review-model',
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret'
  });
  assert.equal(createReviewerConfig({ ...baseOptions, reviewer: null }), null);
});

test('allows HTTPS and exact HTTP loopback URLs while removing trailing slashes', () => {
  assert.equal(normalizeReviewerBaseUrl('https://api.example.test/v1/'), 'https://api.example.test/v1');
  assert.equal(normalizeReviewerBaseUrl('http://localhost:9000/v1/'), 'http://localhost:9000/v1');
  assert.equal(normalizeReviewerBaseUrl('http://127.0.0.1:9000/v1'), 'http://127.0.0.1:9000/v1');
  assert.equal(normalizeReviewerBaseUrl('http://[::1]:9000/v1'), 'http://[::1]:9000/v1');
});

test('rejects unsafe, credential-bearing, and ambiguous reviewer URLs', () => {
  for (const value of [
    'http://api.example.test/v1',
    'ftp://localhost/v1',
    'https://user:pass@example.test/v1',
    'https://example.test/v1?token=x',
    'https://example.test/v1#fragment',
    'not-a-url'
  ]) {
    assert.throws(() => normalizeReviewerBaseUrl(value), /reviewer base URL/i, value);
  }
});

test('keeps a missing key as null so the local server can show setup guidance', () => {
  assert.equal(createReviewerConfig(baseOptions, {}).apiKey, null);
});
```

Extend `test/parse-args.test.mjs` with assertions that:

```js
const parsed = parseArgs([
  '--prompt', 'prompt.md', '--code', 'src',
  '--reviewer', 'openai-compatible',
  '--reviewer-model', 'review-model',
  '--reviewer-base-url', 'http://localhost:9000/v1',
  '--auto-review', '--no-open'
]);
assert.equal(parsed.reviewer, 'openai-compatible');
assert.equal(parsed.reviewerModel, 'review-model');
assert.equal(parsed.reviewerBaseUrl, 'http://localhost:9000/v1');
assert.equal(parsed.autoReview, true);

assert.throws(
  () => parseArgs(['--prompt', 'p', '--code', 'c', '--auto-review']),
  /--auto-review requires --reviewer/
);
assert.throws(
  () => parseArgs(['--prompt', 'p', '--code', 'c', '--reviewer', 'openai-compatible']),
  /--reviewer-model is required/
);
assert.throws(
  () => parseArgs(['--prompt', 'p', '--code', 'c', '--reviewer-model', 'm']),
  /--reviewer-model requires --reviewer/
);
assert.throws(
  () => parseArgs(['--prompt', 'p', '--code', 'c', '--reviewer', 'other', '--reviewer-model', 'm']),
  /Unsupported reviewer/
);
```

Update old deep-equality expectations to include:

```js
reviewer: null,
reviewerModel: null,
reviewerBaseUrl: 'https://api.openai.com/v1',
autoReview: false
```

- [ ] **Step 2: Run the focused tests and confirm the RED state**

Run:

```bash
node --test test/reviewer-config.test.mjs test/parse-args.test.mjs
```

Expected: FAIL because `src/reviewer-config.mjs` does not exist and the parser does not recognize reviewer flags.

- [ ] **Step 3: Implement URL/config validation and CLI parsing**

Create `src/reviewer-config.mjs` with these exact rules:

```js
export const DEFAULT_REVIEWER_BASE_URL = 'https://api.openai.com/v1';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function normalizeReviewerBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error('Reviewer base URL must be a valid HTTP or HTTPS URL');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK.has(hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('Reviewer base URL must use HTTPS unless it targets exact loopback');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Reviewer base URL cannot contain credentials, query parameters, or fragments');
  }
  return url.toString().replace(/\/$/, '');
}

export function createReviewerConfig(options, env = process.env) {
  if (!options.reviewer) return null;
  return {
    provider: options.reviewer,
    model: options.reviewerModel,
    baseUrl: normalizeReviewerBaseUrl(options.reviewerBaseUrl),
    apiKey: String(env.VLP_REVIEWER_API_KEY || '').trim() || null
  };
}
```

Modify `src/parse-args.mjs` so defaults include the four properties above, boolean handling recognizes `--auto-review`, value handling recognizes `--reviewer`, `--reviewer-model`, and `--reviewer-base-url`, and post-parse validation runs only when `result.help` is false and enforces:

```js
if (result.reviewer && result.reviewer !== 'openai-compatible') {
  throw new Error(`Unsupported reviewer: ${result.reviewer}`);
}
if (result.reviewer && !result.reviewerModel) {
  throw new Error('--reviewer-model is required when --reviewer is configured');
}
if (!result.reviewer && result.reviewerModel) {
  throw new Error('--reviewer-model requires --reviewer');
}
if (!result.reviewer && result.reviewerBaseUrl !== DEFAULT_REVIEWER_BASE_URL) {
  throw new Error('--reviewer-base-url requires --reviewer');
}
if (result.autoReview && !result.reviewer) {
  throw new Error('--auto-review requires --reviewer');
}
```

Import `DEFAULT_REVIEWER_BASE_URL` and `normalizeReviewerBaseUrl`; normalize a supplied base URL before returning. Expand `usage()` with the new options and `VLP_REVIEWER_API_KEY` environment variable.

- [ ] **Step 4: Run focused tests and the full suite**

Run:

```bash
node --test test/reviewer-config.test.mjs test/parse-args.test.mjs
npm test
```

Expected: focused tests PASS; full suite PASS with zero failures.

- [ ] **Step 5: Commit reviewer configuration**

```bash
git add src/reviewer-config.mjs src/parse-args.mjs test/reviewer-config.test.mjs test/parse-args.test.mjs
git commit -m "feat: add reviewer CLI configuration"
```

---

### Task 2: Least-Data Review Contract and Output Validation

**Files:**
- Create: `src/review-contract.mjs`
- Test: `test/review-contract.test.mjs`

**Interfaces:**
- Consumes: existing session shape from `createSession()`.
- Produces: `createReviewInput(session) -> { sessionId, prompt, questions }`.
- Produces: `validateReviewContent(content, input) -> { summary, decisions, issues }`.
- Produces issue objects `{ questionId, code, message }` used by provider repair and policy tasks.

- [ ] **Step 1: Write failing contract tests**

Create `test/review-contract.test.mjs` with this fixture and imports:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewInput, validateReviewContent } from '../src/review-contract.mjs';

const session = {
  id: 'session-contract',
  prompt: 'Search title and description.',
  sources: [
    { path: 'search.js', content: 'product.title' },
    { path: 'unrelated.js', content: 'SECRET_UNRELATED_SOURCE' }
  ],
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
assert.equal(input.sessionId, 'session-contract');
assert.equal(input.prompt, 'Search title and description.');
assert.equal(input.questions.length, 1);
assert.deepEqual(input.questions[0].evidence, [{
  docUnitId: 'doc-linked',
  file: 'search.js',
  lineStart: 4,
  documentation: 'Reads product.title.',
  code: 'product.title'
}]);
assert.doesNotMatch(JSON.stringify(input), /SECRET_UNRELATED_SOURCE/);
assert.doesNotMatch(JSON.stringify(input), /Unrelated documentation/);
```

Add valid output coverage:

```js
const valid = validateReviewContent(JSON.stringify({
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
}), input);
assert.equal(valid.issues.length, 0);
assert.equal(valid.decisions[0].questionId, 'q-1');
```

Add table-driven invalid cases for malformed JSON, unknown/duplicate question IDs, confidence `-0.1` and `1.1`, unknown decisions and intent bases, unknown evidence IDs, empty correction answers, non-array decisions, and strings longer than 4,000 characters. Assert invalid decisions never appear in `decisions`, duplicate entries invalidate all entries for that question, and each expected question without a valid entry receives `missing-decision`.

- [ ] **Step 2: Run the contract test and confirm RED**

Run:

```bash
node --test test/review-contract.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/review-contract.mjs`.

- [ ] **Step 3: Implement the review contract**

Create `src/review-contract.mjs` with:

```js
const DECISIONS = new Set(['accept', 'correct', 'irrelevant', 'escalate']);
const INTENT_BASES = new Set(['explicit-prompt', 'inferred', 'absent']);
const MAX_TEXT = 4000;

function clean(value) {
  return String(value ?? '').replaceAll('\0', '').replace(/\r\n?/g, '\n').trim();
}

export function createReviewInput(session) {
  const units = new Map((session.docUnits || []).map(unit => [unit.id, unit]));
  return {
    sessionId: clean(session.id),
    prompt: clean(session.prompt),
    questions: (session.questions || []).map(question => ({
      id: clean(question.id),
      type: clean(question.type),
      severity: clean(question.severity),
      ask: clean(question.ask),
      reason: clean(question.reason),
      promptEvidence: clean(question.promptEvidence),
      evidence: (question.docUnitIds || []).flatMap(id => {
        const unit = units.get(id);
        return unit ? [{
          docUnitId: clean(unit.id),
          file: clean(unit.file),
          lineStart: Number(unit.lineStart) || 1,
          documentation: clean(unit.text),
          code: clean(unit.code)
        }] : [];
      })
    }))
  };
}
```

Implement `validateReviewContent` as a total function that never throws for model content:

1. Parse only string content as a JSON object; otherwise return `invalid-json` plus `missing-decision` for every input question.
2. Validate summary and every text field at `<= 4000` characters.
3. Group array entries by `questionId`; duplicates add `duplicate-question` and none are retained.
4. Validate decision/intent enums, confidence as finite `0..1`, correction answer, and evidence IDs as a subset of that question's linked evidence.
5. Retain only fully valid normalized entries.
6. Add one `missing-decision` issue per expected question without a retained entry.
7. Return `{ summary, decisions, issues }` where all issue messages are safe and contain no raw response body.

- [ ] **Step 4: Run focused tests and full suite**

Run:

```bash
node --test test/review-contract.test.mjs
npm test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 5: Commit the review contract**

```bash
git add src/review-contract.mjs test/review-contract.test.mjs
git commit -m "feat: define agent review contract"
```

---

### Task 3: OpenAI-Compatible Provider and Registry

**Files:**
- Create: `src/reviewers/openai-compatible.mjs`
- Create: `src/reviewers/index.mjs`
- Test: `test/openai-compatible.test.mjs`
- Test: `test/reviewer-registry.test.mjs`

**Interfaces:**
- Consumes: reviewer config from Task 1 and `validateReviewContent(content, input)` from Task 2.
- Produces: `createOpenAiCompatibleReviewer(config, deps?) -> { id, model, review(input, { signal }) }`.
- Produces: `createReviewer(config, deps?)` registry entry point used by the CLI.
- `review()` resolves to `{ summary, decisions, issues }` after zero or one repair call.

- [ ] **Step 1: Write failing provider tests with a fake local endpoint**

Create `test/openai-compatible.test.mjs`. Start a built-in `http.createServer` on `127.0.0.1`, capture requests, and return queued chat-completion envelopes. Cover:

```js
const reviewer = createOpenAiCompatibleReviewer({
  provider: 'openai-compatible',
  model: 'test-model',
  baseUrl: address.url,
  apiKey: 'test-secret'
});
const result = await reviewer.review(input, { signal: AbortSignal.timeout(2000) });
assert.equal(result.issues.length, 0);
assert.equal(requests[0].url, '/chat/completions');
assert.equal(requests[0].headers.authorization, 'Bearer test-secret');
assert.equal(requests[0].body.model, 'test-model');
assert.equal(requests[0].body.temperature, 0);
assert.deepEqual(requests[0].body.response_format, { type: 'json_object' });
assert.doesNotMatch(JSON.stringify(requests[0].body), /SECRET_UNRELATED_SOURCE/);
```

Queue malformed content followed by valid content and assert exactly two requests, with the second containing an assistant copy of the malformed content and a user repair instruction listing validation issue codes. Queue malformed content twice and assert the second validation result contains no decisions and contains `missing-decision`. Also test HTTP `401`, HTTP `429`, abort, a response above `1_048_576` bytes, and a chat envelope without `choices[0].message.content`; assert errors use stable codes/messages and never contain `test-secret` or the raw body.

Create `test/reviewer-registry.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewer } from '../src/reviewers/index.mjs';

const validConfig = {
  provider: 'openai-compatible',
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:9000/v1',
  apiKey: 'test-key'
};

assert.equal(createReviewer(validConfig).id, 'openai-compatible');
assert.throws(
  () => createReviewer({ ...validConfig, provider: 'unknown' }),
  /Unsupported reviewer provider/
);
```

- [ ] **Step 2: Run provider tests and confirm RED**

Run:

```bash
node --test test/openai-compatible.test.mjs test/reviewer-registry.test.mjs
```

Expected: FAIL because provider modules do not exist.

- [ ] **Step 3: Implement the OpenAI-compatible adapter**

Create `src/reviewers/openai-compatible.mjs` with exported error and factory:

```js
import { validateReviewContent } from '../review-contract.mjs';

const RESPONSE_LIMIT = 1024 * 1024;

export class ReviewerProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReviewerProviderError';
    this.code = code;
  }
}
```

Define the factory as:

```js
export function createOpenAiCompatibleReviewer(
  config,
  { fetchImpl = globalThis.fetch } = {}
) {
  // The private operations below close over config and fetchImpl.
}
```

Implement these private operations inside or beside the factory:

- `initialMessages(input)`: one system message requiring the exact JSON schema and no code execution/tool use, plus one user message containing `JSON.stringify(input)`.
- `repairMessages(messages, content, issues)`: append the prior assistant content and a user message containing only issue codes/messages and an instruction to return a complete corrected JSON object.
- `readBoundedText(response)`: stream `response.body` with a reader, count bytes, cancel and throw `response-too-large` above `RESPONSE_LIMIT`, then UTF-8 decode.
- `requestCompletion(messages, signal)`: POST `${baseUrl}/chat/completions` with bearer authorization, model, `temperature: 0`, `response_format: { type: 'json_object' }`, and messages. Map `401/403` to `authentication-failed`, `429` to `rate-limited`, other non-2xx responses to `provider-http-error`, abort to `review-timeout`, malformed envelopes to `invalid-provider-envelope`, and never include raw body/key in messages.
- `review(input, { signal })`: request once, validate; if issues exist, request once more with repair messages and return the second validation result; otherwise return the first.

The returned public object must be:

```js
Object.freeze({
  id: 'openai-compatible',
  model: config.model,
  review
});
```

- [ ] **Step 4: Implement the provider registry**

Create `src/reviewers/index.mjs`:

```js
import { createOpenAiCompatibleReviewer } from './openai-compatible.mjs';

export function createReviewer(config, dependencies) {
  if (config.provider === 'openai-compatible') {
    return createOpenAiCompatibleReviewer(config, dependencies);
  }
  throw new Error(`Unsupported reviewer provider: ${config.provider}`);
}
```

- [ ] **Step 5: Run focused tests and full suite**

Run:

```bash
node --test test/openai-compatible.test.mjs test/reviewer-registry.test.mjs
npm test
```

Expected: all tests PASS; the fake server receives one valid request and two requests only for repair cases.

- [ ] **Step 6: Commit provider support**

```bash
git add src/reviewers/openai-compatible.mjs src/reviewers/index.mjs test/openai-compatible.test.mjs test/reviewer-registry.test.mjs
git commit -m "feat: add OpenAI-compatible reviewer"
```

---

### Task 4: Deterministic Policy and In-Memory Review Service

**Files:**
- Create: `src/review-policy.mjs`
- Create: `src/agent-review-service.mjs`
- Test: `test/review-policy.test.mjs`
- Test: `test/agent-review-service.test.mjs`

**Interfaces:**
- Consumes: provider result `{ summary, decisions, issues }` and session questions.
- Produces: `applyReviewPolicy(session, providerReview, { threshold? }) -> AgentPolicyResult[]`.
- Produces: `createAgentReviewService(options) -> { getState, run }`.
- `getState()` returns a defensive sanitized snapshot; `run()` deduplicates concurrent calls.

- [ ] **Step 1: Write failing policy tests**

Create `test/review-policy.test.mjs` with this fixture/helper:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReviewPolicy } from '../src/review-policy.mjs';

const session = { questions: [{ id: 'q-1' }] };
const baseDecision = {
  questionId: 'q-1',
  decision: 'accept',
  answer: '',
  rationale: 'The prompt explicitly asks for this behavior.',
  confidence: 0.9,
  intentBasis: 'explicit-prompt',
  evidenceDocUnitIds: []
};
function resultFor(overrides = {}, issues = []) {
  return applyReviewPolicy(session, {
    summary: '',
    decisions: [{ ...baseDecision, ...overrides }],
    issues
  })[0];
}

assert.equal(resultFor({ confidence: 0.80 }).status, 'approved');
assert.equal(resultFor({ confidence: 0.79 }).status, 'escalated');
assert.deepEqual(resultFor({ confidence: 0.79 }).escalationReasons, ['confidence-below-threshold']);
assert.equal(resultFor({ decision: 'accept', intentBasis: 'inferred' }).status, 'escalated');
assert.equal(resultFor({ decision: 'correct', intentBasis: 'absent' }).status, 'escalated');
assert.equal(resultFor({ decision: 'irrelevant', intentBasis: 'inferred' }).status, 'approved');
assert.equal(resultFor({ decision: 'escalate' }).effectiveDecision, null);
```

Also assert omitted decisions and matching validation issues escalate with stable reasons, approved entries preserve rationale/evidence, and `effectiveDecision` is non-null only for approved results.

- [ ] **Step 2: Write failing service tests**

Create `test/agent-review-service.test.mjs` with a deferred fake reviewer. Cover:

```js
const first = service.run();
const second = service.run();
assert.strictEqual(first, second);
assert.equal(service.getState().status, 'running');
assert.equal(reviewerCalls, 1);
resolveReview(validProviderReview);
assert.equal((await first).status, 'approved');
```

Add tests for:

- no reviewer -> `not-configured` and `run()` rejects with `reviewer-not-configured`;
- configuration error -> initial `failed` state with safe setup message;
- one escalation -> `needs-human`;
- zero questions -> `approved` without invoking provider;
- provider rejection -> `failed`, no results, no leaked `api-secret` text;
- timeout aborts at an injected short timeout;
- rerun replaces complete results atomically and timestamps use an injected clock;
- mutating a `getState()` result cannot mutate service state.

- [ ] **Step 3: Run policy/service tests and confirm RED**

Run:

```bash
node --test test/review-policy.test.mjs test/agent-review-service.test.mjs
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement deterministic policy**

Create `src/review-policy.mjs`:

```js
export const REVIEW_THRESHOLD = 0.8;

export function applyReviewPolicy(session, providerReview, { threshold = REVIEW_THRESHOLD } = {}) {
  const decisions = new Map(providerReview.decisions.map(item => [item.questionId, item]));
  const issuesByQuestion = new Map();
  for (const issue of providerReview.issues || []) {
    if (!issue.questionId) continue;
    const list = issuesByQuestion.get(issue.questionId) || [];
    list.push(issue.code);
    issuesByQuestion.set(issue.questionId, list);
  }

  return (session.questions || []).map(question => {
    const proposal = decisions.get(question.id);
    const reasons = [...new Set(issuesByQuestion.get(question.id) || [])];
    if (!proposal) reasons.push('missing-provider-decision');
    if (proposal?.decision === 'escalate') reasons.push('provider-requested-escalation');
    if (proposal && proposal.confidence < threshold) reasons.push('confidence-below-threshold');
    if (proposal && ['accept', 'correct'].includes(proposal.decision) && proposal.intentBasis !== 'explicit-prompt') {
      reasons.push('intent-not-explicit');
    }
    if (proposal?.decision === 'correct' && !proposal.answer.trim()) reasons.push('empty-correction');
    const escalationReasons = [...new Set(reasons)];
    const approved = proposal && escalationReasons.length === 0;
    return {
      questionId: question.id,
      status: approved ? 'approved' : 'escalated',
      proposedDecision: proposal?.decision || null,
      effectiveDecision: approved ? proposal.decision : null,
      confidence: proposal?.confidence ?? null,
      rationale: proposal?.rationale || '',
      answer: proposal?.answer || '',
      intentBasis: proposal?.intentBasis || null,
      evidenceDocUnitIds: proposal?.evidenceDocUnitIds || [],
      escalationReasons
    };
  });
}
```

- [ ] **Step 5: Implement the review service**

Create `src/agent-review-service.mjs` with:

```js
import { createReviewInput } from './review-contract.mjs';
import { applyReviewPolicy, REVIEW_THRESHOLD } from './review-policy.mjs';

export function createAgentReviewService({
  session,
  reviewer = null,
  reviewerInfo = null,
  configurationError = null,
  clock = () => new Date().toISOString(),
  timeoutMs = 60_000
}) {
  // private state and inFlight live only in this closure
}
```

Implement exact state transitions:

- initial `not-configured` without `reviewerInfo`;
- initial `failed` with provider/model and `error.code = 'reviewer-configuration'` when `configurationError` exists;
- otherwise initial `ready` with provider/model and threshold `REVIEW_THRESHOLD`;
- `run()` is a non-`async` function so concurrent callers receive the same promise object;
- when `configurationError` exists, `run()` resolves to a defensive copy of the existing failed state so `--auto-review` still leaves the local server available with setup guidance;
- without a reviewer or configuration error, `run()` rejects with an error whose code is `reviewer-not-configured`;
- zero questions transitions directly to `approved` with summary `No targeted mismatches were available for agent review.`;
- normal run records `startedAt`, starts `AbortController`, aborts after `timeoutMs`, calls `reviewer.review(createReviewInput(session), { signal })`, applies policy, then atomically assigns status `approved` or `needs-human`, complete results, summary, and `completedAt`;
- caught provider errors assign `failed`, empty results, a stable code, and sanitized message `Reviewer request failed. Check provider configuration and retry.`;
- `finally` clears timeout and `inFlight`;
- `getState()` returns `structuredClone(state)` so browser/server callers cannot mutate internal state.

- [ ] **Step 6: Run focused tests and full suite**

Run:

```bash
node --test test/review-policy.test.mjs test/agent-review-service.test.mjs
npm test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 7: Commit policy and service**

```bash
git add src/review-policy.mjs src/agent-review-service.mjs test/review-policy.test.mjs test/agent-review-service.test.mjs
git commit -m "feat: apply deterministic agent review policy"
```

---

### Task 5: Agent-Audited Markdown Reports

**Files:**
- Modify: `src/build-report.mjs`
- Modify: `test/build-report.test.mjs`

**Interfaces:**
- Changes: `buildReport(session, rawResponses?, options?)` where `options.agentReview` is the server-owned sanitized review state.
- Manual calls with two arguments keep existing output/validation.
- Agent mode accepts human responses only for `status: 'escalated'` results.

- [ ] **Step 1: Write failing agent-report tests**

Extend `test/build-report.test.mjs` with this server-owned fixture:

```js
const agentReview = {
  status: 'needs-human',
  provider: 'openai-compatible',
  model: 'review-model',
  threshold: 0.8,
  startedAt: '2026-07-22T10:00:00.000Z',
  completedAt: '2026-07-22T10:00:01.000Z',
  summary: 'Three grounded decisions and one escalation.',
  error: null,
  results: [
    {
      questionId: 'q-correct', status: 'approved', proposedDecision: 'correct', effectiveDecision: 'correct',
      answer: 'Search name, description, category, and tags.', rationale: 'Description is explicit.',
      confidence: 0.93, intentBasis: 'explicit-prompt', evidenceDocUnitIds: ['doc-1'], escalationReasons: []
    },
    {
      questionId: 'q-accept', status: 'approved', proposedDecision: 'accept', effectiveDecision: 'accept',
      answer: '25 results is correct.', rationale: 'The limit is explicitly accepted by the review prompt.',
      confidence: 0.9, intentBasis: 'explicit-prompt', evidenceDocUnitIds: ['doc-2'], escalationReasons: []
    },
    {
      questionId: 'q-ignore', status: 'approved', proposedDecision: 'irrelevant', effectiveDecision: 'irrelevant',
      answer: '', rationale: 'This heuristic does not affect the requirement.', confidence: 0.88,
      intentBasis: 'inferred', evidenceDocUnitIds: ['doc-3'], escalationReasons: []
    },
    {
      questionId: 'q-open', status: 'escalated', proposedDecision: 'correct', effectiveDecision: null,
      answer: 'Surface an error.', rationale: 'The prompt does not define the error type.', confidence: 0.76,
      intentBasis: 'inferred', evidenceDocUnitIds: [],
      escalationReasons: ['confidence-below-threshold', 'intent-not-explicit']
    }
  ]
};

const markdown = buildReport(session, [{
  questionId: 'q-open',
  decision: 'correct',
  answer: 'Surface a typed search error.'
}], { agentReview });

assert.match(markdown, /Reviewer: openai-compatible \/ review-model/);
assert.match(markdown, /Agent review status: Needs human review/);
assert.match(markdown, /Final validation status: Completed with human resolution/);
assert.match(markdown, /Policy threshold: 0\.80/);
assert.match(markdown, /Confidence: 93%/);
assert.match(markdown, /Intent basis: explicit-prompt/);
assert.match(markdown, /Description is explicit/);
assert.match(markdown, /Surface a typed search error/);
assert.match(markdown, /Update the generated code/);
```

Add tests that:

- unanswered escalation yields `Final validation status: Needs human review`;
- all automatic results yields `Agent approved`;
- failed reviewer yields `Reviewer failed` and no approval claim;
- ready state says agent review has not run;
- a browser response for an agent-approved question throws `cannot override agent-approved question`;
- a browser response for a non-escalated/unknown question is rejected;
- manual mode's existing report remains byte-for-byte unaffected for the same fixture.

- [ ] **Step 2: Run report tests and confirm RED**

Run:

```bash
node --test test/build-report.test.mjs
```

Expected: FAIL because the report ignores `options.agentReview`.

- [ ] **Step 3: Implement agent result merging and audit rendering**

Modify `src/build-report.mjs`:

```js
export function buildReport(session, rawResponses = [], { agentReview = null } = {}) {
  if (!agentReview || agentReview.status === 'not-configured') {
    return buildManualReport(session, rawResponses);
  }
  return buildAgentReport(session, rawResponses, agentReview);
}
```

Move the current body unchanged into `buildManualReport`. Implement `buildAgentReport` to:

1. Map results by question ID and validate that every human response targets an `escalated` result.
2. Convert approved agent results to effective response records using `effectiveDecision`/`answer`.
3. Use human responses only to resolve escalated results.
4. Derive agent review label from service status.
5. Derive final status: `Agent approved`; `Completed with human resolution` when every escalation is answered; `Needs human review` when any escalation remains or review is ready; `Reviewer failed` when failed.
6. Render `## Agent Review Audit` before resolved behavior sections, including provider/model, statuses, threshold, automatic/escalated counts, and per-question proposal, policy status, confidence, intent basis, rationale, escalation reasons, evidence, and optional human resolution.
7. Generate repair instructions only from effective automatic corrections and human corrections; generate preservation instructions from effective accepts.
8. Keep unresolved escalations under `## Unresolved Questions` and never write an agent-approved claim for failed/unrun/escalated states.
9. Continue sanitizing NULs, line endings, and absolute-path-free evidence through existing helpers.

- [ ] **Step 4: Run report tests and full suite**

Run:

```bash
node --test test/build-report.test.mjs
npm test
```

Expected: all tests PASS; existing manual report assertions still pass.

- [ ] **Step 5: Commit agent reporting**

```bash
git add src/build-report.mjs test/build-report.test.mjs
git commit -m "feat: add agent approval audit to reports"
```

---

### Task 6: Agent Review HTTP API and Server-Owned Decisions

**Files:**
- Modify: `src/server.mjs`
- Modify: `test/server.test.mjs`

**Interfaces:**
- Changes: `createVlpServer({ session, publicDir, agentReviewService? })`.
- Adds: `GET /api/agent-review` and `POST /api/agent-review`.
- Report endpoint reads `agentReviewService.getState()` server-side and passes it to `buildReport`; browser input cannot supply agent results.

- [ ] **Step 1: Write failing server API tests**

Extend the `runningServer` helper to accept `agentReviewService`. Use this fake in the new tests:

```js
function createFakeReviewService(initial, completed = initial) {
  let state = structuredClone(initial);
  let runCalls = 0;
  return {
    get runCalls() { return runCalls; },
    getState() { return structuredClone(state); },
    async run() {
      runCalls += 1;
      state = structuredClone(completed);
      return structuredClone(state);
    }
  };
}

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
```

Add tests that:

- a report request while state is `running` returns `409`;
- a forged `agentReview` property in POST body is ignored;
- report content uses the fake service's server-owned provider/model/results;
- agent-approved questions cannot be overridden through report responses;
- without a service, GET returns `not-configured`, POST returns `409`, and manual report behavior remains unchanged;
- existing malformed/body-limit/content-type/static/security tests still pass.

- [ ] **Step 2: Run server tests and confirm RED**

Run:

```bash
node --test test/server.test.mjs
```

Expected: FAIL with `404` for `/api/agent-review` and no agent report state.

- [ ] **Step 3: Implement the server-owned agent API**

Modify `src/server.mjs` by adding a frozen fallback service:

```js
const NOT_CONFIGURED_REVIEW = Object.freeze({
  status: 'not-configured',
  provider: null,
  model: null,
  threshold: 0.8,
  startedAt: null,
  completedAt: null,
  summary: '',
  results: [],
  error: null
});
```

In `createVlpServer({ session, publicDir, agentReviewService = null })`:

- Route `/api/agent-review` before static serving.
- GET returns `agentReviewService?.getState() || NOT_CONFIGURED_REVIEW`.
- POST returns `409 { error: 'Reviewer is not configured' }` without a service; otherwise await `agentReviewService.run()` and return its sanitized state.
- Other methods return `405` with `Allow: GET, POST`.
- In `/api/report`, get current server state. If `running`, return `409 { error: 'Agent review is still running' }`. Pass only that state to `buildReport(session, payload.responses || [], { agentReview })`; ignore all other payload properties.

Keep all existing body limits and security headers.

- [ ] **Step 4: Run server tests and full suite**

Run:

```bash
node --test test/server.test.mjs
npm test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 5: Commit the agent HTTP API**

```bash
git add src/server.mjs test/server.test.mjs
git commit -m "feat: expose server-owned agent review API"
```

---

### Task 7: CLI Reviewer Wiring and Auto-Review

**Files:**
- Modify: `bin/vlp-review.mjs`
- Modify: `test/cli.test.mjs`

**Interfaces:**
- Consumes: `createReviewerConfig`, `createReviewer`, and `createAgentReviewService`.
- Supplies: configured service to `createVlpServer`.
- `--auto-review` runs after listening and before browser opening.

- [ ] **Step 1: Write failing CLI integration tests**

Extend `test/cli.test.mjs` with a helper fake OpenAI server returning valid decisions for every incoming question. Spawn the CLI with:

```js
const args = [
  '--prompt', 'examples/product-search/prompt.md',
  '--code', 'examples/product-search/generated-code.js',
  '--port', String(port),
  '--reviewer', 'openai-compatible',
  '--reviewer-model', 'test-model',
  '--reviewer-base-url', fakeProviderUrl,
  '--auto-review',
  '--no-open'
];
const env = { ...process.env, VLP_REVIEWER_API_KEY: 'test-key' };
```

Assert output order places `Running agent review` before `VLP review ready`, reports either `Agent review completed: approved` or `needs-human`, and the fake endpoint receives one authorized request. Add a missing-key startup case that still prints the local URL and a reviewer setup failure without printing any environment value. Keep the existing manual startup test.

- [ ] **Step 2: Run CLI tests and confirm RED**

Run:

```bash
node --test test/cli.test.mjs
```

Expected: FAIL because the CLI does not instantiate or run a reviewer.

- [ ] **Step 3: Wire reviewer configuration and service into the CLI**

Modify `bin/vlp-review.mjs` imports:

```js
import { createReviewerConfig } from '../src/reviewer-config.mjs';
import { createReviewer } from '../src/reviewers/index.mjs';
import { createAgentReviewService } from '../src/agent-review-service.mjs';
```

After `createSession(input)`:

```js
const reviewerConfig = createReviewerConfig(options);
let reviewer = null;
let reviewerInfo = null;
let configurationError = null;

if (reviewerConfig) {
  reviewerInfo = { provider: reviewerConfig.provider, model: reviewerConfig.model };
  if (!reviewerConfig.apiKey) {
    configurationError = 'Set VLP_REVIEWER_API_KEY before running agent review.';
  } else {
    reviewer = createReviewer(reviewerConfig);
  }
}

const agentReviewService = reviewerConfig
  ? createAgentReviewService({ session, reviewer, reviewerInfo, configurationError })
  : null;
```

Pass `agentReviewService` to `createVlpServer`. After `listen()` and before browser opening:

```js
if (options.autoReview) {
  console.log('Running agent review…');
  const review = await agentReviewService.run();
  console.log(`Agent review completed: ${review.status}.`);
}
```

Print the normal ready URL even when reviewer state is `failed`, and print setup guidance without credentials. Preserve current `EADDRINUSE` handling and manual-mode output.

- [ ] **Step 4: Run CLI tests and full suite**

Run:

```bash
node --test test/cli.test.mjs
npm test
```

Expected: all tests PASS; no real external endpoint is contacted.

- [ ] **Step 5: Commit CLI orchestration**

```bash
git add bin/vlp-review.mjs test/cli.test.mjs
git commit -m "feat: run agent review from the CLI"
```

---

### Task 8: Agent-First Browser Experience

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/ui-contract.test.mjs`

**Interfaces:**
- Consumes: `GET/POST /api/agent-review` state and existing session/report endpoints.
- Sends: only human responses for escalated questions to `POST /api/report`.
- Manual mode keeps existing controls and persistence behavior.

- [ ] **Step 1: Write failing UI contract tests**

Extend `test/ui-contract.test.mjs` required IDs with:

```js
'privacy-badge', 'privacy-copy', 'reviewer-panel', 'reviewer-mode',
'reviewer-disclosure', 'reviewer-status', 'reviewer-run-button',
'agent-audit', 'agent-decision', 'agent-confidence', 'agent-intent',
'agent-rationale', 'agent-escalation'
```

Assert HTML includes `Remote agent mode sends the prompt and linked excerpts` and no longer hard-codes `Nothing leaves localhost` in the footer. Assert JavaScript includes GET/POST use of `/api/agent-review`, renders agent fields with `textContent`, filters browser responses by escalated IDs, disables controls for approved results, polls a running auto-review, and still contains no `innerHTML`. Assert CSS includes distinct styles for `.reviewer-panel`, `.review-status`, `.agent-audit`, `.remote-badge`, approved/escalated states, and existing responsive/reduced-motion rules.

- [ ] **Step 2: Run UI tests and confirm RED**

Run:

```bash
node --test test/ui-contract.test.mjs
```

Expected: FAIL because agent reviewer elements and API logic are absent.

- [ ] **Step 3: Add semantic reviewer UI markup**

Modify `public/index.html`:

- Add IDs `privacy-badge` and `privacy-copy` to the top badge so JavaScript can switch Local only to Remote agent.
- Change the hero copy to avoid claiming source always stays local; retain local-mode privacy language in dynamic copy.
- Insert `#reviewer-panel` before `.progress-shell`, initially hidden, containing provider/model, disclosure, status, and `#reviewer-run-button`.
- Inside the question card after `.question-copy`, add hidden `#agent-audit` with labeled text nodes for decision, confidence, intent basis, rationale, and escalation reasons.
- Change step label to `04 · Validation judgment`.
- Change footer privacy copy to `Local by default · explicit remote review only`.
- Keep all buttons `type="button"`, labels associated, and live status regions accessible.

- [ ] **Step 4: Implement agent state loading, running, and rendering**

Modify `public/app.js` state:

```js
agentReview: null,
agentPolling: null
```

Add all new IDs to `ids`. Implement:

```js
function agentResult(questionId) {
  return state.agentReview?.results?.find(result => result.questionId === questionId) || null;
}

function isAgentMode() {
  return state.agentReview && state.agentReview.status !== 'not-configured';
}

function humanResponses() {
  if (!isAgentMode()) return [...state.responses.values()];
  const escalated = new Set(
    (state.agentReview.results || [])
      .filter(result => result.status === 'escalated')
      .map(result => result.questionId)
  );
  return [...state.responses.values()].filter(response => escalated.has(response.questionId));
}
```

Change startup to fetch `/api/session` and `/api/agent-review` together. Implement `runAgentReview()` as POST, replace state only with the returned sanitized state, prune saved responses to currently escalated IDs, persist, and re-render. If GET returns `running`, poll GET once per second until terminal state, with only one timer active.

Implement `renderReviewer()` to:

- hide panel and show Local only for `not-configured`;
- show remote badge/disclosure/provider/model in agent mode;
- disable the run button and label it `Reviewing…` while running;
- label terminal button `Re-run agent review`;
- show safe error messages from state.

Extend `renderQuestion()` so approved agent results show the audit, disable textarea and decision buttons, and display effective decision. Escalated results show audit/escalation reasons and enable human controls. Ready/running/failed states disable human controls until valid escalated results exist. Manual mode follows the existing code path unchanged.

Change `finishReview()` body to:

```js
body: JSON.stringify({ responses: humanResponses() })
```

Bind `reviewer-run-button` to `runAgentReview`. Continue all rendering via `textContent`, `replaceChildren`, and `makeElement`.

- [ ] **Step 5: Style agent states responsively**

Modify `public/styles.css` with:

- `.remote-badge` using amber/coral rather than green;
- `.reviewer-panel` grid layout matching existing panels;
- `.review-status[data-state="approved"]`, `[data-state="needs-human"]`, and `[data-state="failed"]` colors;
- `.agent-audit` bordered definition list/grid;
- `.agent-audit[data-status="approved"]` and `[data-status="escalated"]` accents;
- mobile stacking under the existing `800px` media query;
- no animation that bypasses `prefers-reduced-motion`.

- [ ] **Step 6: Run UI tests and full suite**

Run:

```bash
node --test test/ui-contract.test.mjs
npm test
```

Expected: all tests PASS; JavaScript contains no `innerHTML`.

- [ ] **Step 7: Commit the agent-first UI**

```bash
git add public/index.html public/app.js public/styles.css test/ui-contract.test.mjs
git commit -m "feat: add agent-first review interface"
```

---

### Task 9: Documentation, Security Regression, and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `test/example.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Documents exact CLI/env setup and privacy boundary.
- Produces no new runtime API.

- [ ] **Step 1: Add an end-to-end example security regression**

Extend `test/example.test.mjs` to build reviewer input from the live example and assert every evidence item belongs to a question-linked documentation ID, the payload contains no API-key marker, and source content not linked to any question is absent. Add an assertion that applying a complete explicit, confidence-`0.80` provider response produces only approved results.

- [ ] **Step 2: Run the example test and confirm behavior before docs**

Run:

```bash
node --test test/example.test.mjs
```

Expected: PASS because Tasks 2 and 4 already implement the exercised contract. A failure is a cross-component regression; identify and correct the responsible earlier implementation before documenting the feature.

- [ ] **Step 3: Update README with agent mode and changed privacy boundary**

Add sections containing these exact operational facts:

```bash
export VLP_REVIEWER_API_KEY='your-provider-key'
node bin/vlp-review.mjs \
  --prompt examples/product-search/prompt.md \
  --code examples/product-search/generated-code.js \
  --reviewer openai-compatible \
  --reviewer-model '<provider-model-id>' \
  --auto-review
```

Document:

- all four new CLI flags and the environment-only credential;
- manual mode remains local-only and default;
- agent mode sends the full prompt plus targeted linked excerpts to the configured endpoint;
- agent decisions use confidence threshold `0.80` and explicit-prompt grounding;
- escalated items require human review;
- reviewer output creates report/repair instructions but never changes files;
- OpenAI-compatible `/chat/completions` and JSON-object response support are required;
- custom HTTP endpoints are loopback-only;
- no correctness guarantee and no real model calls in tests.

Replace universal statements such as `Nothing leaves localhost` and `No LLM API key is required` with mode-specific wording. Keep the research-context limitations accurate. Change `package.json` description to `VLP-inspired agent and human review sessions for vibe-coded JavaScript and TypeScript`.

- [ ] **Step 4: Run syntax, tests, packaging, and leak scans**

Run:

```bash
node --check bin/vlp-review.mjs
for file in src/*.mjs src/reviewers/*.mjs test/*.mjs public/app.js; do node --check "$file"; done
npm test
npm pack --dry-run
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' \
  '(gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY)' .
```

Expected:

- every syntax check exits `0`;
- all tests PASS with zero failures;
- package dry-run includes source, reviewer modules, UI, README, examples, and tests, but excludes `.idea`, `node_modules`, credentials, and temporary files;
- credential-pattern scan prints no matches and exits `1` because `rg` found nothing.

- [ ] **Step 5: Perform a fake-provider browser smoke test**

Start a local fake OpenAI-compatible endpoint that returns one high-confidence explicit decision per received question, then run the CLI against it with a dummy key and an unused port. Verify in the browser:

1. badge changes from Local only to Remote agent;
2. disclosure names the prompt/linked-excerpt boundary;
3. Run/Re-run reaches Agent approved or Needs human review;
4. approved items are read-only and show confidence/rationale;
5. escalated items allow human resolution;
6. generated Markdown contains agent and final validation statuses;
7. browser network traffic uses only `127.0.0.1`; only the CLI server contacts the fake provider;
8. no reviewed source file changes after review.

Stop both local servers after the smoke test.

- [ ] **Step 6: Commit documentation and regression coverage**

```bash
git add README.md test/example.test.mjs package.json
git commit -m "docs: document agent reviewer mode"
```

- [ ] **Step 7: Verify branch state**

Run:

```bash
git status -sb
git log --oneline --decorate origin/main..HEAD
```

Expected: branch is `feature/agent-reviewer`; only the pre-existing untracked `.idea/` may appear in the original checkout; the implementation worktree is clean; commits cover configuration, contract, provider, policy/service, report, API, CLI, UI, and docs.
