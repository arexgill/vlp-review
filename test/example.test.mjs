import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInput } from '../src/load-input.mjs';
import { createSession } from '../src/create-session.mjs';
import { buildReport } from '../src/build-report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleRoot = path.join(root, 'examples', 'product-search');

test('example produces targeted field, value, and error questions', async () => {
  const input = await loadInput({
    promptPath: path.join(exampleRoot, 'prompt.md'),
    codePath: path.join(exampleRoot, 'generated-code.js')
  });
  const session = await createSession(input);
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
