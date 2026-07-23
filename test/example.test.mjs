import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInput } from '../src/load-input.mjs';
import { createSession } from '../src/create-session.mjs';
import { buildReport } from '../src/build-report.mjs';
import { createReviewInput, validateReviewContent } from '../src/review-contract.mjs';
import { applyReviewPolicy } from '../src/review-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleRoot = path.join(root, 'examples', 'product-search');
const API_KEY_MARKER = /VLP_REVIEWER_API_KEY|OPENAI_API_KEY|sk-[A-Za-z0-9]{20,}/;

test('example produces targeted field, value, and error questions', async () => {
  const input = await loadInput({
    promptPath: path.join(exampleRoot, 'prompt.md'),
    codePath: path.join(exampleRoot, 'generated-code.js')
  });
  const session = createSession(input);
  const questionText = session.questions.map(question => `${question.ask} ${question.reason}`).join('\n');

  assert.equal(session.sources.length, 1);
  assert.ok(session.docUnits.some(unit => unit.symbol === 'searchProducts'));
  assert.match(questionText, /description|category|tags/i);
  assert.match(questionText, /25/);
  assert.match(questionText, /invalid|error/i);
  assert.ok(session.questions.length <= 20);

  const fieldQuestion = session.questions.find(question => /description|category|tags/i.test(question.ask));
  const report = buildReport(session, [{
    questionId: fieldQuestion.id,
    decision: 'correct',
    answer: 'Search name, description, category, and tags.'
  }]);
  assert.match(report, /Search name, description, category, and tags/);
  assert.match(report, /generated-code\.js:\d+/);
});

test('example reviewer input stays least-data and policy approves complete explicit threshold decisions', async () => {
  const input = await loadInput({
    promptPath: path.join(exampleRoot, 'prompt.md'),
    codePath: path.join(exampleRoot, 'generated-code.js')
  });
  const session = createSession(input);
  const reviewInput = createReviewInput(session);
  const linkedDocUnitIds = new Set(session.questions.flatMap(question => question.docUnitIds || []));
  const payload = JSON.stringify(reviewInput);

  assert.ok(reviewInput.questions.every(question => (
    question.evidence.every(item => linkedDocUnitIds.has(item.docUnitId))
  )));
  assert.doesNotMatch(payload, API_KEY_MARKER);
  assert.ok(!payload.includes('function searchProducts(products, query, options = {}) {'));

  const providerReview = validateReviewContent(JSON.stringify({
    summary: 'Every question received an explicit threshold decision.',
    decisions: reviewInput.questions.map(question => ({
      questionId: question.id,
      decision: 'accept',
      answer: '',
      rationale: 'The prompt explicitly justifies this outcome.',
      confidence: 0.8,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: question.evidence.map(item => item.docUnitId)
    }))
  }), reviewInput);
  const results = applyReviewPolicy(session, providerReview);

  assert.equal(providerReview.issues.length, 0);
  assert.equal(results.length, session.questions.length);
  assert.ok(results.every(result => result.status === 'approved'));
  assert.ok(results.every(result => result.effectiveDecision === 'accept'));
});
