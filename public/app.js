const state = {
  session: null,
  agentReview: null,
  agentPolling: null,
  agentRunGeneration: 0,
  sourceIndex: 0,
  questionIndex: 0,
  responses: new Map(),
  report: ''
};

const ids = [
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
const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));

const LOCAL_PRIVACY_COPY = 'Review the places where generated code may have drifted from your prompt. Local mode keeps the review on this machine.';
const REMOTE_PRIVACY_COPY = 'Review the places where generated code may have drifted from your prompt. Remote agent mode sends the prompt and linked excerpts to your configured reviewer.';
const REVIEW_STATUS_LABELS = {
  ready: 'Agent review has not run yet.',
  running: 'Agent review is running.',
  approved: 'Agent approved every targeted question.',
  'needs-human': 'Agent review needs human follow-up.',
  failed: 'Agent review could not complete safely.',
  unavailable: 'Reviewer state could not be loaded.'
};
const MANUAL_DECISIONS = new Set(['accept', 'correct', 'irrelevant']);
const EFFECTIVE_AGENT_STATUSES = new Set(['approved', 'needs-human']);

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

function setBadge(text, remote = false) {
  const badge = elements['privacy-badge'];
  const dot = makeElement('span', '', '●');
  dot.setAttribute('aria-hidden', 'true');
  badge.className = remote ? 'local-badge remote-badge' : 'local-badge';
  badge.replaceChildren(dot, document.createTextNode(` ${text}`));
}

function clearAgentPolling() {
  if (state.agentPolling) {
    clearTimeout(state.agentPolling);
    state.agentPolling = null;
  }
}

function agentResult(questionId) {
  return state.agentReview?.results?.find(result => result.questionId === questionId) || null;
}

function isAgentMode() {
  return state.agentReview && state.agentReview.status !== 'not-configured';
}

function hasEffectiveAgentReview() {
  return EFFECTIVE_AGENT_STATUSES.has(state.agentReview?.status);
}

function reviewerUnavailableState(error, base = state.agentReview) {
  return {
    status: 'unavailable',
    provider: base?.provider || null,
    model: base?.model || null,
    threshold: base?.threshold ?? 0.8,
    startedAt: base?.startedAt || null,
    completedAt: base?.completedAt || null,
    summary: base?.summary || '',
    results: Array.isArray(base?.results) ? base.results : [],
    error: { code: 'reviewer-request-failed', message: error.message }
  };
}

function clearReport() {
  state.report = '';
  elements['report-output'].textContent = '';
  elements['report-panel'].hidden = true;
}

function humanResponses() {
  if (!isAgentMode()) return [...state.responses.values()];
  if (!hasEffectiveAgentReview()) return [];
  const escalated = new Set(
    (state.agentReview.results || [])
      .filter(result => result.status === 'escalated')
      .map(result => result.questionId)
  );
  return [...state.responses.values()].filter(response => escalated.has(response.questionId));
}

function pruneResponsesToEscalated() {
  if (!isAgentMode() || !hasEffectiveAgentReview()) return;
  const allowed = new Set(
    (state.agentReview?.results || [])
      .filter(result => result.status === 'escalated')
      .map(result => result.questionId)
  );
  for (const questionId of [...state.responses.keys()]) {
    if (!allowed.has(questionId)) state.responses.delete(questionId);
  }
}

function reconcileAuthoritativeResponses() {
  if (!isAgentMode() || !hasEffectiveAgentReview()) return;
  pruneResponsesToEscalated();
  persistResponses();
}

function restoreResponses() {
  state.responses.clear();
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey()) || '[]');
    if (!Array.isArray(stored)) return;
    for (const response of stored) {
      if (MANUAL_DECISIONS.has(response?.decision) && typeof response.questionId === 'string') {
        state.responses.set(response.questionId, {
          questionId: response.questionId,
          decision: response.decision,
          answer: typeof response.answer === 'string' ? response.answer : ''
        });
      }
    }
  } catch {
    localStorage.removeItem(storageKey());
  }
}

function persistResponses() {
  localStorage.setItem(storageKey(), JSON.stringify(humanResponses()));
}

function syncAgentPolling() {
  if (state.agentReview?.status !== 'running') {
    clearAgentPolling();
    return;
  }
  if (state.agentPolling) return;
  state.agentPolling = setTimeout(async () => {
    state.agentPolling = null;
    await fetchAgentReview();
  }, 1000);
}

function reviewerModeLabel(review) {
  if (!review || review.status === 'not-configured') return 'Local review mode';
  const provider = review.provider || 'Remote reviewer';
  const model = review.model || 'configured model';
  return `${provider} / ${model}`;
}

