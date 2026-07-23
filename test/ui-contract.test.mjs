import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_IDS = [
  'app-status', 'session-stats', 'privacy-badge', 'privacy-copy', 'reviewer-panel',
  'reviewer-mode', 'reviewer-disclosure', 'reviewer-status', 'reviewer-run-button',
  'prompt-content', 'source-select', 'source-code', 'doc-list', 'diagnostic-list',
  'review-progress', 'progress-fill', 'question-card', 'question-title', 'question-ask',
  'question-type', 'question-severity', 'question-reason', 'prompt-evidence',
  'code-evidence', 'agent-audit', 'agent-decision', 'agent-confidence', 'agent-intent',
  'agent-rationale', 'agent-escalation', 'correction-text', 'response-error',
  'accept-button', 'correct-button', 'irrelevant-button', 'previous-button',
  'next-button', 'finish-button', 'report-panel', 'report-output', 'copy-report',
  'download-report'
];

async function publicFiles() {
  const [html, css, js] = await Promise.all([
    readFile(path.join(root, 'public', 'index.html'), 'utf8'),
    readFile(path.join(root, 'public', 'styles.css'), 'utf8'),
    readFile(path.join(root, 'public', 'app.js'), 'utf8')
  ]);
  return { html, css, js };
}

function createSession() {
  return {
    id: 'session-1',
    prompt: 'Check the search behavior.',
    meta: { sourceCount: 1, docUnitCount: 2, questionCount: 2 },
    sources: [{
      path: 'search.js',
      content: 'function search(product) {\n  return product.title;\n}'
    }],
    docUnits: [
      {
        id: 'doc-1',
        file: 'search.js',
        lineStart: 2,
        kind: 'return',
        text: 'Returns product.title.',
        code: 'return product.title;'
      },
      {
        id: 'doc-2',
        file: 'search.js',
        lineStart: 2,
        kind: 'expression',
        text: 'Reads product.title.',
        code: 'product.title'
      }
    ],
    diagnostics: [],
    questions: [
      {
        id: 'q-1',
        type: 'missing-step',
        severity: 'high',
        title: 'Should description be searched?',
        ask: 'Does the implementation search the description too?',
        reason: 'Only title access is linked.',
        promptEvidence: 'Search title and description.',
        docUnitIds: ['doc-1']
      },
      {
        id: 'q-2',
        type: 'wrong-field',
        severity: 'medium',
        title: 'Should the title be returned?',
        ask: 'Is returning the title still required?',
        reason: 'The prompt explicitly asks for it.',
        promptEvidence: 'Return the title in the result.',
        docUnitIds: ['doc-2']
      }
    ]
  };
}

function createReadyReview() {
  return {
    status: 'ready',
    provider: 'openai-compatible',
    model: 'test-model',
    threshold: 0.8,
    startedAt: null,
    completedAt: null,
    summary: '',
    results: [],
    error: null
  };
}

function createNeedsHumanReview(overrides = {}) {
  return {
    status: 'needs-human',
    provider: 'openai-compatible',
    model: 'test-model',
    threshold: 0.8,
    startedAt: '2026-07-22T00:00:00.000Z',
    completedAt: '2026-07-22T00:00:01.000Z',
    summary: 'One answer needs a human.',
    results: [
      {
        questionId: 'q-1',
        status: 'escalated',
        proposedDecision: 'correct',
        effectiveDecision: null,
        answer: '',
        rationale: 'Low confidence for the description behavior.',
        confidence: 0.42,
        intentBasis: 'explicit-prompt',
        escalationReasons: ['confidence-below-threshold']
      },
      {
        questionId: 'q-2',
        status: 'approved',
        proposedDecision: 'accept',
        effectiveDecision: 'accept',
        answer: '',
        rationale: 'The title behavior matches the prompt.',
        confidence: 0.96,
        intentBasis: 'explicit-prompt',
        escalationReasons: []
      }
    ],
    error: null,
    ...overrides
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return new Set(String(this.element.className || '').split(/\s+/).filter(Boolean));
  }

  sync(values) {
    this.element.className = [...values].join(' ');
  }

  add(...tokens) {
    const values = this.values();
    tokens.forEach(token => values.add(token));
    this.sync(values);
  }

  remove(...tokens) {
    const values = this.values();
    tokens.forEach(token => values.delete(token));
    this.sync(values);
  }

  toggle(token, force) {
    const values = this.values();
    const shouldAdd = force === undefined ? !values.has(token) : force;
    if (shouldAdd) values.add(token);
    else values.delete(token);
    this.sync(values);
    return shouldAdd;
  }
}

class FakeElement {
  constructor(id = null, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.placeholder = '';
    this.type = '';
    this.download = '';
    this.href = '';
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this._textContent = '';
  }

