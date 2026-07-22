import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'vlp-review.mjs');

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

test('prints help and exits successfully', async () => {
  const result = await runCli(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /vlp-review --prompt <file> --code <file-or-directory>/);
  assert.equal(result.stderr, '');
});

test('prints a concise error when required flags are missing', async () => {
  const result = await runCli([]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Both --prompt and --code are required/);
  assert.match(result.stderr, /Use --help/);
});

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('starts a complete local review session with browser opening disabled', async () => {
  const port = await reservePort();
  const args = [
    cli,
    '--prompt', 'examples/product-search/prompt.md',
    '--code', 'examples/product-search/generated-code.js',
    '--port', String(port),
    '--no-open'
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI startup timed out. stdout=${stdout} stderr=${stderr}`));
    }, 5000);

    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.includes(`VLP review ready at http://127.0.0.1:${port}`)) {
        clearTimeout(timeout);
        try {
          assert.match(stdout, /Loaded 1 source file\(s\), generated \d+ documentation unit\(s\), and prioritized \d+ question\(s\)/);
          assert.doesNotMatch(stdout, /generated 0 documentation/);
          assert.doesNotMatch(stdout, /prioritized 0 question/);
          child.kill('SIGTERM');
          resolve();
        } catch (error) {
          child.kill('SIGTERM');
          reject(error);
        }
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', code => {
      if (!stdout.includes('VLP review ready at')) {
        clearTimeout(timeout);
        reject(new Error(`CLI exited before startup (${code}). stderr=${stderr}`));
      }
    });
  });
});
