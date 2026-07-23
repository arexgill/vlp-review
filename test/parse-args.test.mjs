import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, usage } from '../src/parse-args.mjs';

test('parses required paths and optional flags', () => {
  assert.deepEqual(
    parseArgs(['--prompt', 'prompt.md', '--code', 'src', '--port', '4400', '--no-open']),
    {
      promptPath: 'prompt.md',
      codePath: 'src',
      port: 4400,
      open: false,
      help: false,
      reviewer: null,
      reviewerModel: null,
      reviewerBaseUrl: 'https://api.openai.com/v1',
      autoReview: false
    }
  );
});

test('defaults to port 4317 and opens the browser', () => {
  assert.deepEqual(
    parseArgs(['--prompt', 'prompt.md', '--code', 'app.ts']),
    {
      promptPath: 'prompt.md',
      codePath: 'app.ts',
      port: 4317,
      open: true,
      help: false,
      reviewer: null,
      reviewerModel: null,
      reviewerBaseUrl: 'https://api.openai.com/v1',
      autoReview: false
    }
  );
});

test('help does not require input paths', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.match(usage(), /vlp-review --prompt <file> --code <file-or-directory>/);
});

test('accepts reviewer options and validates reviewer dependencies', () => {
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
});

test('rejects missing values, unknown flags, and invalid ports', () => {
  assert.throws(() => parseArgs(['--prompt']), /requires a value/);
  assert.throws(() => parseArgs(['--wat']), /Unknown option/);
  assert.throws(
    () => parseArgs(['--prompt', 'p', '--code', 'c', '--port', '70000']),
    /between 1 and 65535/
  );
});
