import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFastApiOpenApi } from '../src/fastapi-runtime.mjs';

test('collectFastApiOpenApi', async (t) => {
  await t.test('generates correct docker arguments', async () => {
    let capturedArgs = [];
    const runDocker = async (args) => {
      capturedArgs = args;
      return { stdout: '{"paths": {}}', stderr: '', exitCode: 0 };
    };

    const result = await collectFastApiOpenApi({
      codePath: '/fake/code',
      appTarget: 'app.main:app',
      runDocker,
      timeoutMs: 5000,
    });

    assert.ok(result.openapi);
    assert.equal(result.diagnostic, null);
    assert.deepEqual(result.openapi, { paths: {} });

    // Assert docker arguments
    assert.equal(capturedArgs[0], 'run');
    assert.equal(capturedArgs.includes('--network=none'), true);
    assert.equal(capturedArgs.includes('--read-only'), true);
    assert.equal(capturedArgs.includes('--tmpfs=/tmp'), true);
    assert.equal(capturedArgs.includes('--cpus=1'), true);
    assert.equal(capturedArgs.includes('--memory=512m'), true);
    assert.equal(capturedArgs.includes('--pids-limit=50'), true);
    assert.equal(capturedArgs.includes('--rm'), true);
    assert.equal(capturedArgs.includes('-v'), true);
    // Find volume mount for codePath
    const vIndex = capturedArgs.indexOf('-v');
    const mountArg = capturedArgs[vIndex + 1];
    assert.ok(mountArg.startsWith('/fake/code:'));
    assert.ok(mountArg.endsWith(':ro'));
    
    // Explicit fixed image
    assert.equal(capturedArgs.includes('python:3.11-slim'), true);
  });

  await t.test('maps invalid JSON to safe diagnostic', async () => {
    const runDocker = async (args) => {
      return { stdout: 'invalid json', stderr: '', exitCode: 0 };
    };

    const result = await collectFastApiOpenApi({
      codePath: '/fake',
      appTarget: 'app:app',
      runDocker,
      timeoutMs: 5000,
    });

    assert.equal(result.openapi, null);
    assert.ok(result.diagnostic);
    assert.equal(result.diagnostic.type, 'invalid_json');
  });

  await t.test('maps nonzero exit to safe diagnostic', async () => {
    const runDocker = async (args) => {
      return { stdout: '', stderr: 'error msg', exitCode: 1 };
    };

    const result = await collectFastApiOpenApi({
      codePath: '/fake',
      appTarget: 'app:app',
      runDocker,
      timeoutMs: 5000,
    });

    assert.equal(result.openapi, null);
    assert.ok(result.diagnostic);
    assert.equal(result.diagnostic.type, 'docker_error');
    assert.equal(result.diagnostic.message, 'Docker process exited with code 1');
  });

  await t.test('maps timeout to safe diagnostic', async () => {
    const runDocker = async (args) => {
      const err = new Error('Timeout');
      err.name = 'AbortError';
      throw err;
    };

    const result = await collectFastApiOpenApi({
      codePath: '/fake',
      appTarget: 'app:app',
      runDocker,
      timeoutMs: 5000,
    });

    assert.equal(result.openapi, null);
    assert.ok(result.diagnostic);
    assert.equal(result.diagnostic.type, 'timeout');
  });

  await t.test('maps Docker absence to safe diagnostic', async () => {
    const runDocker = async (args) => {
      const err = new Error('spawn docker ENOENT');
      err.code = 'ENOENT';
      throw err;
    };

    const result = await collectFastApiOpenApi({
      codePath: '/fake',
      appTarget: 'app:app',
      runDocker,
      timeoutMs: 5000,
    });

    assert.equal(result.openapi, null);
    assert.ok(result.diagnostic);
    assert.equal(result.diagnostic.type, 'docker_absence');
  });

  await t.test('enforces object paths structure', async () => {
    const runDocker = async (args) => {
      return { stdout: '{"openapi": "3.0.0"}', stderr: '', exitCode: 0 };
    };

    const result = await collectFastApiOpenApi({
      codePath: '/fake',
      appTarget: 'app:app',
      runDocker,
      timeoutMs: 5000,
    });

    assert.equal(result.openapi, null);
    assert.ok(result.diagnostic);
    assert.equal(result.diagnostic.type, 'invalid_openapi');
  });

  await t.test('maps oversized output to safe diagnostic', async () => {
    const runDocker = async (args) => {
      // 11 MB of output
      const largeString = 'a'.repeat(11 * 1024 * 1024);
      return { stdout: largeString, stderr: '', exitCode: 0 };
    };

    const result = await collectFastApiOpenApi({
      codePath: '/fake',
      appTarget: 'app:app',
      runDocker,
      timeoutMs: 5000,
    });

    assert.equal(result.openapi, null);
    assert.ok(result.diagnostic);
    assert.equal(result.diagnostic.type, 'oversized_output');
  });
});
