import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, usage } from '../src/parse-args.mjs';

test('parses required paths and optional flags', () => {
  assert.deepEqual(
    parseArgs(['--prompt', 'prompt.md', '--code', 'src', '--port', '4400', '--no-open']),
    { promptPath: 'prompt.md', codePath: 'src', runtime: null, fastapiApp: null, port: 4400, open: false, help: false }
  );
});

test('defaults to port 4317 and opens the browser', () => {
  assert.deepEqual(
    parseArgs(['--prompt', 'prompt.md', '--code', 'app.ts']),
    { promptPath: 'prompt.md', codePath: 'app.ts', runtime: null, fastapiApp: null, port: 4317, open: true, help: false }
  );
});

test('help does not require input paths', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.match(usage(), /vlp-review --prompt <file> --code <file-or-directory>/);
});

test('rejects missing values, unknown flags, and invalid ports', () => {
  assert.throws(() => parseArgs(['--prompt']), /requires a value/);
  assert.throws(() => parseArgs(['--wat']), /Unknown option/);
  assert.throws(
    () => parseArgs(['--prompt', 'p', '--code', 'c', '--port', '70000']),
    /between 1 and 65535/
  );
});

test('requires a module attribute for FastAPI runtime', () => {
  assert.throws(() => parseArgs(['--prompt', 'intent.md', '--code', 'app', '--runtime', 'fastapi']), /--fastapi-app/);
  assert.throws(() => parseArgs(['--prompt', 'intent.md', '--code', 'app', '--fastapi-app', 'app.main:app']), /--runtime fastapi/);
  assert.deepEqual(parseArgs(['--prompt', 'intent.md', '--code', 'app', '--runtime', 'fastapi', '--fastapi-app', 'app.main:app']).runtime, 'fastapi');
});
