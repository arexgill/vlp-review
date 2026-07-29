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

test('builds an agent-ready report without absolute paths', () => {
  const markdown = buildReport(session, responses);
  assert.match(markdown, /# VLP Review Report/);
  assert.match(markdown, /Search name, description, category, and tags/);
  assert.match(markdown, /25 results is correct/);
  assert.match(markdown, /q-open/);
  assert.match(markdown, /broken\.ts:3/);
  assert.match(markdown, /Update the generated code/);
  assert.doesNotMatch(markdown, /\/Users\//);
  assert.doesNotMatch(markdown, /Execution Boundary/);
});

test('includes safe execution boundary section for FastAPI runtimes', () => {
  const fastapiSession = {
    ...session,
    fastapiApp: 'app:app',
    runtimeDiagnostic: 'Docker offline',
  };
  const markdown = buildReport(fastapiSession, []);
  assert.match(markdown, /## Execution Boundary/);
  assert.match(markdown, /Docker offline/);
  assert.match(markdown, /Endpoint execution is strictly omitted/);

  const successSession = {
    ...session,
    fastapiApp: 'app:app',
    openapi: { paths: {} }
  };
  const successMarkdown = buildReport(successSession, []);
  assert.match(successMarkdown, /Safe OpenAPI payload collected locally via app:app/);
});

test('rejects unknown questions, decisions, duplicate answers, and empty corrections', () => {
  assert.throws(() => buildReport(session, [{ questionId: 'bad', decision: 'accept', answer: '' }]), /Unknown question/);
  assert.throws(() => buildReport(session, [{ questionId: 'q-correct', decision: 'maybe', answer: '' }]), /Invalid decision/);
  assert.throws(() => buildReport(session, [{ questionId: 'q-correct', decision: 'correct', answer: ' ' }]), /Correction text is required/);
  assert.throws(() => buildReport(session, [responses[0], responses[0]]), /Duplicate response/);
});

test('renders exact Markdown labels for FastAPI source and runtime evidence', () => {
  const fapiSession = {
    id: 'fapi-session',
    questions: [
      {
        id: 'q-fapi-drift',
        type: 'method-drift',
        title: 'HTTP Method Drift',
        ask: 'Static vs runtime differ.',
        reason: 'Because.',
        sourceEvidence: { file: 'main.py', lineStart: 12, target: '/items' },
        runtimeEvidence: { type: 'openapi-drift', path: '/items', methods: ['get', 'post'] }
      },
      {
        id: 'q-fapi-diag',
        type: 'runtime-diagnostic',
        title: 'FastAPI Runtime Verification Failed',
        ask: 'Fail.',
        reason: 'Docker failed.',
        sourceEvidence: { file: 'fastapi runtime', lineStart: 0 },
        runtimeEvidence: { type: 'diagnostic', message: 'Connection refused.' }
      }
    ]
  };

  const fapiResponses = [
    { questionId: 'q-fapi-drift', decision: 'correct', answer: 'Update the contract to POST.' }
  ];

  const markdown = buildReport(fapiSession, fapiResponses);
  
  // Method drift rendered as resolved:
  assert.match(markdown, /- \*\*Source evidence:\*\* main\.py:12 \(Target: \/items\)/);
  assert.match(markdown, /- \*\*Runtime OpenAPI evidence:\*\* \[openapi-drift\] \/items get,post/);
  
  // Diagnostic rendered as unresolved:
  assert.match(markdown, /- \*\*Source evidence:\*\* fastapi runtime:1/);
  assert.match(markdown, /- \*\*Runtime OpenAPI evidence:\*\* \[Diagnostic\] Connection refused\./);
});
