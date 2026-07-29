import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFastApiOpenApi } from '../src/fastapi-runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function withTempDir(fn) {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fastapi-test-'));
  try {
    await fn(tmp);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}

test('collectFastApiOpenApi', async (t) => {
  await t.test('generates correct docker arguments', async () => {
    await withTempDir(async (tmp) => {
      await fs.promises.writeFile(path.join(tmp, 'requirements.txt'), 'fastapi\nuvicorn\n');

      let buildArgs = [];
      let runArgs = [];
      let rmiArgs = [];
      let inputReceived = '';

      const runDocker = async (args, options = {}) => {
        if (args[0] === 'build') {
          buildArgs = args;
          inputReceived = options.input;
          return { stdout: 'fake-image-id\n', stderr: '', exitCode: 0 };
        } else if (args[0] === 'run') {
          runArgs = args;
          return { stdout: '{"paths": {}}', stderr: '', exitCode: 0 };
        } else if (args[0] === 'rmi') {
          rmiArgs = args;
          return { stdout: '', stderr: '', exitCode: 0 };
        }
      };

      const result = await collectFastApiOpenApi({
        codePath: tmp,
        appTarget: 'app.main:app',
        runDocker,
        timeoutMs: 5000,
      });

      assert.equal(result.diagnostic, null);
      assert.deepEqual(result.openapi, { paths: {} });

      // Assert build
      assert.deepEqual(buildArgs, ['build', '-q', '-']);
      assert.ok(inputReceived.includes('FROM python:3.11-slim'));
      assert.ok(inputReceived.includes(Buffer.from('fastapi\nuvicorn\n').toString('base64')));

      // Assert run
      assert.equal(runArgs[0], 'run');
      assert.equal(runArgs.includes('--network=none'), true);
      assert.equal(runArgs.includes('--read-only'), true);
      assert.equal(runArgs.includes('--tmpfs=/tmp'), true);
      assert.equal(runArgs.includes('--cpus=1'), true);
      assert.equal(runArgs.includes('--memory=512m'), true);
      assert.equal(runArgs.includes('--pids-limit=50'), true);
      assert.equal(runArgs.includes('--rm'), true);
      assert.equal(runArgs.includes('-e'), true);
      assert.equal(runArgs.includes('PYTHONPATH=/deps'), true);
      assert.equal(runArgs.includes('fake-image-id'), true);
      
      const vIndex = runArgs.indexOf('-v');
      const mountArg = runArgs[vIndex + 1];
      assert.ok(mountArg.startsWith(`${tmp}:`));
      assert.ok(mountArg.endsWith(':ro'));

      // Assert cleanup
      assert.deepEqual(rmiArgs, ['rmi', '-f', 'fake-image-id']);
    });
  });

  await t.test('maps missing manifest to safe diagnostic', async () => {
    await withTempDir(async (tmp) => {
      const result = await collectFastApiOpenApi({
        codePath: tmp, // No requirements.txt
        appTarget: 'app:app',
        runDocker: async () => {},
        timeoutMs: 5000,
      });

      assert.equal(result.openapi, null);
      assert.ok(result.diagnostic);
      assert.equal(result.diagnostic.type, 'missing_manifest');
    });
  });

  await t.test('maps invalid JSON to safe diagnostic', async () => {
    await withTempDir(async (tmp) => {
      await fs.promises.writeFile(path.join(tmp, 'requirements.txt'), '');
      const runDocker = async (args) => {
        if (args[0] === 'build') return { stdout: 'img', exitCode: 0 };
        if (args[0] === 'run') return { stdout: 'invalid json', stderr: '', exitCode: 0 };
        return { exitCode: 0 };
      };

      const result = await collectFastApiOpenApi({
        codePath: tmp,
        appTarget: 'app:app',
        runDocker,
        timeoutMs: 5000,
      });

      assert.equal(result.openapi, null);
      assert.ok(result.diagnostic);
      assert.equal(result.diagnostic.type, 'invalid_json');
    });
  });

  await t.test('maps nonzero exit to safe diagnostic', async () => {
    await withTempDir(async (tmp) => {
      await fs.promises.writeFile(path.join(tmp, 'requirements.txt'), '');
      const runDocker = async (args) => {
        if (args[0] === 'build') return { stdout: 'img', exitCode: 0 };
        if (args[0] === 'run') return { stdout: '', stderr: 'error msg', exitCode: 1 };
        return { exitCode: 0 };
      };

      const result = await collectFastApiOpenApi({
        codePath: tmp,
        appTarget: 'app:app',
        runDocker,
        timeoutMs: 5000,
      });

      assert.equal(result.openapi, null);
      assert.ok(result.diagnostic);
      assert.equal(result.diagnostic.type, 'docker_error');
      assert.equal(result.diagnostic.message, 'Docker process exited with code 1');
    });
  });

  await t.test('maps timeout to safe diagnostic', async () => {
    await withTempDir(async (tmp) => {
      await fs.promises.writeFile(path.join(tmp, 'requirements.txt'), '');
      const runDocker = async (args) => {
        if (args[0] === 'build') return { stdout: 'img', exitCode: 0 };
        if (args[0] === 'run') {
          const err = new Error('Timeout');
          err.name = 'AbortError';
          throw err;
        }
        return { exitCode: 0 };
      };

      const result = await collectFastApiOpenApi({
        codePath: tmp,
        appTarget: 'app:app',
        runDocker,
        timeoutMs: 5000,
      });

      assert.equal(result.openapi, null);
      assert.ok(result.diagnostic);
      assert.equal(result.diagnostic.type, 'timeout');
    });
  });

  await t.test('maps Docker absence to safe diagnostic', async () => {
    await withTempDir(async (tmp) => {
      await fs.promises.writeFile(path.join(tmp, 'requirements.txt'), '');
      const runDocker = async (args) => {
        const err = new Error('spawn docker ENOENT');
        err.code = 'ENOENT';
        throw err;
      };

      const result = await collectFastApiOpenApi({
        codePath: tmp,
        appTarget: 'app:app',
        runDocker,
        timeoutMs: 5000,
      });

      assert.equal(result.openapi, null);
      assert.ok(result.diagnostic);
      assert.equal(result.diagnostic.type, 'docker_absence');
    });
  });

  await t.test('enforces object paths structure', async () => {
    await withTempDir(async (tmp) => {
      await fs.promises.writeFile(path.join(tmp, 'requirements.txt'), '');
      const runDocker = async (args) => {
        if (args[0] === 'build') return { stdout: 'img', exitCode: 0 };
        if (args[0] === 'run') return { stdout: '{"openapi": "3.0.0"}', stderr: '', exitCode: 0 };
        return { exitCode: 0 };
      };

      const result = await collectFastApiOpenApi({
        codePath: tmp,
        appTarget: 'app:app',
        runDocker,
        timeoutMs: 5000,
      });

      assert.equal(result.openapi, null);
      assert.ok(result.diagnostic);
      assert.equal(result.diagnostic.type, 'invalid_openapi');
    });
  });

  await t.test('maps oversized output to safe diagnostic', async () => {
    await withTempDir(async (tmp) => {
      await fs.promises.writeFile(path.join(tmp, 'requirements.txt'), '');
      const runDocker = async (args) => {
        if (args[0] === 'build') return { stdout: 'img', exitCode: 0 };
        if (args[0] === 'run') return { overflow: true };
        return { exitCode: 0 };
      };

      const result = await collectFastApiOpenApi({
        codePath: tmp,
        appTarget: 'app:app',
        runDocker,
        timeoutMs: 5000,
      });

      assert.equal(result.openapi, null);
      assert.ok(result.diagnostic);
      assert.equal(result.diagnostic.type, 'oversized_output');
    });
  });

  await t.test('redacts raw build stderr output to stable safe message', async () => {
    await withTempDir(async (tmp) => {
      await fs.promises.writeFile(path.join(tmp, 'requirements.txt'), '');
      const runDocker = async (args) => {
        if (args[0] === 'build') {
          return { stdout: '', stderr: 'SENSITIVE SECRET RAW ERROR DUMP', exitCode: 1 };
        }
        return { exitCode: 0 };
      };

      const result = await collectFastApiOpenApi({
        codePath: tmp,
        appTarget: 'app:app',
        runDocker,
        timeoutMs: 5000,
      });

      assert.equal(result.openapi, null);
      assert.ok(result.diagnostic);
      assert.equal(result.diagnostic.type, 'build_error');
      assert.equal(result.diagnostic.message, 'Sandbox build rejected dependencies');
      assert.ok(!result.diagnostic.message.includes('SENSITIVE'));
    });
  });
});
