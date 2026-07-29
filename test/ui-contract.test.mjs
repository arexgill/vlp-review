import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function publicFiles() {
  const [html, css, js] = await Promise.all([
    readFile(path.join(root, 'public', 'index.html'), 'utf8'),
    readFile(path.join(root, 'public', 'styles.css'), 'utf8'),
    readFile(path.join(root, 'public', 'app.js'), 'utf8')
  ]);
  return { html, css, js };
}

test('contains every required review control and safe asset reference', async () => {
  const { html } = await publicFiles();
  const ids = [
    'app-status', 'session-stats', 'prompt-content', 'source-select', 'source-code',
    'doc-list', 'diagnostic-list', 'review-progress', 'question-card', 'question-title',
    'question-reason', 'prompt-evidence', 'code-evidence', 'correction-text',
    'accept-button', 'correct-button', 'irrelevant-button', 'previous-button',
    'next-button', 'finish-button', 'report-panel', 'report-output', 'copy-report',
    'download-report', 'runtime-block', 'runtime-disclosure', 'runtime-list'
  ];
  ids.forEach(id => assert.match(html, new RegExp(`id="${id}"`), `Missing #${id}`));
  assert.match(html, /href="\/styles\.css"/);
  assert.match(html, /src="\/app\.js"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)/);
  const buttons = html.match(/<button\b[^>]*>/g) || [];
  assert.ok(buttons.length >= 8);
  buttons.forEach(button => assert.match(button, /type="button"/));
});

test('implements local session, decisions, persistence, and safe rendering', async () => {
  const { js } = await publicFiles();
  assert.match(js, /\/api\/session/);
  assert.match(js, /\/api\/report/);
  assert.match(js, /'accept'/);
  assert.match(js, /'correct'/);
  assert.match(js, /'irrelevant'/);
  assert.match(js, /localStorage/);
  assert.match(js, /textContent/);
  assert.doesNotMatch(js, /innerHTML/);
});

test('styles a responsive accessible review console and labels the research limits', async () => {
  const { html, css } = await publicFiles();
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(html, /28\.7%–73\.2%/);
  assert.match(html, /65\.4%–93\.5%/);
  assert.match(html, /arXiv:2607\.02333v1/);
  assert.match(html, /not the full research implementation/i);
});
