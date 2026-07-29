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
  assert.deepEqual(result[0].sourceEvidence, { file: 'main.py', lineStart: 10, target: '/items/{item_id}' });
  assert.equal(result[0].runtimeEvidence.type, 'openapi-drift');
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
  assert.deepEqual(result[0].sourceEvidence, { file: 'main.py', lineStart: 12, target: '/items/{item_id}' });
  assert.equal(result[0].runtimeEvidence.type, 'openapi-drift');
});

test('produces safe runtime-diagnostic question on docker diagnostic', () => {
  const result = compareFastApiContracts({ prompt: '', staticContracts: [], openapi: null, diagnostic: 'Docker failed to start safely' });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'runtime-diagnostic');
  assert.equal(result[0].runtimeEvidence.message, 'Docker failed to start safely');
});

test('produces missing-route question when static route is absent from openapi', () => {
  const staticContracts = [{
    file: 'main.py',
    lineStart: 10,
    path: '/users',
    methods: ['GET']
  }];
  const openapi = {
    paths: {
      '/items': { get: {} }
    }
  };

  const result = compareFastApiContracts({ prompt: '', staticContracts, openapi });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'missing-route');
  assert.deepEqual(result[0].sourceEvidence, { file: 'main.py', lineStart: 10, target: '/users' });
  assert.equal(result[0].runtimeEvidence.type, 'openapi-missing');
});

test('produces path-drift question when variable names differ', () => {
  const staticContracts = [{
    file: 'main.py',
    lineStart: 10,
    path: '/items/{item_id}',
    methods: ['GET']
  }];
  const openapi = {
    paths: {
      '/items/{id}': { get: {} }
    }
  };

  const result = compareFastApiContracts({ prompt: '', staticContracts, openapi });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'path-drift');
  assert.deepEqual(result[0].sourceEvidence, { file: 'main.py', lineStart: 10, target: '/items/{item_id}' });
  assert.equal(result[0].runtimeEvidence.type, 'openapi-drift');
  assert.equal(result[0].runtimeEvidence.actual, '/items/{id}');
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
            '200': { schemaRef: '#/components/schemas/Item' }
          }
        }
      }
    }
  };

  const result = compareFastApiContracts({ prompt: '', staticContracts, openapi });
  assert.equal(result.length, 0);
});
