import test from 'node:test';
import assert from 'node:assert/strict';
import { browserCommand } from '../src/open-browser.mjs';

test('selects a safe platform browser command', () => {
  assert.deepEqual(browserCommand('http://127.0.0.1:4317', 'darwin'), {
    command: 'open', args: ['http://127.0.0.1:4317']
  });
  assert.deepEqual(browserCommand('http://127.0.0.1:4317', 'linux'), {
    command: 'xdg-open', args: ['http://127.0.0.1:4317']
  });
  assert.deepEqual(browserCommand('http://127.0.0.1:4317', 'win32'), {
    command: 'cmd', args: ['/c', 'start', '', 'http://127.0.0.1:4317']
  });
});
