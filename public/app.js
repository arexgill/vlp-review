const state = {
  session: null,
  sourceIndex: 0,
  questionIndex: 0,
  responses: new Map(),
  report: ''
};

const ids = [
  'app-status', 'session-stats', 'prompt-content', 'source-select', 'source-code',
  'doc-list', 'diagnostic-list', 'review-progress', 'progress-fill', 'question-card',
  'question-title', 'question-ask', 'question-type', 'question-severity', 'question-reason',
  'prompt-evidence-label', 'prompt-evidence', 'code-evidence-label', 'code-evidence', 'correction-text', 'response-error',
  'accept-button', 'correct-button', 'irrelevant-button', 'previous-button',
  'next-button', 'finish-button', 'report-panel', 'report-output', 'copy-report',
  'download-report', 'runtime-block', 'runtime-disclosure', 'runtime-list'
];
const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));

function storageKey() {
  return state.session ? `vlp-review:${state.session.id}` : 'vlp-review:pending';
}

function setStatus(message, tone = 'neutral') {
  elements['app-status'].textContent = message;
  elements['app-status'].dataset.tone = tone;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function loadSession() {
  try {
    const response = await fetch('/api/session', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Session request failed (${response.status})`);
    state.session = await response.json();
    restoreResponses();
    elements['prompt-content'].textContent = state.session.prompt;
    renderAll();
    setStatus('Review session ready', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
    elements['question-title'].textContent = 'The local session could not be loaded.';
    elements['question-ask'].textContent = 'Return to the terminal for the server error, then restart VLP Review.';
  }
}

function restoreResponses() {
  state.responses.clear();
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey()) || '[]');
    if (!Array.isArray(stored)) return;
    for (const response of stored) {
      if (['accept', 'correct', 'irrelevant'].includes(response.decision)) {
        state.responses.set(response.questionId, response);
      }
    }
  } catch {
    localStorage.removeItem(storageKey());
  }
}

function persistResponses() {
  localStorage.setItem(storageKey(), JSON.stringify([...state.responses.values()]));
}

function renderAll() {
  renderStats();
  renderSource();
  renderDocumentation();
  renderRuntime();
  renderDiagnostics();
  renderQuestion();
}

function renderStats() {
  const stats = [
    [state.session.meta.sourceCount, 'Source files'],
    [state.session.meta.docUnitCount, 'Behavior traces'],
    [state.session.meta.questionCount, 'Review questions']
  ];
  elements['session-stats'].replaceChildren();
  for (const [value, label] of stats) {
    const item = makeElement('div', 'stat');
    item.append(makeElement('strong', '', String(value)), makeElement('span', '', label));
    elements['session-stats'].append(item);
  }
}

function renderSource() {
  const select = elements['source-select'];
  select.replaceChildren();
  state.session.sources.forEach((source, index) => {
    const option = makeElement('option', '', source.path);
    option.value = String(index);
    option.selected = index === state.sourceIndex;
    select.append(option);
  });

  const code = elements['source-code'];
  code.replaceChildren();
  const source = state.session.sources[state.sourceIndex];
  if (!source) {
    code.textContent = 'No source files were loaded.';
    return;
  }
  source.content.split('\n').forEach((line, index) => {
    const lineNode = makeElement('span', 'source-line', line || ' ');
    lineNode.dataset.line = String(index + 1);
    code.append(lineNode);
  });
}

function showSourceEvidence(unit) {
  const index = state.session.sources.findIndex(source => source.path === unit.file);
  if (index >= 0) state.sourceIndex = index;
  renderSource();
  renderDocumentation();
  renderDiagnostics();
  requestAnimationFrame(() => {
    const line = elements['source-code'].querySelector(`[data-line="${unit.lineStart}"]`);
    if (!line) return;
    line.classList.add('highlight');
    line.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function renderDocumentation() {
  const list = elements['doc-list'];
  list.replaceChildren();
  const source = state.session.sources[state.sourceIndex];
  const units = state.session.docUnits.filter(unit => unit.file === source?.path);
  if (units.length === 0) {
    list.append(makeElement('p', 'empty-state', 'No reviewable behavior was extracted from this file. Check parse diagnostics below.'));
    return;
  }

  for (const unit of units) {
    const button = makeElement('button', 'doc-unit');
    button.type = 'button';
    button.append(
      makeElement('span', 'doc-kind', unit.kind),
      makeElement('span', 'doc-text', unit.text),
      makeElement('span', 'doc-line', `L${unit.lineStart}`)
    );
    button.addEventListener('click', () => showSourceEvidence(unit));
    list.append(button);
  }
}

function renderRuntime() {
  const block = elements['runtime-block'];
  const disclosure = elements['runtime-disclosure'];
  const list = elements['runtime-list'];

  if (!state.session.fastapiApp) {
    block.style.display = 'none';
    return;
  }

  block.style.display = 'block';
  disclosure.textContent = 'Execution Boundary: Endpoint logic is never executed. Only safe OpenAPI metadata is extracted to verify static routes. Requires manual opt-in.';
  list.replaceChildren();

  list.append(makeElement('p', 'diagnostic', `Target App: ${state.session.fastapiApp}`));
  list.append(makeElement('p', 'diagnostic', `Static Routes: ${(state.session.fastapiStaticContracts || []).length}`));

  if (state.session.runtimeDiagnostic) {
    list.append(makeElement('p', 'diagnostic', `Diagnostic: ${state.session.runtimeDiagnostic}`));
  } else if (state.session.openapi && state.session.openapi.paths) {
    const routeCount = Object.keys(state.session.openapi.paths).length;
    list.append(makeElement('p', 'diagnostic', `Runtime Routes: ${routeCount}`));
  }
}

function renderDiagnostics() {
  const list = elements['diagnostic-list'];
  list.replaceChildren();
  const source = state.session.sources[state.sourceIndex];
  const diagnostics = state.session.diagnostics.filter(item => item.file === source?.path);
  if (diagnostics.length === 0) {
    list.append(makeElement('p', 'empty-state', 'No parser issues in this file.'));
    return;
  }
  for (const diagnostic of diagnostics) {
    list.append(makeElement('p', 'diagnostic', `${diagnostic.file}:${diagnostic.line} — ${diagnostic.message}`));
  }
}

function linkedUnits(question) {
  const ids = new Set(question?.docUnitIds || []);
  return state.session.docUnits.filter(unit => ids.has(unit.id));
}

function renderProgress() {
  const total = state.session.questions.length;
  const reviewed = state.responses.size;
  elements['review-progress'].textContent = total
    ? `${reviewed} of ${total} reviewed · question ${state.questionIndex + 1}`
    : 'No targeted questions · report available';
  const percent = total ? Math.round((reviewed / total) * 100) : 100;
  elements['progress-fill'].style.width = `${percent}%`;
}

function renderQuestion() {
  renderProgress();
  const questions = state.session.questions;
  const question = questions[state.questionIndex];
  const decisionButtons = [elements['accept-button'], elements['correct-button'], elements['irrelevant-button']];
  elements['response-error'].textContent = '';
  elements['code-evidence'].replaceChildren();

  if (!question) {
    elements['question-severity'].textContent = 'clear';
    elements['question-severity'].className = 'severity low';
    elements['question-type'].textContent = 'No heuristic flags';
    elements['question-title'].textContent = 'No suspicious mismatch was prioritized.';
    elements['question-ask'].textContent = 'Generate a report now, or manually inspect the prompt and documentation before continuing.';
    elements['question-reason'].textContent = 'Heuristics can miss semantic defects; this result is not a proof of correctness.';
    elements['prompt-evidence'].textContent = 'No targeted prompt trace.';
    elements['code-evidence'].append(makeElement('p', 'empty-state', 'No source trace linked.'));
    elements['correction-text'].value = '';
    decisionButtons.forEach(button => { button.disabled = true; button.classList.remove('selected'); });
    elements['previous-button'].disabled = true;
    elements['next-button'].disabled = true;
    elements['finish-button'].disabled = false;
    return;
  }

  const response = state.responses.get(question.id);
  elements['question-severity'].textContent = question.severity;
  elements['question-severity'].className = `severity ${question.severity}`;
  elements['question-type'].textContent = question.type.replaceAll('-', ' ');
  elements['question-title'].textContent = question.title;
  elements['question-ask'].textContent = question.ask;
  elements['question-reason'].textContent = question.reason;

  if (question.sourceEvidence) {
    elements['prompt-evidence-label'].textContent = 'Source evidence';
    elements['prompt-evidence'].textContent = JSON.stringify(question.sourceEvidence, null, 2);
  } else {
    elements['prompt-evidence-label'].textContent = 'Prompt trace';
    elements['prompt-evidence'].textContent = question.promptEvidence || 'No direct prompt sentence was linked.';
  }

  elements['correction-text'].value = response?.answer || '';

  if (question.runtimeEvidence) {
    elements['code-evidence-label'].textContent = 'Runtime OpenAPI evidence';
    elements['code-evidence'].append(makeElement('pre', 'evidence-json', JSON.stringify(question.runtimeEvidence, null, 2)));
  } else {
    elements['code-evidence-label'].textContent = 'Code & documentation trace';
    const units = linkedUnits(question);
    if (units.length === 0) {
      elements['code-evidence'].append(makeElement('p', 'empty-state', 'No direct source trace linked.'));
    } else {
      for (const unit of units) {
        const button = makeElement('button', 'evidence-button');
        button.type = 'button';
        button.append(
          makeElement('span', '', unit.text),
          makeElement('span', '', `${unit.file}:L${unit.lineStart}`)
        );
        button.addEventListener('click', () => showSourceEvidence(unit));
        elements['code-evidence'].append(button);
      }
    }
  }

  const decisions = ['accept', 'correct', 'irrelevant'];
  decisionButtons.forEach((button, index) => {
    button.disabled = false;
    button.classList.toggle('selected', response?.decision === decisions[index]);
  });
  elements['previous-button'].disabled = state.questionIndex === 0;
  elements['next-button'].disabled = state.questionIndex >= questions.length - 1;
  elements['finish-button'].disabled = false;
}

function saveDecision(decision) {
  const question = state.session.questions[state.questionIndex];
  if (!question) return;
  const answer = elements['correction-text'].value.trim();
  if (decision === 'correct' && !answer) {
    elements['response-error'].textContent = 'Describe the intended behavior before marking this as a correction.';
    elements['correction-text'].focus();
    return;
  }
  state.responses.set(question.id, { questionId: question.id, decision, answer });
  persistResponses();
  renderQuestion();
  setStatus(`Saved “${decision}” for ${question.id}`, 'success');
}

function updateSavedAnswer() {
  const question = state.session?.questions[state.questionIndex];
  const response = question ? state.responses.get(question.id) : null;
  if (!response) return;
  response.answer = elements['correction-text'].value;
  state.responses.set(question.id, response);
  persistResponses();
}

function moveQuestion(delta) {
  const nextIndex = Math.min(
    Math.max(state.questionIndex + delta, 0),
    Math.max(state.session.questions.length - 1, 0)
  );
  state.questionIndex = nextIndex;
  renderQuestion();
  elements['question-card'].scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function finishReview() {
  try {
    elements['finish-button'].disabled = true;
    setStatus('Building repair brief…');
    const response = await fetch('/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ responses: [...state.responses.values()] })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Report request failed (${response.status})`);
    state.report = payload.markdown;
    elements['report-output'].textContent = state.report;
    elements['report-panel'].hidden = false;
    elements['report-panel'].scrollIntoView({ block: 'start', behavior: 'smooth' });
    setStatus('Repair brief ready', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    elements['finish-button'].disabled = false;
  }
}

async function copyReport() {
  if (!state.report) return;
  try {
    await navigator.clipboard.writeText(state.report);
    setStatus('Markdown copied to clipboard', 'success');
  } catch {
    setStatus('Clipboard unavailable. Select the report text and copy it manually.', 'error');
  }
}

function downloadReport() {
  if (!state.report) return;
  const blob = new Blob([state.report], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.session.id}-vlp-review.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus('Markdown report downloaded', 'success');
}

function bindEvents() {
  elements['source-select'].addEventListener('change', event => {
    state.sourceIndex = Number(event.target.value);
    renderSource();
    renderDocumentation();
    renderDiagnostics();
  });
  elements['correction-text'].addEventListener('input', updateSavedAnswer);
  elements['accept-button'].addEventListener('click', () => saveDecision('accept'));
  elements['correct-button'].addEventListener('click', () => saveDecision('correct'));
  elements['irrelevant-button'].addEventListener('click', () => saveDecision('irrelevant'));
  elements['previous-button'].addEventListener('click', () => moveQuestion(-1));
  elements['next-button'].addEventListener('click', () => moveQuestion(1));
  elements['finish-button'].addEventListener('click', finishReview);
  elements['copy-report'].addEventListener('click', copyReport);
  elements['download-report'].addEventListener('click', downloadReport);
}

bindEvents();
loadSession();
