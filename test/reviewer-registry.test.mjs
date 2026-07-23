import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewer } from '../src/reviewers/index.mjs';

const validConfig = {
  provider: 'openai-compatible',
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:9000/v1',
  apiKey: 'test-key'
};

test('creates the OpenAI-compatible reviewer from the registry', () => {
  assert.equal(createReviewer(validConfig).id, 'openai-compatible');
});

test('rejects unsupported reviewer providers', () => {
  assert.throws(
    () => createReviewer({ ...validConfig, provider: 'unknown' }),
    /Unsupported reviewer provider/
  );
});
