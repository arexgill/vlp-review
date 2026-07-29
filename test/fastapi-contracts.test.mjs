import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFastApiContracts } from '../src/fastapi-contracts.mjs';

test('produces method-drift question when static GET vs runtime POST', () => {
  const staticContracts = [{
    file: 'main.py',
    lineStart: 10,
    path: '/items/{item_id}',
    methods: ['GET']
  }];
  const openapi = {
    paths: {
      '/items/{item_id}': {
        post: { operationId: 'create_item' }
      }
    }
  };
  
  const result = compareFastApiContracts({ prompt: '', staticContracts, openapi });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'method-drift');
  assert.equal(result[0].promptEvidence, 'main.py:10');
  assert.equal(result[0].docUnitIds[0], 'openapi:/items/{item_id}');
});

test('produces schema-drift question when response status/model mismatch', () => {
  const staticContracts = [{
    file: 'main.py',
    lineStart: 12,
    path: '/items/{item_id}',
    methods: ['GET'],
    statusCode: 200,
    responseModel: 'Item'
  }];
  const openapi = {
    paths: {
      '/items/{item_id}': {
        get: {
          responses: {
            '201': { description: 'Created' }
          }
        }
      }
    }
  };
  
  const result = compareFastApiContracts({ prompt: '', staticContracts, openapi });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'schema-drift');
  assert.equal(result[0].promptEvidence, 'main.py:12');
  assert.equal(result[0].docUnitIds[0], 'openapi:/items/{item_id}:get');
});

test('produces safe runtime-diagnostic question on docker diagnostic', () => {
  const result = compareFastApiContracts({ prompt: '', staticContracts: [], openapi: null, diagnostic: 'Docker failed to start safely' });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'runtime-diagnostic');
  assert.equal(result[0].docUnitIds[0], 'diagnostic:docker');
});

test('produces no questions when matching contract', () => {
  const staticContracts = [{
    file: 'main.py',
    lineStart: 12,
    path: '/items/{item_id}',
    methods: ['GET'],
    statusCode: 200,
    responseModel: 'Item'
  }];
  const openapi = {
    paths: {
      '/items/{item_id}': {
        get: {
          responses: {
            '200': { 
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Item' }
                }
              }
            }
          }
        }
      }
    }
  };
  
  const result = compareFastApiContracts({ prompt: '', staticContracts, openapi });
  assert.equal(result.length, 0);
});
