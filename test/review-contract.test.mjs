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

function codes(result) {
  return result.issues.map(issue => issue.code);
}

test('creates a least-data review input without unrelated source leakage', () => {
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
});

test('retains a valid provider decision', () => {
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
  assert.equal(valid.decisions.length, 1);
  assert.equal(valid.decisions[0].questionId, 'q-1');
});

test('returns invalid-json and missing-decision for malformed content', () => {
  const result = validateReviewContent('{"summary": "broken"', input);
  assert.deepEqual(codes(result), ['invalid-json', 'missing-decision']);
  assert.equal(result.decisions.length, 0);
  assert.match(result.issues[0].message, /invalid json/i);
  assert.doesNotMatch(result.issues[0].message, /broken/);
});

test('returns invalid-json for non-string content', () => {
  const result = validateReviewContent(null, input);
  assert.deepEqual(codes(result), ['invalid-json', 'missing-decision']);
  assert.equal(result.decisions.length, 0);
});

test('rejects invalid decisions and preserves valid ones for other questions', () => {
  const multiInput = createReviewInput({
    ...session,
    questions: [
      ...session.questions,
      {
        id: 'q-2',
        type: 'missing-step',
        severity: 'low',
        ask: 'Should a second field be searched?',
        reason: 'A separate question remains.',
        promptEvidence: 'description',
        docUnitIds: []
      }
    ]
  });

  const result = validateReviewContent(JSON.stringify({
    summary: 'Mixed decisions.',
    decisions: [
      {
        questionId: 'q-1',
        decision: 'maybe',
        answer: 'Search title and description.',
        rationale: 'Invalid decision value.',
        confidence: 0.93,
        intentBasis: 'explicit-prompt',
        evidenceDocUnitIds: ['doc-linked']
      },
      {
        questionId: 'q-2',
        decision: 'accept',
        answer: '',
        rationale: 'The second field is not justified.',
        confidence: 0.91,
        intentBasis: 'explicit-prompt',
        evidenceDocUnitIds: []
      }
    ]
  }), multiInput);

  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].questionId, 'q-2');
  assert.ok(codes(result).includes('invalid-decision'));
  assert.ok(codes(result).includes('missing-decision'));
  assert.ok(codes(result).includes('missing-decision'));
  assert.ok(!result.decisions.some(decision => decision.questionId === 'q-1'));
});

test('invalidates duplicate question entries', () => {
  const multiInput = createReviewInput({
    ...session,
    questions: [
      ...session.questions,
      {
        id: 'q-2',
        type: 'missing-step',
        severity: 'low',
        ask: 'Should a second field be searched?',
        reason: 'A separate question remains.',
        promptEvidence: 'description',
        docUnitIds: []
      }
    ]
  });

  const result = validateReviewContent(JSON.stringify({
    summary: 'Duplicates should be rejected.',
    decisions: [
      {
        questionId: 'q-1',
        decision: 'correct',
        answer: 'Search title and description.',
        rationale: 'First attempt.',
        confidence: 0.91,
        intentBasis: 'explicit-prompt',
        evidenceDocUnitIds: ['doc-linked']
      },
      {
        questionId: 'q-1',
        decision: 'correct',
        answer: 'Search title and description.',
        rationale: 'Second attempt.',
        confidence: 0.92,
        intentBasis: 'explicit-prompt',
        evidenceDocUnitIds: ['doc-linked']
      },
      {
        questionId: 'q-2',
        decision: 'accept',
        answer: '',
        rationale: 'Independent valid decision.',
        confidence: 0.9,
        intentBasis: 'explicit-prompt',
        evidenceDocUnitIds: []
      }
    ]
  }), multiInput);

  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].questionId, 'q-2');
  assert.ok(codes(result).includes('duplicate-question'));
  assert.ok(codes(result).includes('missing-decision'));
  assert.ok(!result.decisions.some(decision => decision.questionId === 'q-1'));
});

for (const [name, content, expectedCode] of [
  ['rejects unknown question ids', JSON.stringify({
    summary: 'Unknown question.',
    decisions: [{
      questionId: 'unknown',
      decision: 'accept',
      answer: '',
      rationale: 'Not part of the input.',
      confidence: 0.8,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: []
    }]
  }), 'unknown-question'],
  ['rejects confidence below zero', JSON.stringify({
    summary: 'Bad confidence.',
    decisions: [{
      questionId: 'q-1',
      decision: 'correct',
      answer: 'Search title and description.',
      rationale: 'Too low.',
      confidence: -0.1,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: ['doc-linked']
    }]
  }), 'invalid-confidence'],
  ['rejects confidence above one', JSON.stringify({
    summary: 'Bad confidence.',
    decisions: [{
      questionId: 'q-1',
      decision: 'correct',
      answer: 'Search title and description.',
      rationale: 'Too high.',
      confidence: 1.1,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: ['doc-linked']
    }]
  }), 'invalid-confidence'],
  ['rejects unknown intent bases', JSON.stringify({
    summary: 'Bad intent base.',
    decisions: [{
      questionId: 'q-1',
      decision: 'correct',
      answer: 'Search title and description.',
      rationale: 'Unsupported intent.',
      confidence: 0.91,
      intentBasis: 'guessed',
      evidenceDocUnitIds: ['doc-linked']
    }]
  }), 'invalid-intent-basis'],
  ['rejects unknown evidence ids', JSON.stringify({
    summary: 'Bad evidence.',
    decisions: [{
      questionId: 'q-1',
      decision: 'correct',
      answer: 'Search title and description.',
      rationale: 'Linked to the wrong evidence.',
      confidence: 0.91,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: ['doc-missing']
    }]
  }), 'invalid-evidence'],
  ['rejects empty correction answers', JSON.stringify({
    summary: 'Missing correction text.',
    decisions: [{
      questionId: 'q-1',
      decision: 'correct',
      answer: '',
      rationale: 'Correction needs text.',
      confidence: 0.91,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: ['doc-linked']
    }]
  }), 'invalid-answer'],
  ['rejects non-array decisions', JSON.stringify({
    summary: 'Wrong shape.',
    decisions: {
      questionId: 'q-1',
      decision: 'correct'
    }
  }), 'invalid-decisions'],
  ['rejects strings longer than 4000 characters', JSON.stringify({
    summary: 'Too long.',
    decisions: [{
      questionId: 'q-1',
      decision: 'correct',
      answer: 'Search title and description.',
      rationale: 'x'.repeat(4001),
      confidence: 0.91,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: ['doc-linked']
    }]
  }), 'oversized-text']
]) {
  test(name, () => {
    const result = validateReviewContent(content, input);
    assert.ok(codes(result).includes(expectedCode));
    assert.ok(codes(result).includes('missing-decision'));
    assert.equal(result.decisions.length, 0);
  });
}
