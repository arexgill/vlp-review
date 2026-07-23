import path from 'node:path';

const DECISIONS = new Set(['accept', 'correct', 'irrelevant']);
const MAX_ANSWER_LENGTH = 4000;
const EFFECTIVE_AGENT_STATUSES = new Set(['approved', 'needs-human']);

function clean(value) {
  return String(value ?? '').replaceAll('\0', '').replace(/\r\n?/g, '\n').trim();
}

function cleanInline(value) {
  return clean(value).replace(/\s*\n+\s*/g, ' ');
}

function renderFilePath(value) {
  const file = cleanInline(value);
  if (!file) return '';
  if (path.win32.isAbsolute(file)) return path.win32.basename(file).replaceAll('\\', '/');
  if (path.posix.isAbsolute(file)) return path.posix.basename(file);
  return file.replaceAll('\\', '/');
}

function questionMap(session) {
  return new Map((session.questions || []).map(question => [question.id, question]));
}

function validateResponses(session, responses) {
  if (!Array.isArray(responses)) throw new Error('Responses must be an array');
  const questions = questionMap(session);
  const seen = new Set();

  return responses.map(response => {
    const questionId = clean(response?.questionId);
    const decision = clean(response?.decision);
    const answer = clean(response?.answer);
    if (!questions.has(questionId)) throw new Error(`Unknown question: ${questionId}`);
    if (!DECISIONS.has(decision)) throw new Error(`Invalid decision: ${decision}`);
    if (seen.has(questionId)) throw new Error(`Duplicate response: ${questionId}`);
    if (decision === 'correct' && !answer) throw new Error(`Correction text is required for ${questionId}`);
    if (answer.length > MAX_ANSWER_LENGTH) {
      throw new Error(`Answer for ${questionId} exceeds ${MAX_ANSWER_LENGTH} characters`);
    }
    seen.add(questionId);
    return { questionId, decision, answer };
  });
}

function evidenceForDocUnitIds(session, docUnitIds = []) {
  const ids = new Set(docUnitIds || []);
  return (session.docUnits || [])
    .filter(unit => ids.has(unit.id))
    .map(unit => `${renderFilePath(unit.file)}:${unit.lineStart || 1} — ${cleanInline(unit.text)}`);
}

function evidenceFor(session, question) {
  return evidenceForDocUnitIds(session, question.docUnitIds || []);
}

function renderResolvedItem(session, question, response, { feedbackLabel = 'User feedback' } = {}) {
  const lines = [
    `### ${cleanInline(question.title)} (${cleanInline(question.id)})`,
    '',
    `- **Decision:** ${cleanInline(response.decision)}`,
    `- **Question:** ${cleanInline(question.ask)}`
  ];
  if (response.answer) lines.push(`- **${cleanInline(feedbackLabel)}:** ${cleanInline(response.answer)}`);
  if (question.promptEvidence) lines.push(`- **Prompt trace:** ${cleanInline(question.promptEvidence)}`);
  const evidence = evidenceFor(session, question);
  lines.push(`- **Code/documentation trace:** ${evidence.length ? evidence.join('; ') : 'No direct source line was linked.'}`);
  return lines.join('\n');
}

function renderSection(title, items) {
  return [`## ${title}`, '', items.length ? items.join('\n\n') : 'None'].join('\n');
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'Not available';
}

function formatThreshold(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : 'Not available';
}

function agentReviewStatusLabel(status) {
  switch (clean(status)) {
    case 'approved':
      return 'Approved automatically';
    case 'needs-human':
      return 'Needs human review';
    case 'failed':
      return 'Reviewer failed';
    case 'running':
      return 'In progress';
    case 'ready':
      return 'Agent review has not run yet';
    default:
      return 'Not configured';
  }
}

function finalValidationStatus(agentReview, unresolvedCount, escalatedCount) {
  switch (clean(agentReview?.status)) {
    case 'approved':
      if (escalatedCount > 0) {
        return unresolvedCount > 0 ? 'Needs human review' : 'Completed with human resolution';
      }
      return 'Agent approved';
    case 'failed':
      return 'Reviewer failed';
    case 'needs-human':
      return unresolvedCount > 0 ? 'Needs human review' : 'Completed with human resolution';
    default:
      return 'Needs human review';
  }
}

