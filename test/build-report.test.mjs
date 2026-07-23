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

const manualCompatSession = {
  id: 'session-manual\r\ncompat',
  prompt: '\nPrompt line 1\r\nPrompt line 2\n',
  diagnostics: [{ file: '/Users/alex/private/diagnostic.js', line: 7, message: 'Broken\r\nmessage' }],
  questions: [
    {
      id: 'q-manual',
      type: 'missing-step',
      severity: 'high',
      title: 'Title line 1\r\nTitle line 2',
      ask: 'Ask line 1\r\nAsk line 2',
      reason: 'Reason A',
      promptEvidence: 'Prompt evidence 1\r\nPrompt evidence 2',
      docUnitIds: ['doc-abs']
    },
    {
      id: 'q-unresolved',
      type: 'api-use',
      severity: 'medium',
      title: 'Unresolved title\r\ncontinued',
      ask: 'Need input\r\nstill need input',
      reason: 'Reason line 1\r\nReason line 2',
      promptEvidence: '',
      docUnitIds: []
    }
  ],
  docUnits: [
    { id: 'doc-abs', file: 'C:\\private\\search.js', lineStart: 4, text: 'Doc line 1\r\nDoc line 2', code: 'product.name' }
  ]
};

const manualCompatResponses = [
  { questionId: 'q-manual', decision: 'correct', answer: 'Answer line 1\r\nAnswer line 2' }
];

