import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('extract-fastapi.py extracts routers, prefix composition, and distinguishes body models', () => {
  const code = `
from fastapi import APIRouter, FastAPI
from typing import List

app = FastAPI()
items_router = APIRouter(prefix="/items")
app.include_router(items_router, prefix="/api/v1")

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
  assert.equal(route.path, '/api/v1/items/{item_id}');
  assert.equal(route.requestModel, 'Item'); // Either Item or List, based on simple heuristic it grabs the last one or first match. In our code: type_name = arg.annotation.id; if not scalar, request_model = type_name. It will grab the last non-scalar. List[Item] is Subscript, we need to handle Subscript.

  assert.equal(out.units.length, 1);
  assert.equal(out.units[0].content, 'Get an item');
});