function shouldClaimAllReviewed(agentReview, finalStatus, escalatedCount) {
  switch (clean(agentReview?.status)) {
    case 'approved':
      return escalatedCount === 0 && finalStatus === 'Agent approved';
    case 'needs-human':
      return finalStatus === 'Completed with human resolution';
    default:
      return false;
  }
}

function renderAuditItem(session, question, result, humanResolution) {
  const evidence = evidenceForDocUnitIds(session, result?.evidenceDocUnitIds || []);
  const lines = [
    `### ${cleanInline(question.title)} (${cleanInline(question.id)})`,
    '',
    `- Policy status: ${cleanInline(result?.status) || 'unknown'}`,
    `- Question: ${cleanInline(question.ask)}`,
    `- Proposed decision: ${cleanInline(result?.proposedDecision) || 'None'}`,
    `- Effective decision: ${cleanInline(result?.effectiveDecision) || (humanResolution ? cleanInline(humanResolution.decision) : 'Pending human review')}`,
    `- Confidence: ${formatPercent(result?.confidence)}`,
    `- Intent basis: ${cleanInline(result?.intentBasis) || 'Not available'}`,
    `- Rationale: ${cleanInline(result?.rationale) || 'None provided.'}`,
    `- Escalation reasons: ${(result?.escalationReasons || []).length ? result.escalationReasons.map(cleanInline).join(', ') : 'None'}`,
    `- Evidence: ${evidence.length ? evidence.join('; ') : 'No direct source line was linked.'}`
  ];

  if (clean(result?.answer)) {
    lines.push(`- Agent answer: ${cleanInline(result.answer)}`);
  }
  if (humanResolution) {
    lines.push(`- Human resolution: ${cleanInline(humanResolution.decision)}${humanResolution.answer ? ` — ${cleanInline(humanResolution.answer)}` : ''}`);
  }

  return lines.join('\n');
}

function renderUnresolvedEscalation(session, question, result) {
  const evidence = evidenceForDocUnitIds(session, result?.evidenceDocUnitIds || []);
  return [
    `### ${cleanInline(question.title)} (${cleanInline(question.id)})`,
    '',
    `- **Question:** ${cleanInline(question.ask)}`,
    `- **Agent proposal:** ${cleanInline(result?.proposedDecision) || 'None'}`,
    `- **Rationale:** ${cleanInline(result?.rationale) || 'None provided.'}`,
    `- **Escalation reasons:** ${(result?.escalationReasons || []).length ? result.escalationReasons.map(cleanInline).join(', ') : 'Not provided.'}`,
    `- **Evidence:** ${evidence.length ? evidence.join('; ') : 'No direct source line was linked.'}`
  ].join('\n');
}

function buildAgentRepairInstructions(session, questions, effectiveResponses, agentReview, finalStatus, escalatedCount) {
  const repairItems = effectiveResponses
    .filter(response => response.decision === 'correct')
    .map((response, index) => {
      const question = questions.find(item => item.id === response.questionId);
      const evidence = question ? evidenceFor(session, question) : [];
      const trace = evidence.length ? ` Trace: ${evidence.join('; ')}.` : '';
      return `${index + 1}. Update the generated code to satisfy: ${cleanInline(response.answer)}.${trace}`;
    });

  const acceptedIds = effectiveResponses
    .filter(response => response.decision === 'accept')
    .map(response => cleanInline(response.questionId));

  return [
    ...(repairItems.length ? repairItems : ['No code corrections were requested.']),
    '',
    acceptedIds.length
      ? `Preserve the behavior accepted in: ${acceptedIds.join(', ')}.`
      : 'No generated behaviors were explicitly accepted.',
    shouldClaimAllReviewed(agentReview, finalStatus, escalatedCount)
      ? 'All targeted questions were reviewed.'
      : 'Do not infer answers for unanswered or unreviewed questions; ask the user before changing those behaviors.',
    'After editing, run the project tests and report any behavior that could not be implemented.'
  ].join('\n');
}

