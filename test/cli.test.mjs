import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'vlp-review.mjs');

function runCli(args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

async function runCliUntil(args, { env = process.env, until, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    let stopping = false;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      stopping = true;
      child.kill('SIGTERM');
      settled = true;
      reject(new Error(`CLI startup timed out. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);

    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!until || stopping) return;
      try {
        if (until({ stdout, stderr })) {
          stopping = true;
          child.kill('SIGTERM');
        }
      } catch (error) {
        stopping = true;
        child.kill('SIGTERM');
        finish(reject)(error);
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', finish(reject));
    child.once('close', code => {
      if (stopping) {
        finish(resolve)({ code, stdout, stderr });
        return;
      }
      finish(reject)(new Error(`CLI exited before expected output (${code}). stdout=${stdout} stderr=${stderr}`));
    });
  });
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startFakeReviewerServer() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const body = await new Promise((resolve, reject) => {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
    });
    const payload = JSON.parse(body);
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      payload
    });

    const input = JSON.parse(payload.messages.at(-1).content);
    const decisions = input.questions.map(question => ({
      questionId: question.id,
      decision: 'accept',
      answer: 'Confirmed by fake reviewer.',
      rationale: 'Test fixture approval.',
      confidence: 0.99,
      intentBasis: 'explicit-prompt',
      evidenceDocUnitIds: []
    }));

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: 'Fake reviewer completed successfully.',
            decisions
          })
        }
      }]
    }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();

  return {
    requests,
    url: `http://${HOST}:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    })
  };
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

test('runs agent review before printing the ready URL when auto-review is enabled', async () => {
  const fakeReviewer = await startFakeReviewerServer();
  const port = await reservePort();

  try {
    const result = await runCliUntil([
      '--prompt', 'examples/product-search/prompt.md',
      '--code', 'examples/product-search/generated-code.js',
      '--port', String(port),
      '--reviewer', 'openai-compatible',
      '--reviewer-model', 'test-model',
      '--reviewer-base-url', fakeReviewer.url,
      '--auto-review',
      '--no-open'
    ], {
      env: { ...process.env, VLP_REVIEWER_API_KEY: 'test-key' },
      until: ({ stdout }) => stdout.includes(`VLP review ready at http://${HOST}:${port}`) && /Agent review completed: (approved|needs-human)\./.test(stdout)
    });

    assert.equal(result.stderr, '');
    assert.match(result.stdout, /Running agent review/);
    assert.match(result.stdout, /Agent review completed: (approved|needs-human)\./);
    assert.match(result.stdout, new RegExp(`VLP review ready at http://${HOST}:${port}`));
    assert.ok(result.stdout.indexOf('Running agent review') < result.stdout.indexOf('Agent review completed:'));
    assert.ok(result.stdout.indexOf('Agent review completed:') < result.stdout.indexOf('VLP review ready at'));
    assert.equal(fakeReviewer.requests.length, 1);
    assert.equal(fakeReviewer.requests[0].method, 'POST');
    assert.equal(fakeReviewer.requests[0].url, '/chat/completions');
    assert.equal(fakeReviewer.requests[0].authorization, 'Bearer test-key');
  } finally {
    await fakeReviewer.close();
  }
});

test('prints reviewer setup guidance without blocking local startup when the API key is missing', async () => {
  const fakeReviewer = await startFakeReviewerServer();
  const port = await reservePort();
  const secret = 'super-secret-value';

  try {
    const result = await runCliUntil([
      '--prompt', 'examples/product-search/prompt.md',
      '--code', 'examples/product-search/generated-code.js',
      '--port', String(port),
      '--reviewer', 'openai-compatible',
      '--reviewer-model', 'test-model',
      '--reviewer-base-url', fakeReviewer.url,
      '--auto-review',
      '--no-open'
    ], {
      env: {
        ...process.env,
        SAFE_TEST_SECRET: secret,
        VLP_REVIEWER_API_KEY: ''
      },
      until: ({ stdout }) => stdout.includes(`VLP review ready at http://${HOST}:${port}`) && stdout.includes('Set VLP_REVIEWER_API_KEY before running agent review.')
    });

    assert.equal(result.stderr, '');
    assert.match(result.stdout, /Running agent review/);
    assert.match(result.stdout, /Agent review completed: failed\./);
    assert.match(result.stdout, /Set VLP_REVIEWER_API_KEY before running agent review\./);
    assert.match(result.stdout, new RegExp(`VLP review ready at http://${HOST}:${port}`));
    assert.doesNotMatch(result.stdout, new RegExp(secret));
    assert.doesNotMatch(result.stderr, new RegExp(secret));
    assert.equal(fakeReviewer.requests.length, 0);
  } finally {
    await fakeReviewer.close();
  }
});

test('starts a complete local review session with browser opening disabled', async () => {
  const port = await reservePort();
  const result = await runCliUntil([
    '--prompt', 'examples/product-search/prompt.md',
    '--code', 'examples/product-search/generated-code.js',
    '--port', String(port),
    '--no-open'
  ], {
    until: ({ stdout }) => stdout.includes(`VLP review ready at http://${HOST}:${port}`)
  });

  assert.match(result.stdout, /Loaded 1 source file\(s\), generated \d+ documentation unit\(s\), and prioritized \d+ question\(s\)/);
  assert.doesNotMatch(result.stdout, /generated 0 documentation/);
  assert.doesNotMatch(result.stdout, /prioritized 0 question/);
  assert.doesNotMatch(result.stdout, /Running agent review/);
});
