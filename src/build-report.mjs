const DECISIONS = new Set(['accept', 'correct', 'irrelevant']);
const MAX_ANSWER_LENGTH = 4000;

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

function evidenceFor(session, question) {
  const ids = new Set(question.docUnitIds || []);
  return (session.docUnits || [])
    .filter(unit => ids.has(unit.id))
    .map(unit => `${clean(unit.file)}:${unit.lineStart || 1} — ${clean(unit.text)}`);
}

function renderResolvedItem(session, question, response) {
  const lines = [
    `### ${clean(question.title)} (${question.id})`,
    '',
    `- **Decision:** ${response.decision}`,
    `- **Question:** ${clean(question.ask)}`
  ];
  if (response.answer) lines.push(`- **User feedback:** ${response.answer}`);
  if (question.promptEvidence) lines.push(`- **Prompt trace:** ${clean(question.promptEvidence)}`);
  const evidence = evidenceFor(session, question);
  lines.push(`- **Code/documentation trace:** ${evidence.length ? evidence.join('; ') : 'No direct source line was linked.'}`);
  return lines.join('\n');
}

function renderSection(title, items) {
  return [`## ${title}`, '', items.length ? items.join('\n\n') : 'None'].join('\n');
}

export function buildReport(session, rawResponses = []) {
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