function reviewerDisclosure(review) {
  if (!review || review.status === 'not-configured') {
    return 'Local mode keeps the prompt and evidence on this machine.';
  }
  return `Remote agent mode sends the prompt and linked excerpts to ${review.provider || 'your configured reviewer'}${review.model ? ` (${review.model})` : ''}.`;
}

function reviewerStatusMessage(review) {
  if (!review) return 'Loading reviewer state…';
  const base = REVIEW_STATUS_LABELS[review.status] || 'Reviewer state unavailable.';
  return review?.error?.message ? `${base} ${review.error.message}` : base;
}

function reviewerStatusTone(review) {
  if (!review || review.status === 'not-configured') return 'success';
  if (review.status === 'approved') return 'success';
  if (review.status === 'failed' || review.status === 'unavailable') return 'error';
  return 'neutral';
}

function syncAppStatusWithReviewer(review = state.agentReview) {
  if (!review || review.status === 'not-configured') {
    setStatus('Review session ready', 'success');
    return;
  }
  setStatus(reviewerStatusMessage(review), reviewerStatusTone(review));
}

function reportSubmissionLocked() {
  return isAgentMode() && !hasEffectiveAgentReview();
}

function setQuestionControls({ disabled, selectedDecision = null, answer = '', error = '', placeholder = 'Describe the behavior you actually intended…' }) {
  const decisions = ['accept', 'correct', 'irrelevant'];
  const buttons = [elements['accept-button'], elements['correct-button'], elements['irrelevant-button']];
  elements['correction-text'].disabled = disabled;
  elements['correction-text'].value = answer;
  elements['correction-text'].placeholder = placeholder;
  elements['response-error'].textContent = error;
  buttons.forEach((button, index) => {
    button.disabled = disabled;
    button.classList.toggle('selected', selectedDecision === decisions[index]);
  });
}

function setAgentAudit(result, reviewStatus) {
  const audit = elements['agent-audit'];
  if (!result) {
    audit.hidden = true;
    audit.dataset.status = '';
    return;
  }
  audit.hidden = false;
  const approved = result.status === 'approved' && EFFECTIVE_AGENT_STATUSES.has(reviewStatus);
  const escalated = result.status === 'escalated' && EFFECTIVE_AGENT_STATUSES.has(reviewStatus);
  audit.dataset.status = approved ? 'approved' : escalated ? 'escalated' : 'inactive';
  elements['agent-decision'].textContent = approved
    ? `${result.effectiveDecision || 'unknown'} · approved automatically`
    : `${result.proposedDecision || result.effectiveDecision || 'no proposal'} · ${escalated ? 'needs human review' : 'pending review state'}`;
  elements['agent-confidence'].textContent = typeof result.confidence === 'number'
    ? `${Math.round(result.confidence * 100)}%`
    : 'Not provided';
  elements['agent-intent'].textContent = result.intentBasis || 'Not provided';
  elements['agent-rationale'].textContent = result.rationale || 'No rationale provided.';
  elements['agent-escalation'].textContent = result.escalationReasons?.length
    ? result.escalationReasons.join(', ')
    : 'None';
}

function effectiveReviewedCount() {
  if (!state.session) return 0;
  if (!isAgentMode()) return state.responses.size;
  if (!hasEffectiveAgentReview()) return 0;
  const byId = new Map((state.agentReview?.results || []).map(result => [result.questionId, result]));
  return state.session.questions.reduce((count, question) => {
    const result = byId.get(question.id);
    if (!result) return count;
    if (result.status === 'approved') return count + 1;
    if (result.status === 'escalated' && state.agentReview.status === 'needs-human' && state.responses.has(question.id)) return count + 1;
    return count;
  }, 0);
}

async function loadApp() {
  try {
    const sessionResponse = await fetch('/api/session', { headers: { accept: 'application/json' } });
    if (!sessionResponse.ok) throw new Error(`Session request failed (${sessionResponse.status})`);
    state.session = await sessionResponse.json();
    elements['prompt-content'].textContent = state.session.prompt;

    try {
      const reviewResponse = await fetch('/api/agent-review', { headers: { accept: 'application/json' } });
      if (!reviewResponse.ok) throw new Error(`Reviewer request failed (${reviewResponse.status})`);
      state.agentReview = await reviewResponse.json();
    } catch (error) {
      state.agentReview = reviewerUnavailableState(error);
    }

    restoreResponses();
    reconcileAuthoritativeResponses();
    renderAll();
    syncAgentPolling();
    syncAppStatusWithReviewer();
  } catch (error) {
    clearAgentPolling();
    setStatus(error.message, 'error');
    elements['question-title'].textContent = 'The local session could not be loaded.';
    elements['question-ask'].textContent = 'Return to the terminal for the server error, then restart VLP Review.';
  }
}

