import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';

test('extract-fastapi.py adheres to strict static safety rules', () => {
  const scriptPath = path.resolve('scripts/extract-fastapi.py');
  const source = readFileSync(scriptPath, 'utf8');

  const astCheckCode = `
import ast
import sys
import json

with open(sys.argv[1], 'r', encoding='utf-8') as f:
    source = f.read()

tree = ast.parse(source)

imports = []
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        for alias in node.names:
            imports.append(f"import {alias.name}")
    elif isinstance(node, ast.ImportFrom):
        module = node.module or ''
        imports.append(f"from {module}")

print(json.dumps(list(set(imports))))
`;

  const astResult = spawnSync('python3', ['-c', astCheckCode, scriptPath], { encoding: 'utf8' });
  const actualImports = JSON.parse(astResult.stdout).sort();

  assert.deepEqual(
    actualImports,
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
  assert.equal(out.routes.length, 1); // No synthetic cyclic route should be emitted

  const paths = out.routes.map(r => r.path).sort();
  // We should have exactly the path starting from root.
  assert.equal(paths[0], '/root/a/to_b/b/item');
});