const manualCompatBaseline = `# VLP Review Report

Session: session-manual
compat

## Review Summary

- Targeted questions: 2
- Accepted behaviors: 0
- Corrected intents: 1
- Marked irrelevant: 0
- Unresolved: 1

## Original Prompt

Prompt line 1
Prompt line 2

## Corrected Intent

### Title line 1
Title line 2 (q-manual)

- **Decision:** correct
- **Question:** Ask line 1
Ask line 2
- **User feedback:** Answer line 1
Answer line 2
- **Prompt trace:** Prompt evidence 1
Prompt evidence 2
- **Code/documentation trace:** C:\\private\\search.js:4 — Doc line 1
Doc line 2

## Accepted Generated Behavior

None

## Marked Irrelevant

None

## Unresolved Questions

### Unresolved title
continued (q-unresolved)

- **Question:** Need input
still need input
- **Reason:** Reason line 1
Reason line 2

## Parse Diagnostics

- /Users/alex/private/diagnostic.js:7 — Broken
message

## Repair Instructions for Coding Agent

1. Update the generated code to satisfy: Answer line 1
Answer line 2. Trace: C:\\private\\search.js:4 — Doc line 1
Doc line 2.

No generated behaviors were explicitly accepted.
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

test('preserves legacy manual multiline formatting and file strings byte-for-byte', () => {
  const markdown = buildReport(manualCompatSession, manualCompatResponses);
  assert.equal(markdown, manualCompatBaseline);
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
  assert.match(markdown, /Agent review status: Agent approved/);
  assert.match(markdown, /Final validation status: Agent approved/);
  assert.match(markdown, /Approved automatically: 4/);
  assert.match(markdown, /Escalated: 0/);
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

test('reports zero-question agent-approved sessions with no targeted mismatches', () => {
  const markdown = buildReport({
    id: 'zero',
    prompt: 'p',
    questions: [],
    docUnits: [],
    diagnostics: []
  }, [], {
    agentReview: {
      status: 'approved',
      provider: 'openai-compatible',
      model: 'review-model',
      threshold: 0.8,
      startedAt: '2026-07-22T10:00:00.000Z',
      completedAt: '2026-07-22T10:00:01.000Z',
      summary: 'No targeted mismatches were available for agent review.',
      results: [],
      error: null
    }
  });

  assert.match(markdown, /Agent review status: Agent approved/);
  assert.match(markdown, /Final validation status: Agent approved/);
  assert.match(markdown, /Approved automatically: 0/);
  assert.match(markdown, /Escalated: 0/);
  assert.match(markdown, /Agent approved: no targeted mismatches/);
  assert.match(markdown, /Heuristics can miss semantic defects; this result is not a proof of correctness\./);
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

test('flattens untrusted inline markdown content in agent audit and repair instructions', () => {
  const injectedReview = structuredClone(agentReview);
  injectedReview.provider = 'openai-compatible\n## injected-provider-heading';
  injectedReview.summary = 'Three grounded decisions.\n## injected-summary-heading';
  injectedReview.results[0] = {
    ...injectedReview.results[0],
    rationale: 'Description is explicit.\n## injected-rationale-heading',
    answer: 'Search name, description, category, and tags.\n## injected-answer-heading'
  };

  const markdown = buildReport(session, [{
    questionId: 'q-open',
    decision: 'correct',
    answer: 'Surface a typed search error.\n## injected-human-heading'
  }], { agentReview: injectedReview });

  assert.doesNotMatch(markdown, /\n## injected-/);
  assert.match(markdown, /injected-provider-heading/);
  assert.match(markdown, /injected-summary-heading/);
  assert.match(markdown, /injected-rationale-heading/);
  assert.match(markdown, /injected-answer-heading/);
  assert.match(markdown, /injected-human-heading/);
});

test('does not claim agent approval when approved review still contains unresolved escalations', () => {
  const contradictoryReview = structuredClone(agentReview);
  contradictoryReview.status = 'approved';

  const markdown = buildReport(session, [], { agentReview: contradictoryReview });

  assert.match(markdown, /Final validation status: Needs human review/);
  assert.doesNotMatch(markdown, /Final validation status: Agent approved/);
  assert.doesNotMatch(markdown, /All targeted questions were reviewed\./);
});

test('keeps contradictory approved reviews conservative after human escalation answers', () => {
  const contradictoryReview = structuredClone(agentReview);
  contradictoryReview.status = 'approved';

  const markdown = buildReport(session, [{
    questionId: 'q-open',
    decision: 'correct',
    answer: 'Surface a typed search error.'
  }], { agentReview: contradictoryReview });

  assert.match(markdown, /Final validation status: Completed with human resolution/);
  assert.doesNotMatch(markdown, /Final validation status: Agent approved/);
  assert.doesNotMatch(markdown, /All targeted questions were reviewed\./);
});

test('redacts absolute evidence and diagnostic paths in agent mode while preserving useful filenames', () => {
  const absolutePathSession = structuredClone(session);
  absolutePathSession.docUnits = [
    { ...absolutePathSession.docUnits[0], file: '/Users/alex/private/search.js' },
    { ...absolutePathSession.docUnits[1], file: 'C:\\private\\search.js' },
    absolutePathSession.docUnits[2]
  ];
  absolutePathSession.diagnostics = [
    { file: '/Users/alex/private/search.js', line: 3, message: 'Unexpected token' },
    { file: 'C:\\private\\search.js', line: 8, message: 'Access denied' }
  ];

  const markdown = buildReport(absolutePathSession, [{
    questionId: 'q-open',
    decision: 'correct',
    answer: 'Surface a typed search error.'
  }], { agentReview });

  assert.doesNotMatch(markdown, /\/Users\/alex\/private\/search\.js/);
  assert.doesNotMatch(markdown, /C:\\private\\search\.js/);
  assert.match(markdown, /search\.js:4 — searchProducts reads product\.name\./);
  assert.match(markdown, /search\.js:6 — It limits to 25\./);
  assert.match(markdown, /search\.js:3 — Unexpected token/);
  assert.match(markdown, /search\.js:8 — Access denied/);
});

test('rejects unknown questions, decisions, duplicate answers, and empty corrections', () => {
  assert.throws(() => buildReport(session, [{ questionId: 'bad', decision: 'accept', answer: '' }]), /Unknown question/);
  assert.throws(() => buildReport(session, [{ questionId: 'q-correct', decision: 'maybe', answer: '' }]), /Invalid decision/);
  assert.throws(() => buildReport(session, [{ questionId: 'q-correct', decision: 'correct', answer: ' ' }]), /Correction text is required/);
  assert.throws(() => buildReport(session, [responses[0], responses[0]]), /Duplicate response/);
});