export function buildManualReport(session, rawResponses = []) {
  const responses = validateResponses(session, rawResponses);
  const responseById = new Map(responses.map(response => [response.questionId, response]));
  const questions = session.questions || [];
  const accepted = [];
  const corrected = [];
  const irrelevant = [];
  const unresolved = [];

  for (const question of questions) {
    const response = responseById.get(question.id);
    if (!response) {
      unresolved.push([
        `### ${cleanInline(question.title)} (${cleanInline(question.id)})`,
        '',
        `- **Question:** ${cleanInline(question.ask)}`,
        `- **Reason:** ${cleanInline(question.reason)}`
      ].join('\n'));
      continue;
    }
    const rendered = renderResolvedItem(session, question, response);
    if (response.decision === 'accept') accepted.push(rendered);
    if (response.decision === 'correct') corrected.push(rendered);
    if (response.decision === 'irrelevant') irrelevant.push(rendered);
  }

  const diagnostics = (session.diagnostics || []).map(diagnostic =>
    `- ${renderFilePath(diagnostic.file)}:${diagnostic.line || 1} — ${cleanInline(diagnostic.message)}`);

  const repairItems = responses
    .filter(response => response.decision === 'correct')
    .map((response, index) => {
      const question = questions.find(item => item.id === response.questionId);
      const evidence = question ? evidenceFor(session, question) : [];
      const trace = evidence.length ? ` Trace: ${evidence.join('; ')}.` : '';
      return `${index + 1}. Update the generated code to satisfy: ${cleanInline(response.answer)}.${trace}`;
    });

  const acceptedIds = responses
    .filter(response => response.decision === 'accept')
    .map(response => response.questionId);

  const repairInstructions = [
    ...(repairItems.length ? repairItems : ['No code corrections were requested.']),
    '',
    acceptedIds.length
      ? `Preserve the behavior accepted in: ${acceptedIds.join(', ')}.`
      : 'No generated behaviors were explicitly accepted.',
    unresolved.length
      ? 'Do not infer answers for unresolved questions; ask the user before changing those behaviors.'
      : 'All targeted questions were reviewed.',
    'After editing, run the project tests and report any behavior that could not be implemented.'
  ].join('\n');

  return [
    '# VLP Review Report',
    '',
    `Session: ${cleanInline(session.id)}`,
    '',
    '## Review Summary',
    '',
    `- Targeted questions: ${questions.length}`,
    `- Accepted behaviors: ${accepted.length}`,
    `- Corrected intents: ${corrected.length}`,
    `- Marked irrelevant: ${irrelevant.length}`,
    `- Unresolved: ${unresolved.length}`,
    '',
    '## Original Prompt',
    '',
    clean(session.prompt) || 'No prompt text was supplied.',
    '',
    renderSection('Corrected Intent', corrected),
    '',
    renderSection('Accepted Generated Behavior', accepted),
    '',
    renderSection('Marked Irrelevant', irrelevant),
    '',
    renderSection('Unresolved Questions', unresolved),
    '',
    '## Parse Diagnostics',
    '',
    diagnostics.length ? diagnostics.join('\n') : 'None',
    '',
    '## Repair Instructions for Coding Agent',
    '',
    repairInstructions,
    ''
  ].join('\n');
}