async function fetchAgentReview() {
  try {
    const response = await fetch('/api/agent-review', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Reviewer request failed (${response.status})`);
    state.agentReview = await response.json();
    reconcileAuthoritativeResponses();
    renderAll();
    syncAgentPolling();
    syncAppStatusWithReviewer();
  } catch (error) {
    if (state.agentReview?.status === 'running') {
      state.agentReview = {
        ...state.agentReview,
        error: { code: 'reviewer-sync-failed', message: error.message }
      };
      renderAll();
      syncAgentPolling();
    } else if (isAgentMode()) {
      state.agentReview = reviewerUnavailableState(error);
      renderAll();
    }
    setStatus(error.message, 'error');
  }
}

async function runAgentReview() {
  if (state.agentReview?.status === 'unavailable') {
    await fetchAgentReview();
    return;
  }
  if (!isAgentMode() || state.agentReview.status === 'running') return;
  clearAgentPolling();
  const runGeneration = state.agentRunGeneration + 1;
  state.agentRunGeneration = runGeneration;
  state.agentReview = {
    ...state.agentReview,
    status: 'running',
    completedAt: null,
    error: null
  };
  state.responses.clear();
  clearReport();
  persistResponses();
  renderAll();
  syncAgentPolling();
  try {
    setStatus('Running agent review…');
    const response = await fetch('/api/agent-review', {
      method: 'POST',
      headers: { accept: 'application/json' }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Reviewer request failed (${response.status})`);
    if (runGeneration !== state.agentRunGeneration || state.agentReview?.status !== 'running') {
      syncAppStatusWithReviewer();
      return;
    }
    state.agentReview = payload;
    reconcileAuthoritativeResponses();
    renderAll();
    syncAgentPolling();
    syncAppStatusWithReviewer(payload);
  } catch (error) {
    if (runGeneration !== state.agentRunGeneration) {
      syncAppStatusWithReviewer();
      return;
    }
    if (state.agentReview?.status === 'running') {
      state.agentReview = {
        ...state.agentReview,
        error: { code: 'reviewer-request-failed', message: error.message }
      };
      renderAll();
      syncAgentPolling();
      setStatus(error.message, 'error');
      return;
    }
    syncAppStatusWithReviewer();
  }
}

function renderAll() {
  renderPrivacy();
  renderReviewer();
  renderStats();
  renderSource();
  renderDocumentation();
  renderDiagnostics();
  renderQuestion();
}

function renderPrivacy() {
  if (isAgentMode()) {
    setBadge('Remote agent', true);
    elements['privacy-copy'].textContent = REMOTE_PRIVACY_COPY;
    return;
  }
  setBadge('Local only');
  elements['privacy-copy'].textContent = LOCAL_PRIVACY_COPY;
}

function renderReviewer() {
  const review = state.agentReview;
  if (!review || review.status === 'not-configured') {
    elements['reviewer-panel'].hidden = true;
    return;
  }
  elements['reviewer-panel'].hidden = false;
  elements['reviewer-mode'].textContent = reviewerModeLabel(review);
  elements['reviewer-disclosure'].textContent = reviewerDisclosure(review);
  elements['reviewer-status'].textContent = reviewerStatusMessage(review);
  elements['reviewer-status'].dataset.state = review.status || 'ready';
  elements['reviewer-run-button'].disabled = review.status === 'running';
  elements['reviewer-run-button'].textContent = review.status === 'running'
    ? 'Reviewing…'
    : review.status === 'unavailable'
      ? 'Retry reviewer status'
      : (review.completedAt || review.status === 'failed' || review.status === 'needs-human' || review.status === 'approved')
        ? 'Re-run agent review'
        : 'Run agent review';
}

function renderStats() {
  if (!state.session) return;
  const stats = [
    [state.session.meta?.sourceCount ?? state.session.sources.length, 'Source files'],
    [state.session.meta?.docUnitCount ?? state.session.docUnits.length, 'Behavior traces'],
    [state.session.meta?.questionCount ?? state.session.questions.length, 'Review questions']
  ];
  elements['session-stats'].replaceChildren();
  for (const [value, label] of stats) {
    const item = makeElement('div', 'stat');
    item.append(makeElement('strong', '', String(value)), makeElement('span', '', label));
    elements['session-stats'].append(item);
  }
}

