import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';

test('extract-fastapi.py adheres to strict static safety rules', () => {
  const scriptPath = path.resolve('scripts/extract-fastapi.py');
  const source = readFileSync(scriptPath, 'utf8');

  // Import allowlist: only ast, json, sys.
  // We strictly check that no other imports exist.
  const importLines = source.split('\n').filter(line => line.startsWith('import ') || line.startsWith('from '));
  assert.deepEqual(
    importLines.sort(),
    ['import ast', 'import json', 'import sys'],
    'Only ast, json, and sys may be imported'
  );

  // Absence of restricted built-ins and modules
  const restrictedKeywords = [
    '__import__', 'importlib', 'exec', 'eval', 'subprocess'
  ];

  const violations = [];
  for (const kw of restrictedKeywords) {
    if (new RegExp(`\\b${kw}\\b`).test(source)) {
      violations.push(kw);
    }
  }

  assert.equal(violations.length, 0, `Script contains restricted mechanisms: ${violations.join(', ')}`);
});

test('extract-fastapi.py extracts routers, prefix composition, and distinguishes body models', () => {
  const code = `
from fastapi import APIRouter, FastAPI
from typing import List

app = FastAPI()
items_router = APIRouter(prefix="/items")
api_router = APIRouter(prefix="/api")

api_router.include_router(items_router, prefix="/v1")
app.include_router(api_router, prefix="/root")

class Item: pass

@items_router.get("/{item_id}")
def get_item(item_id: int, q: str = None, item: Item = None, items: List[Item] = None):
    """Get an item"""
    pass
`;

  const inputData = {
    files: [
      { path: "main.py", source: code }
    ]
  };

  const scriptPath = path.resolve('scripts/extract-fastapi.py');
  const result = spawnSync('python3', [scriptPath], {
    input: JSON.stringify(inputData),
    encoding: 'utf8'
  });

  const out = JSON.parse(result.stdout);

  assert.equal(out.routes.length, 1);
  const route = out.routes[0];
  assert.equal(route.path, '/root/api/v1/items/{item_id}');
  assert.equal(route.requestModel, 'Item');

  assert.equal(out.units.length, 1);
  assert.equal(out.units[0].content, 'Get an item');
});

test('extract-fastapi.py handles recursive inclusion cycles safely', () => {
  const code = `
from fastapi import APIRouter, FastAPI

app = FastAPI()
router_a = APIRouter(prefix="/a")
router_b = APIRouter(prefix="/b")

router_a.include_router(router_b, prefix="/to_b")
router_b.include_router(router_a, prefix="/to_a")
app.include_router(router_a, prefix="/root")

@router_b.get("/item")
def get_b():
    pass
`;

  const inputData = {
    files: [
      { path: "main.py", source: code }
    ]
  };

  const scriptPath = path.resolve('scripts/extract-fastapi.py');
  const result = spawnSync('python3', [scriptPath], {
    input: JSON.stringify(inputData),
    encoding: 'utf8'
  });

  const out = JSON.parse(result.stdout);
  assert.equal(out.routes.length, 2); // It yields multiple paths due to the branches: B -> A -> app, B -> A -> B (cycle)

  const paths = out.routes.map(r => r.path).sort();
  // We should have at least the path starting from root.
  assert.ok(paths.includes('/root/a/to_b/b/item'));
  // And due to the cycle B -> A -> B (which terminates at B returning "B's base"), it might also generate:
  // /a/to_a/b/to_b/b/item or similar, depending on how visited set treats the root.
  // We just assert it doesn't crash and has the valid root path.
});