function buildAgentReport(session, rawResponses = [], agentReview = {}) {
  const humanResponses = validateResponses(session, rawResponses);
  const questions = session.questions || [];
  const diagnostics = (session.diagnostics || []).map(diagnostic =>
    `- ${renderFilePath(diagnostic.file)}:${diagnostic.line || 1} — ${cleanInline(diagnostic.message)}`);
  const results = Array.isArray(agentReview?.results) ? agentReview.results : [];
  const resultById = new Map(results.map(result => [clean(result?.questionId), result]));
  const humanResponseById = new Map();

  for (const response of humanResponses) {
    const result = resultById.get(response.questionId);
    if (clean(result?.status) === 'approved') {
      throw new Error(`cannot override agent-approved question: ${response.questionId}`);
    }
    if (!result || clean(result.status) !== 'escalated') {
      throw new Error(`Cannot answer non-escalated or unknown question: ${response.questionId}`);
    }
    humanResponseById.set(response.questionId, response);
  }

  const accepted = [];
  const corrected = [];
  const irrelevant = [];
  const unresolved = [];
  const auditItems = [];
  const effectiveResponses = [];
  const canUseEffectiveResults = EFFECTIVE_AGENT_STATUSES.has(clean(agentReview?.status));

  for (const question of questions) {
    const result = resultById.get(question.id);
    const humanResolution = humanResponseById.get(question.id) || null;

    if (result) {
      auditItems.push(renderAuditItem(session, question, result, humanResolution));
    }

    if (!canUseEffectiveResults || !result) continue;

    if (clean(result.status) === 'approved' && DECISIONS.has(clean(result.effectiveDecision))) {
      const response = {
        questionId: question.id,
        decision: clean(result.effectiveDecision),
        answer: clean(result.answer)
      };
      effectiveResponses.push(response);
      const rendered = renderResolvedItem(session, question, response, { feedbackLabel: 'Effective guidance' });
      if (response.decision === 'accept') accepted.push(rendered);
      if (response.decision === 'correct') corrected.push(rendered);
      if (response.decision === 'irrelevant') irrelevant.push(rendered);
      continue;
    }

    if (clean(result.status) === 'escalated') {
      if (humanResolution) {
        effectiveResponses.push(humanResolution);
        const rendered = renderResolvedItem(session, question, humanResolution, { feedbackLabel: 'Effective guidance' });
        if (humanResolution.decision === 'accept') accepted.push(rendered);
        if (humanResolution.decision === 'correct') corrected.push(rendered);
        if (humanResolution.decision === 'irrelevant') irrelevant.push(rendered);
      } else {
        unresolved.push(renderUnresolvedEscalation(session, question, result));
      }
    }
  }

  const automaticCount = results.filter(result => clean(result?.status) === 'approved').length;
  const escalatedCount = results.filter(result => clean(result?.status) === 'escalated').length;
  const finalStatus = finalValidationStatus(agentReview, unresolved.length, escalatedCount);
  const repairInstructions = buildAgentRepairInstructions(session, questions, effectiveResponses, agentReview, finalStatus, escalatedCount);

  return [
    '# VLP Review Report',
    '',
    `Session: ${cleanInline(session.id)}`,
    '',
    '## Review Summary',
    '',
    `- Targeted questions: ${questions.length}`,
    `- Accepted behaviors: ${accepted.length}`,
    `- Corrected intents: ${corrected.length}`,
    `- Marked irrelevant: ${irrelevant.length}`,
    `- Unresolved: ${unresolved.length}`,
    '',
    '## Original Prompt',
    '',
    clean(session.prompt) || 'No prompt text was supplied.',
    '',
    '## Agent Review Audit',
    '',
    `- Reviewer: ${cleanInline(agentReview?.provider) || 'Unknown'} / ${cleanInline(agentReview?.model) || 'Unknown'}`,
    `- Agent review status: ${agentReviewStatusLabel(agentReview?.status)}`,
    `- Final validation status: ${finalStatus}`,
    `- Policy threshold: ${formatThreshold(agentReview?.threshold)}`,
    `- Automatic decisions: ${automaticCount}`,
    `- Escalated decisions: ${escalatedCount}`,
    `- Started at: ${cleanInline(agentReview?.startedAt) || 'Not available'}`,
    `- Completed at: ${cleanInline(agentReview?.completedAt) || 'Not available'}`,
    `- Reviewer summary: ${cleanInline(agentReview?.summary) || 'None provided.'}`,
    agentReview?.error ? `- Reviewer error: ${cleanInline(agentReview.error.message) || 'Unknown error'}` : '- Reviewer error: None',
    '',
    auditItems.length ? auditItems.join('\n\n') : 'No agent review results were recorded.',
    '',
    renderSection('Corrected Intent', corrected),
    '',
    renderSection('Accepted Generated Behavior', accepted),
    '',
    renderSection('Marked Irrelevant', irrelevant),
    '',
    renderSection('Unresolved Questions', unresolved),
    '',
    '## Parse Diagnostics',
    '',
    diagnostics.length ? diagnostics.join('\n') : 'None',
    '',
    '## Repair Instructions for Coding Agent',
    '',
    repairInstructions,
    ''
  ].join('\n');
}

export function buildReport(session, rawResponses = [], { agentReview = null } = {}) {
  if (!agentReview || clean(agentReview.status) === 'not-configured') {
    return buildManualReport(session, rawResponses);
  }
  return buildAgentReport(session, rawResponses, agentReview);
}