function renderSource() {
  if (!state.session) return;
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
  if (!state.session) return;
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
  if (!state.session) return;
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

function renderDiagnostics() {
  if (!state.session) return;
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
  const linkedIds = new Set(question?.docUnitIds || []);
  return state.session.docUnits.filter(unit => linkedIds.has(unit.id));
}

function renderProgress() {
  const total = state.session.questions.length;
  const reviewed = effectiveReviewedCount();
  elements['review-progress'].textContent = total
    ? `${reviewed} of ${total} reviewed · question ${state.questionIndex + 1}`
    : 'No targeted questions · report available';
  const percent = total ? Math.round((reviewed / total) * 100) : 100;
  elements['progress-fill'].style.width = `${percent}%`;
}

function renderQuestion() {
  if (!state.session) return;
  renderProgress();
  const questions = state.session.questions;
  const question = questions[state.questionIndex];
  const reviewStatus = state.agentReview?.status || 'not-configured';
  elements['response-error'].textContent = '';
  elements['code-evidence'].replaceChildren();

  if (!question) {
    setAgentAudit(null, reviewStatus);
    elements['question-severity'].textContent = 'clear';
    elements['question-severity'].className = 'severity low';
    elements['question-type'].textContent = 'No heuristic flags';
    elements['question-title'].textContent = 'No suspicious mismatch was prioritized.';
    elements['question-ask'].textContent = 'Generate a report now, or manually inspect the prompt and documentation before continuing.';
    elements['question-reason'].textContent = 'Heuristics can miss semantic defects; this result is not a proof of correctness.';
    elements['prompt-evidence'].textContent = 'No targeted prompt trace.';
    elements['code-evidence'].append(makeElement('p', 'empty-state', 'No source trace linked.'));
    setQuestionControls({ disabled: true, selectedDecision: null, answer: '' });
    elements['previous-button'].disabled = true;
    elements['next-button'].disabled = true;
    elements['finish-button'].disabled = reportSubmissionLocked();
    return;
  }

  const response = state.responses.get(question.id);
  const result = agentResult(question.id);
  elements['question-severity'].textContent = question.severity;
  elements['question-severity'].className = `severity ${question.severity}`;
  elements['question-type'].textContent = question.type.replaceAll('-', ' ');
  elements['question-title'].textContent = question.title;
  elements['question-ask'].textContent = question.ask;
  elements['question-reason'].textContent = question.reason;
  elements['prompt-evidence'].textContent = question.promptEvidence || 'No direct prompt sentence was linked.';

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

  if (!isAgentMode()) {
    setAgentAudit(null, reviewStatus);
    setQuestionControls({
      disabled: false,
      selectedDecision: response?.decision || null,
      answer: response?.answer || ''
    });
  } else {
    setAgentAudit(result, reviewStatus);
    if (result?.status === 'approved' && hasEffectiveAgentReview()) {
      setQuestionControls({
        disabled: true,
        selectedDecision: result.effectiveDecision || null,
        answer: result.answer || '',
        placeholder: 'Approved automatically by the configured reviewer.'
      });
    } else if (result?.status === 'escalated' && reviewStatus === 'needs-human') {
      setQuestionControls({
        disabled: false,
        selectedDecision: response?.decision || null,
        answer: response?.answer || ''
      });
    } else {
      setQuestionControls({
        disabled: true,
        selectedDecision: null,
        answer: '',
        placeholder: reviewStatus === 'running'
          ? 'Reviewing…'
          : reviewStatus === 'failed'
            ? 'Re-run the agent review before answering questions.'
            : reviewStatus === 'unavailable'
              ? 'Retry reviewer status before answering questions.'
              : 'Run the agent review to unlock human follow-up for escalated questions.'
      });
    }
  }

  elements['previous-button'].disabled = state.questionIndex === 0;
  elements['next-button'].disabled = state.questionIndex >= questions.length - 1;
  elements['finish-button'].disabled = reportSubmissionLocked();
}

function saveDecision(decision) {
  const question = state.session?.questions[state.questionIndex];
  if (!question) return;
  if (isAgentMode()) {
    const result = agentResult(question.id);
    if (!result || result.status !== 'escalated' || state.agentReview.status !== 'needs-human') return;
  }
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
  if (reportSubmissionLocked()) {
    setStatus('Wait for an authoritative reviewer result before building a repair brief.', 'error');
    renderQuestion();
    return;
  }
  try {
    elements['finish-button'].disabled = true;
    setStatus('Building repair brief…');
    const response = await fetch('/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ responses: humanResponses() })
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
    elements['finish-button'].disabled = reportSubmissionLocked();
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
  elements['reviewer-run-button'].addEventListener('click', runAgentReview);
  elements['copy-report'].addEventListener('click', copyReport);
  elements['download-report'].addEventListener('click', downloadReport);
}

bindEvents();
loadApp();
