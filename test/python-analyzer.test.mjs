import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractFastApiContracts } from '../src/python-analyzer.mjs';

const __dirname = path.resolve();

import { EventEmitter } from 'node:events';

test('extractFastApiContracts', async (t) => {
  await t.test('invokes only the resolved repository helper with source via stdin', async () => {
    let spawnArgs = null;
    let stdinData = '';

    const fakeChild = new EventEmitter();
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    fakeChild.stdin = {
      write: (data) => { stdinData += data; },
      end: () => {
        fakeChild.stdout.emit('data', JSON.stringify({ units: [], routes: [], diagnostics: [] }));
        fakeChild.emit('close', 0);
      }
    };

    const fakeSpawn = (command, args) => {
      spawnArgs = { command, args };
      return fakeChild;
    };

    const files = [{ path: 'test.py', source: 'def test(): pass' }];
    await extractFastApiContracts({ files }, fakeSpawn);

    assert.equal(spawnArgs.command, 'python3');
    assert.equal(spawnArgs.args.length, 1);
    assert.ok(spawnArgs.args[0].endsWith('scripts/extract-fastapi.py'), 'Must run exactly the repository helper script');

    // Check that source is passed exactly via stdin
    const parsedStdin = JSON.parse(stdinData);
    assert.deepEqual(parsedStdin, { files });
  });

  await t.test('extracts route info and exception handlers from valid python file', async () => {
    const files = [
      {
        path: 'app/main.py',
        source: readFileSync(path.join(__dirname, 'test/fixtures/fastapi-basic/app/main.py'), 'utf-8')
      },
      {
        path: 'app/invalid.py',
        source: readFileSync(path.join(__dirname, 'test/fixtures/fastapi-basic/app/invalid.py'), 'utf-8')
      },
      {
        path: 'app/api_route.py',
        source: readFileSync(path.join(__dirname, 'test/fixtures/fastapi-basic/app/api_route.py'), 'utf-8')
      }
    ];

    const result = await extractFastApiContracts({ files });

    // Valid file tests
    const validRoutes = result.routes.filter(r => r.file === 'app/main.py');
    assert.equal(validRoutes.length, 2); // 1 route, 1 exception handler

    const itemRoute = validRoutes.find(r => r.path === '/items/{item_id}');
    assert.ok(itemRoute);
    assert.equal(itemRoute.file, 'app/main.py');
    assert.deepEqual(itemRoute.methods, ['GET']);
    assert.equal(itemRoute.responseModel, 'Item');
    assert.equal(itemRoute.requestModel, 'Item'); // from item: Item in signature
    assert.equal(itemRoute.statusCode, 200);
    assert.deepEqual(itemRoute.dependencies, ['get_db']);
    assert.equal(itemRoute.lineStart, 12);

    const excRoute = validRoutes.find(r => r.exceptionHandler);
    assert.ok(excRoute);
    assert.equal(excRoute.exceptionHandler, '404');

    // Invalid file tests
    assert.equal(result.diagnostics.length, 1);
    const diag = result.diagnostics[0];
    assert.equal(diag.file, 'app/invalid.py');
    assert.ok(diag.message.includes('SyntaxError'));

    // api_route tests
    const mixedRoute = result.routes.find(r => r.path === '/mixed');
    assert.ok(mixedRoute);
    assert.equal(mixedRoute.file, 'app/api_route.py');
    assert.deepEqual(mixedRoute.methods, ['GET', 'POST']);
    assert.deepEqual(mixedRoute.dependencies, ['verify_token']);
  });
});
