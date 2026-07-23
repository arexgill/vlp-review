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
  assert.equal(createReviewerConfig({ ...baseOptions, reviewer: null }, {}), null);
});

test('allows HTTPS and exact HTTP loopback URLs while removing trailing slashes', () => {
  assert.equal(normalizeReviewerBaseUrl('https://api.example.test/v1/'), 'https://api.example.test/v1');
  assert.equal(normalizeReviewerBaseUrl('http://localhost:9000/v1/'), 'http://localhost:9000/v1');
  assert.equal(normalizeReviewerBaseUrl('http://LOCALHOST:9000/v1'), 'http://localhost:9000/v1');
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
    'http://127.1:9000/v1',
    'http://2130706433:9000/v1',
    'http://[::ffff:127.0.0.1]:9000/v1',
    'http://localhost.:9000/v1',
    ' http://localhost:9000/v1',
    'http://localhost:9000/v1 ',
    'http://loca%6Chost:9000/v1',
    'not-a-url'
  ]) {
    assert.throws(() => normalizeReviewerBaseUrl(value), /reviewer base URL/i, value);
  }
});

test('keeps a missing key as null so the local server can show setup guidance', () => {
  assert.equal(createReviewerConfig(baseOptions, {}).apiKey, null);
});
