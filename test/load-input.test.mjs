import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadInput } from '../src/load-input.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'vlp-input-'));
  await writeFile(path.join(root, 'prompt.md'), 'Build a typed search function.');
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = () => 1;');
  await writeFile(path.join(root, 'src', 'b.ts'), 'export const b = (): number => 2;');
  await writeFile(path.join(root, 'src', 'note.txt'), 'ignore me');
  await mkdir(path.join(root, 'src', 'node_modules'));
  await writeFile(path.join(root, 'src', 'node_modules', 'ignored.js'), 'bad();');
  return root;
}

test('loads prompt and discovers supported files deterministically', async () => {
  const root = await fixture();
  const input = await loadInput({
    promptPath: path.join(root, 'prompt.md'),
    codePath: path.join(root, 'src')
  });
  assert.equal(input.prompt, 'Build a typed search function.');
  assert.deepEqual(input.sources.map(source => source.path), ['a.js', 'b.ts']);
  assert.deepEqual(input.sources.map(source => source.language), ['javascript', 'typescript']);
});

test('accepts one supported source file', async () => {
  const root = await fixture();
  const input = await loadInput({
    promptPath: path.join(root, 'prompt.md'),
    codePath: path.join(root, 'src', 'a.js')
  });
  assert.deepEqual(input.sources.map(source => source.path), ['a.js']);
});

test('rejects unsupported and empty code inputs', async () => {
  const root = await fixture();
  await assert.rejects(
    loadInput({ promptPath: path.join(root, 'prompt.md'), codePath: path.join(root, 'src', 'note.txt') }),
    /Supported extensions/
  );
  const empty = path.join(root, 'empty');
  await mkdir(empty);
  await assert.rejects(
    loadInput({ promptPath: path.join(root, 'prompt.md'), codePath: empty }),
    /No supported source files/
  );
});
