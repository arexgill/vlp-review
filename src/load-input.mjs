import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const MAX_FILES = 200;
const MAX_BYTES = 1024 * 1024;

function languageFor(filePath) {
  return ['.ts', '.tsx'].includes(path.extname(filePath).toLowerCase())
    ? 'typescript'
    : 'javascript';
}

async function discover(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORED.has(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await discover(fullPath));
    if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      paths.push(fullPath);
    }
  }

  return paths;
}

export async function loadInput({ promptPath, codePath }) {
  const absolutePrompt = path.resolve(promptPath);
  const absoluteCode = path.resolve(codePath);
  const prompt = await readFile(absolutePrompt, 'utf8');
  const codeStat = await stat(absoluteCode);

  if (!codeStat.isDirectory() && !EXTENSIONS.has(path.extname(absoluteCode).toLowerCase())) {
    throw new Error('Unsupported code file. Supported extensions: .js, .mjs, .cjs, .jsx, .ts, .tsx');
  }

  const files = codeStat.isDirectory() ? await discover(absoluteCode) : [absoluteCode];
  if (files.length === 0) throw new Error('No supported source files were found');
  if (files.length > MAX_FILES) {
    throw new Error(`Source limit exceeded: ${files.length} files; maximum is ${MAX_FILES}`);
  }

  const codeRoot = codeStat.isDirectory() ? absoluteCode : path.dirname(absoluteCode);
  const sources = [];
  for (const filePath of files) {
    const fileStat = await stat(filePath);
    if (fileStat.size > MAX_BYTES) {
      throw new Error(`Source file exceeds 1 MiB: ${path.relative(codeRoot, filePath)}`);
    }
    sources.push({
      path: path.relative(codeRoot, filePath).split(path.sep).join('/'),
      language: languageFor(filePath),
      content: await readFile(filePath, 'utf8')
    });
  }

  return { promptPath: absolutePrompt, prompt, codeRoot, sources };
}