  get textContent() {
    if (this.children.length > 0) return this.children.map(child => child.textContent || '').join('');
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  append(...nodes) {
    this._textContent = '';
    for (const node of nodes) {
      const child = typeof node === 'string' ? { textContent: node } : node;
      if (child && typeof child === 'object') child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }

  setAttribute(name, value) {
    if (name === 'class') {
      this.className = String(value);
      return;
    }
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      this.dataset[key] = String(value);
      return;
    }
    this[name] = String(value);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  focus() {}

  click() {
    const listener = this.listeners.get('click');
    if (listener) listener({ target: this });
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  scrollIntoView() {}

  querySelector(selector) {
    const match = selector.match(/^\[data-line="(.+)"\]$/);
    if (!match) return null;
    const line = match[1];
    const stack = [...this.children];
    while (stack.length > 0) {
      const node = stack.shift();
      if (node?.dataset?.line === line) return node;
      if (node?.children?.length) stack.unshift(...node.children);
    }
    return null;
  }
}

class FakeDocument {
  constructor(ids) {
    this.nodes = new Map(ids.map(id => [id, new FakeElement(id)]));
    this.body = new FakeElement('body', 'body');
  }

  getElementById(id) {
    return this.nodes.get(id) || null;
  }

  createElement(tagName) {
    return new FakeElement(null, tagName);
  }

  createTextNode(text) {
    return { textContent: String(text) };
  }
}

async function createAppHarness({ routes = {}, storage = {} } = {}) {
  const { js } = await publicFiles();
  const document = new FakeDocument(APP_IDS);
  const queueByRoute = new Map(Object.entries(routes).map(([key, value]) => [key, [...value]]));
  const fetchCalls = [];
  const timers = new Map();
  const store = new Map(Object.entries(storage));
  let nextTimerId = 1;

  const context = {
    console,
    document,
    Blob,
    navigator: { clipboard: { async writeText() {} } },
    URL: {
      createObjectURL() {
        return 'blob:mock';
      },
      revokeObjectURL() {}
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      }
    },
    fetch(url, options = {}) {
      const method = String(options.method || 'GET').toUpperCase();
      const key = `${method} ${url}`;
      fetchCalls.push({ key, url, options });
      const queue = queueByRoute.get(key) || [];
      assert.ok(queue.length > 0, `No mock response queued for ${key}`);
      const next = queue.shift();
      queueByRoute.set(key, queue);
      if (next instanceof Error) return Promise.reject(next);
      if (typeof next?.then === 'function') return next;
      if (typeof next === 'function') return Promise.resolve(next({ key, url, options }));
      return Promise.resolve(next);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  context.window = context;
  context.globalThis = context;

  const script = new vm.Script(`${js}\n;globalThis.__app = { state, humanResponses, effectiveReviewedCount, loadApp, fetchAgentReview, runAgentReview, renderAll, renderQuestion, syncAgentPolling, clearAgentPolling };`, {
    filename: 'public/app.js'
  });
  script.runInNewContext(context);

  async function flush() {
    for (let index = 0; index < 5; index += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  await flush();

  return {
    app: context.__app,
    get(id) {
      return document.getElementById(id);
    },
    fetchCalls,
    countCalls(key) {
      return fetchCalls.filter(call => call.key === key).length;
    },
    activeTimerCount() {
      return timers.size;
    },
    async runNextTimer() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'No timer queued');
      const [id, timer] = entry;
      timers.delete(id);
      await timer.callback();
      await flush();
    },
    flush,
    queueByRoute,
    store
  };
}

test('contains every required review control and safe asset reference', async () => {
  const { html } = await publicFiles();
  APP_IDS.filter(id => id !== 'progress-fill').forEach(id => {
    assert.match(html, new RegExp(`id="${id}"`), `Missing #${id}`);
  });
  assert.match(html, /href="\/styles\.css"/);
  assert.match(html, /src="\/app\.js"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)/);
  assert.match(html, /Remote agent mode sends the prompt and linked excerpts/);
  assert.doesNotMatch(html, /Nothing leaves localhost\./);
  const buttons = html.match(/<button\b[^>]*>/g) || [];
  assert.ok(buttons.length >= 8);
  buttons.forEach(button => assert.match(button, /type="button"/));
});

test('keeps responsive styling, research caveats, and text-only rendering', async () => {
  const { html, css, js } = await publicFiles();
  assert.match(css, /\.reviewer-panel/);
  assert.match(css, /\.review-status/);
  assert.match(css, /\.agent-audit/);
  assert.match(css, /\.remote-badge/);
  assert.match(css, /\.review-status\[data-state="approved"\]/);
  assert.match(css, /\.review-status\[data-state="needs-human"\]/);
  assert.match(css, /\.review-status\[data-state="failed"\]/);
  assert.match(css, /\.agent-audit\[data-status="approved"\]/);
  assert.match(css, /\.agent-audit\[data-status="escalated"\]/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(html, /28\.7%–73\.2%/);
  assert.match(html, /65\.4%–93\.5%/);
  assert.match(html, /arXiv:2607\.02333v1/);
  assert.match(html, /not the full research implementation/i);
  assert.doesNotMatch(js, /innerHTML/);
});

test('treats agent results as effective only for approved and needs-human, and clears stale rerun state', async () => {
  const post = createDeferred();
  const harness = await createAppHarness({
    routes: {
      'GET /api/session': [jsonResponse(createSession())],
      'GET /api/agent-review': [jsonResponse(createNeedsHumanReview())],
      'POST /api/agent-review': [post.promise]
    },
    storage: {
      'vlp-review:session-1': JSON.stringify([
        { questionId: 'q-1', decision: 'correct', answer: 'Search the description too.' }
      ])
    }
  });

  assert.equal(harness.app.humanResponses().length, 1);
  assert.equal(harness.app.effectiveReviewedCount(), 2);

  harness.app.state.agentReview = {
    ...createNeedsHumanReview(),
    status: 'running',
    completedAt: null
  };
  harness.app.state.questionIndex = 1;
  harness.app.renderQuestion();

  assert.equal(harness.app.humanResponses().length, 0);
  assert.equal(harness.app.effectiveReviewedCount(), 0);
  assert.equal(harness.get('accept-button').disabled, true);
  assert.doesNotMatch(harness.get('agent-decision').textContent, /approved automatically/);

  harness.app.state.agentReview = createNeedsHumanReview();
  harness.app.state.report = '# stale report';
  harness.get('report-output').textContent = '# stale report';
  harness.get('report-panel').hidden = false;

  const rerun = harness.app.runAgentReview();
  await harness.flush();

  assert.equal(harness.app.state.agentReview.status, 'running');
  assert.equal(harness.app.state.responses.size, 0);
  assert.equal(harness.app.state.report, '');
  assert.equal(harness.get('report-output').textContent, '');
  assert.equal(harness.get('report-panel').hidden, true);

  post.reject(new Error('POST dropped after accept'));
  await rerun;

  assert.equal(harness.app.state.agentReview.status, 'running');
  assert.equal(harness.activeTimerCount(), 1);
});

test('keeps running on GET sync failures, schedules one retry timer, and avoids duplicate run actions', async () => {
  const post = createDeferred();
  const harness = await createAppHarness({
    routes: {
      'GET /api/session': [jsonResponse(createSession())],
      'GET /api/agent-review': [jsonResponse(createReadyReview()), new Error('GET poll dropped')],
      'POST /api/agent-review': [post.promise]
    }
  });

  harness.app.state.agentReview = {
    ...createNeedsHumanReview(),
    status: 'running',
    completedAt: null
  };
  await harness.app.fetchAgentReview();

  assert.equal(harness.app.state.agentReview.status, 'running');
  assert.match(harness.get('app-status').textContent, /GET poll dropped/);
  assert.equal(harness.activeTimerCount(), 1);
  harness.app.syncAgentPolling();
  assert.equal(harness.activeTimerCount(), 1);

  harness.app.clearAgentPolling();
  harness.app.state.agentReview = createReadyReview();
  harness.app.runAgentReview();
  harness.app.runAgentReview();
  await harness.flush();

  assert.equal(harness.countCalls('POST /api/agent-review'), 1);
  post.reject(new Error('POST still pending'));
});

test('loads the session even when the reviewer request fails and shows a reviewer-specific unavailable state', async () => {
  const harness = await createAppHarness({
    routes: {
      'GET /api/session': [jsonResponse(createSession())],
      'GET /api/agent-review': [new Error('Reviewer request failed (503)')]
    },
    storage: {
      'vlp-review:session-1': JSON.stringify([
        { questionId: 'q-1', decision: 'accept', answer: '' }
      ])
    }
  });

  assert.equal(harness.app.state.session.id, 'session-1');
  assert.match(harness.get('prompt-content').textContent, /Check the search behavior\./);
  assert.notEqual(harness.get('question-title').textContent, 'The local session could not be loaded.');
  assert.equal(harness.app.state.agentReview.status, 'unavailable');
  assert.equal(harness.get('reviewer-panel').hidden, false);
  assert.equal(harness.get('reviewer-status').dataset.state, 'unavailable');
  assert.equal(harness.get('reviewer-run-button').disabled, false);
  assert.equal(harness.get('accept-button').disabled, true);
  assert.equal(harness.app.humanResponses().length, 0);
});
