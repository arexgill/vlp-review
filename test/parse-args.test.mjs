import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, usage } from '../src/parse-args.mjs';

test('parses required paths and optional flags', () => {
  assert.deepEqual(
    parseArgs(['--prompt', 'prompt.md', '--code', 'src', '--port', '4400', '--no-open']),
    { promptPath: 'prompt.md', codePath: 'src', port: 4400, open: false, help: false }
  );
});

test('defaults to port 4317 and opens the browser', () => {
  assert.deepEqual(
    parseArgs(['--prompt', 'prompt.md', '--code', 'app.ts']),
    { promptPath: 'prompt.md', codePath: 'app.ts', port: 4317, open: true, help: false }
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
