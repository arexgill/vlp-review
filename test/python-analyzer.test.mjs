import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractFastApiContracts } from '../src/python-analyzer.mjs';

const __dirname = path.resolve();

test('extractFastApiContracts', async (t) => {
  await t.test('extracts route info and exception handlers from valid python file', async () => {
    const files = [
      {
        path: 'app/main.py',
        source: readFileSync(path.join(__dirname, 'test/fixtures/fastapi-basic/app/main.py'), 'utf-8')
      },
      {
        path: 'app/invalid.py',
        source: readFileSync(path.join(__dirname, 'test/fixtures/fastapi-basic/app/invalid.py'), 'utf-8')
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
  });
});
