import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReviewPolicy } from '../src/review-policy.mjs';

const session = {
  questions: [
    { id: 'q-1' },
    { id: 'q-2' }
  ]
};

const baseDecision = {
  questionId: 'q-1',
  decision: 'accept',
  answer: '',
  rationale: 'The prompt explicitly asks for this behavior.',
  confidence: 0.9,
  intentBasis: 'explicit-prompt',
  evidenceDocUnitIds: ['doc-1']
};

function resultFor(overrides = {}, issues = []) {
  return applyReviewPolicy(session, {
    summary: '',
    decisions: [{ ...baseDecision, ...overrides }],
    issues
  })[0];
}

test('approves only sufficiently confident explicit accept and correct decisions', () => {
  assert.equal(resultFor({ confidence: 0.8 }).status, 'approved');
  assert.equal(resultFor({ confidence: 0.8 }).effectiveDecision, 'accept');
  assert.equal(resultFor({ confidence: 0.79 }).status, 'escalated');
  assert.deepEqual(resultFor({ confidence: 0.79 }).escalationReasons, ['confidence-below-threshold']);

  assert.equal(resultFor({ decision: 'accept', intentBasis: 'inferred' }).status, 'escalated');
  assert.equal(resultFor({ decision: 'correct', answer: 'Use the other field.', intentBasis: 'absent' }).status, 'escalated');
  assert.equal(resultFor({ decision: 'irrelevant', intentBasis: 'inferred' }).status, 'approved');
  assert.equal(resultFor({ decision: 'escalate' }).effectiveDecision, null);
});

test('escalates omitted decisions and matching validation issues with stable reasons', () => {
  const results = applyReviewPolicy(session, {
    summary: '',
    decisions: [{ ...baseDecision }],
    issues: [
      { questionId: 'q-1', code: 'invalid-confidence', message: 'bad confidence' },
      { questionId: 'q-2', code: 'missing-decision', message: 'missing decision' },
      { questionId: '', code: 'invalid-json', message: 'top-level issue' }
    ]
  });

  assert.deepEqual(results[0].escalationReasons, ['invalid-confidence']);
  assert.equal(results[0].status, 'escalated');
  assert.equal(results[0].effectiveDecision, null);

  assert.equal(results[1].status, 'escalated');
  assert.deepEqual(results[1].escalationReasons, ['missing-decision', 'missing-provider-decision']);
  assert.equal(results[1].proposedDecision, null);
  assert.equal(results[1].effectiveDecision, null);
});

test('escalates invalid decision strings even when validation is bypassed', () => {
  const result = resultFor({ decision: 'maybe' });

  assert.equal(result.status, 'escalated');
  assert.equal(result.proposedDecision, 'maybe');
  assert.equal(result.effectiveDecision, null);
  assert.deepEqual(result.escalationReasons, ['invalid-provider-decision']);
});

test('preserves approved rationale and evidence and only sets effectiveDecision for approvals', () => {
  const approved = resultFor({
    decision: 'correct',
    answer: 'Search title and description.',
    rationale: 'Description is explicit in the prompt.',
    evidenceDocUnitIds: ['doc-1', 'doc-2']
  });

  assert.equal(approved.status, 'approved');
  assert.equal(approved.effectiveDecision, 'correct');
  assert.equal(approved.rationale, 'Description is explicit in the prompt.');
  assert.deepEqual(approved.evidenceDocUnitIds, ['doc-1', 'doc-2']);
  assert.deepEqual(approved.escalationReasons, []);

  const escalated = resultFor({ decision: 'escalate' });
  assert.equal(escalated.status, 'escalated');
  assert.equal(escalated.effectiveDecision, null);
  assert.deepEqual(escalated.evidenceDocUnitIds, ['doc-1']);
});
