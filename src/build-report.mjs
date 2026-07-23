const DECISIONS = new Set(['accept', 'correct', 'irrelevant']);
const MAX_ANSWER_LENGTH = 4000;
const EFFECTIVE_AGENT_STATUSES = new Set(['approved', 'needs-human']);

function clean(value) {
  return String(value ?? '').replaceAll('\0', '').replace(/\r\n?/g, '\n').trim();
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
    .map(unit => `${clean(unit.file)}:${unit.lineStart || 1} — ${clean(unit.text)}`);
}

function evidenceFor(session, question) {
  return evidenceForDocUnitIds(session, question.docUnitIds || []);
}

function renderResolvedItem(session, question, response, { feedbackLabel = 'User feedback' } = {}) {
  const lines = [
    `### ${clean(question.title)} (${question.id})`,
    '',
    `- **Decision:** ${response.decision}`,
    `- **Question:** ${clean(question.ask)}`
  ];
  if (response.answer) lines.push(`- **${feedbackLabel}:** ${response.answer}`);
  if (question.promptEvidence) lines.push(`- **Prompt trace:** ${clean(question.promptEvidence)}`);
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

function finalValidationStatus(agentReview, unresolvedCount) {
  switch (clean(agentReview?.status)) {
    case 'approved':
      return 'Agent approved';
    case 'failed':
      return 'Reviewer failed';
    case 'needs-human':
      return unresolvedCount > 0 ? 'Needs human review' : 'Completed with human resolution';
    default:
      return 'Needs human review';
  }
}

function renderAuditItem(session, question, result, humanResolution) {
  const evidence = evidenceForDocUnitIds(session, result?.evidenceDocUnitIds || []);
  const lines = [
    `### ${clean(question.title)} (${question.id})`,
    '',
    `- Policy status: ${clean(result?.status) || 'unknown'}`,
    `- Question: ${clean(question.ask)}`,
    `- Proposed decision: ${clean(result?.proposedDecision) || 'None'}`,
    `- Effective decision: ${clean(result?.effectiveDecision) || (humanResolution ? humanResolution.decision : 'Pending human review')}`,
    `- Confidence: ${formatPercent(result?.confidence)}`,
    `- Intent basis: ${clean(result?.intentBasis) || 'Not available'}`,
    `- Rationale: ${clean(result?.rationale) || 'None provided.'}`,
    `- Escalation reasons: ${(result?.escalationReasons || []).length ? result.escalationReasons.map(clean).join(', ') : 'None'}`,
    `- Evidence: ${evidence.length ? evidence.join('; ') : 'No direct source line was linked.'}`
  ];

  if (clean(result?.answer)) {
    lines.push(`- Agent answer: ${clean(result.answer)}`);
  }
  if (humanResolution) {
    lines.push(`- Human resolution: ${humanResolution.decision}${humanResolution.answer ? ` — ${humanResolution.answer}` : ''}`);
  }

  return lines.join('\n');
}

function renderUnresolvedEscalation(session, question, result) {
  const evidence = evidenceForDocUnitIds(session, result?.evidenceDocUnitIds || []);
  return [
    `### ${clean(question.title)} (${question.id})`,
    '',
    `- **Question:** ${clean(question.ask)}`,
    `- **Agent proposal:** ${clean(result?.proposedDecision) || 'None'}`,
    `- **Rationale:** ${clean(result?.rationale) || 'None provided.'}`,
    `- **Escalation reasons:** ${(result?.escalationReasons || []).length ? result.escalationReasons.map(clean).join(', ') : 'Not provided.'}`,
    `- **Evidence:** ${evidence.length ? evidence.join('; ') : 'No direct source line was linked.'}`
  ].join('\n');
}

function buildAgentRepairInstructions(session, questions, effectiveResponses, finalStatus) {
  const repairItems = effectiveResponses
    .filter(response => response.decision === 'correct')
    .map((response, index) => {
      const question = questions.find(item => item.id === response.questionId);
      const evidence = question ? evidenceFor(session, question) : [];
      const trace = evidence.length ? ` Trace: ${evidence.join('; ')}.` : '';
      return `${index + 1}. Update the generated code to satisfy: ${response.answer}.${trace}`;
    });

  const acceptedIds = effectiveResponses
    .filter(response => response.decision === 'accept')
    .map(response => response.questionId);

  return [
    ...(repairItems.length ? repairItems : ['No code corrections were requested.']),
    '',
    acceptedIds.length
      ? `Preserve the behavior accepted in: ${acceptedIds.join(', ')}.`
      : 'No generated behaviors were explicitly accepted.',
    ['Agent approved', 'Completed with human resolution'].includes(finalStatus)
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
        `### ${clean(question.title)} (${question.id})`,
        '',
        `- **Question:** ${clean(question.ask)}`,
        `- **Reason:** ${clean(question.reason)}`
      ].join('\n'));
      continue;
    }
    const rendered = renderResolvedItem(session, question, response);
    if (response.decision === 'accept') accepted.push(rendered);
    if (response.decision === 'correct') corrected.push(rendered);
    if (response.decision === 'irrelevant') irrelevant.push(rendered);
  }

  const diagnostics = (session.diagnostics || []).map(diagnostic =>
    `- ${clean(diagnostic.file)}:${diagnostic.line || 1} — ${clean(diagnostic.message)}`);

  const repairItems = responses
    .filter(response => response.decision === 'correct')
    .map((response, index) => {
      const question = questions.find(item => item.id === response.questionId);
      const evidence = question ? evidenceFor(session, question) : [];
      const trace = evidence.length ? ` Trace: ${evidence.join('; ')}.` : '';
      return `${index + 1}. Update the generated code to satisfy: ${response.answer}.${trace}`;
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
    `Session: ${clean(session.id)}`,
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
    `- ${clean(diagnostic.file)}:${diagnostic.line || 1} — ${clean(diagnostic.message)}`);
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
  const finalStatus = finalValidationStatus(agentReview, unresolved.length);
  const repairInstructions = buildAgentRepairInstructions(session, questions, effectiveResponses, finalStatus);

  return [
    '# VLP Review Report',
    '',
    `Session: ${clean(session.id)}`,
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
    `- Reviewer: ${clean(agentReview?.provider) || 'Unknown'} / ${clean(agentReview?.model) || 'Unknown'}`,
    `- Agent review status: ${agentReviewStatusLabel(agentReview?.status)}`,
    `- Final validation status: ${finalStatus}`,
    `- Policy threshold: ${formatThreshold(agentReview?.threshold)}`,
    `- Automatic decisions: ${automaticCount}`,
    `- Escalated decisions: ${escalatedCount}`,
    `- Started at: ${clean(agentReview?.startedAt) || 'Not available'}`,
    `- Completed at: ${clean(agentReview?.completedAt) || 'Not available'}`,
    `- Reviewer summary: ${clean(agentReview?.summary) || 'None provided.'}`,
    agentReview?.error ? `- Reviewer error: ${clean(agentReview.error.message) || 'Unknown error'}` : '- Reviewer error: None',
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
