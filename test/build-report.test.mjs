import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/build-report.mjs';

const session = {
  id: 'session-demo',
  prompt: 'Search all product fields.',
  diagnostics: [{ file: 'broken.ts', line: 3, message: 'Unexpected token' }],
  questions: [
    { id: 'q-correct', type: 'missing-step', severity: 'high', title: 'Search scope', ask: 'Should description be searched?', reason: 'Description is missing.', promptEvidence: 'all product fields', docUnitIds: ['doc-1'] },
    { id: 'q-accept', type: 'wrong-value', severity: 'medium', title: 'Result limit', ask: 'Is 25 intended?', reason: 'The value is unstated.', promptEvidence: '', docUnitIds: ['doc-2'] },
    { id: 'q-ignore', type: 'redundant-step', severity: 'low', title: 'Normalization', ask: 'Is normalization intended?', reason: 'Not explicit.', promptEvidence: '', docUnitIds: ['doc-3'] },
    { id: 'q-open', type: 'api-use', severity: 'medium', title: 'Errors', ask: 'How should errors surface?', reason: 'No error path.', promptEvidence: '', docUnitIds: [] }
  ],
  docUnits: [
    { id: 'doc-1', file: 'search.js', lineStart: 4, text: 'searchProducts reads product.name.', code: 'product.name' },
    { id: 'doc-2', file: 'search.js', lineStart: 6, text: 'It limits to 25.', code: 'slice(0, 25)' },
    { id: 'doc-3', file: 'search.js', lineStart: 2, text: 'It lowercases query.', code: 'toLowerCase()' }
  ]
};

const responses = [
  { questionId: 'q-correct', decision: 'correct', answer: 'Search name, description, category, and tags.' },
  { questionId: 'q-accept', decision: 'accept', answer: '25 results is correct.' },
  { questionId: 'q-ignore', decision: 'irrelevant', answer: '' }
];

const manualBaseline = `# VLP Review Report

Session: session-demo

## Review Summary

- Targeted questions: 4
- Accepted behaviors: 1
- Corrected intents: 1
- Marked irrelevant: 1
- Unresolved: 1

## Original Prompt

Search all product fields.

## Corrected Intent

### Search scope (q-correct)

- **Decision:** correct
- **Question:** Should description be searched?
- **User feedback:** Search name, description, category, and tags.
- **Prompt trace:** all product fields
- **Code/documentation trace:** search.js:4 — searchProducts reads product.name.

## Accepted Generated Behavior

### Result limit (q-accept)

- **Decision:** accept
- **Question:** Is 25 intended?
- **User feedback:** 25 results is correct.
- **Code/documentation trace:** search.js:6 — It limits to 25.

## Marked Irrelevant

### Normalization (q-ignore)

- **Decision:** irrelevant
- **Question:** Is normalization intended?
- **Code/documentation trace:** search.js:2 — It lowercases query.

## Unresolved Questions

### Errors (q-open)

- **Question:** How should errors surface?
- **Reason:** No error path.

## Parse Diagnostics

- broken.ts:3 — Unexpected token

## Repair Instructions for Coding Agent

1. Update the generated code to satisfy: Search name, description, category, and tags.. Trace: search.js:4 — searchProducts reads product.name..

Preserve the behavior accepted in: q-accept.
Do not infer answers for unresolved questions; ask the user before changing those behaviors.
After editing, run the project tests and report any behavior that could not be implemented.
`;

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

test('builds the existing manual report byte-for-byte unchanged and without absolute paths', () => {
  const markdown = buildReport(session, responses);
  assert.equal(markdown, manualBaseline);
  assert.doesNotMatch(markdown, /\/Users\//);
});

test('renders an agent audit with automatic approvals and human escalation resolution', () => {
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
});

test('keeps unanswered escalations in needs-human status', () => {
  const markdown = buildReport(session, [], { agentReview });
  assert.match(markdown, /Final validation status: Needs human review/);
  assert.match(markdown, /## Unresolved Questions/);
  assert.match(markdown, /q-open/);
});

test('reports agent-approved validation when all results are automatic', () => {
  const approvedReview = structuredClone(agentReview);
  approvedReview.status = 'approved';
  approvedReview.results[3] = {
    ...approvedReview.results[3],
    status: 'approved',
    effectiveDecision: 'correct',
    answer: 'Surface an error.'
  };

  const markdown = buildReport(session, [], { agentReview: approvedReview });
  assert.match(markdown, /Final validation status: Agent approved/);
  assert.doesNotMatch(markdown, /Completed with human resolution/);
});

test('reports reviewer failures without claiming approval', () => {
  const markdown = buildReport(session, [], {
    agentReview: {
      status: 'failed',
      provider: 'openai-compatible',
      model: 'review-model',
      threshold: 0.8,
      startedAt: '2026-07-22T10:00:00.000Z',
      completedAt: '2026-07-22T10:00:01.000Z',
      summary: '',
      results: [],
      error: { code: 'reviewer-request-failed', message: 'Reviewer request failed.' }
    }
  });

  assert.match(markdown, /Final validation status: Reviewer failed/);
  assert.doesNotMatch(markdown, /Final validation status: Agent approved/);
  assert.doesNotMatch(markdown, /Completed with human resolution/);
});

test('reports when agent review has not run yet', () => {
  const markdown = buildReport(session, [], {
    agentReview: {
      status: 'ready',
      provider: 'openai-compatible',
      model: 'review-model',
      threshold: 0.8,
      startedAt: null,
      completedAt: null,
      summary: '',
      results: [],
      error: null
    }
  });

  assert.match(markdown, /Agent review status: Agent review has not run yet/);
  assert.match(markdown, /Final validation status: Needs human review/);
});

test('rejects browser responses that try to override agent-approved questions', () => {
  assert.throws(() => buildReport(session, [{
    questionId: 'q-correct',
    decision: 'correct',
    answer: 'Override the approved answer.'
  }], { agentReview }), /cannot override agent-approved question/i);
});

test('rejects browser responses for questions outside escalated agent results', () => {
  const partialReview = {
    ...agentReview,
    results: agentReview.results.filter(result => result.questionId !== 'q-open')
  };

  assert.throws(() => buildReport(session, [{
    questionId: 'q-open',
    decision: 'correct',
    answer: 'Surface a typed search error.'
  }], { agentReview: partialReview }), /non-escalated|unknown/i);
});

test('rejects unknown questions, decisions, duplicate answers, and empty corrections', () => {
  assert.throws(() => buildReport(session, [{ questionId: 'bad', decision: 'accept', answer: '' }]), /Unknown question/);
  assert.throws(() => buildReport(session, [{ questionId: 'q-correct', decision: 'maybe', answer: '' }]), /Invalid decision/);
  assert.throws(() => buildReport(session, [{ questionId: 'q-correct', decision: 'correct', answer: ' ' }]), /Correction text is required/);
  assert.throws(() => buildReport(session, [responses[0], responses[0]]), /Duplicate response/);
});
