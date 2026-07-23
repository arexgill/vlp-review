const DECISIONS = new Set(['accept', 'correct', 'irrelevant', 'escalate']);
const INTENT_BASES = new Set(['explicit-prompt', 'inferred', 'absent']);
const MAX_TEXT = 4000;

function clean(value) {
  return String(value ?? '').replaceAll('\0', '').replace(/\r\n?/g, '\n').trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function issue(questionId, code, message) {
  return {
    questionId: clean(questionId),
    code,
    message: clean(message)
  };
}

function textValue(value, invalidCode) {
  if (typeof value !== 'string') {
    return { ok: false, code: invalidCode, value: '' };
  }
  const cleaned = clean(value);
  if (cleaned.length > MAX_TEXT) {
    return { ok: false, code: 'oversized-text', value: '' };
  }
  return { ok: true, value: cleaned };
}

function issueMissingDecisions(questions, issues) {
  for (const question of questions) {
    issues.push(issue(question.id, 'missing-decision', 'No valid decision was returned for this question.'));
  }
}

export function createReviewInput(session) {
  const units = new Map((session.docUnits || []).map(unit => [unit.id, unit]));
  return {
    sessionId: clean(session.id),
    prompt: clean(session.prompt),
    questions: (session.questions || []).map(question => ({
      id: clean(question.id),
      type: clean(question.type),
      severity: clean(question.severity),
      ask: clean(question.ask),
      reason: clean(question.reason),
      promptEvidence: clean(question.promptEvidence),
      evidence: (question.docUnitIds || []).flatMap(id => {
        const unit = units.get(id);
        return unit ? [{
          docUnitId: clean(unit.id),
          file: clean(unit.file),
          lineStart: Number(unit.lineStart) || 1,
          documentation: clean(unit.text),
          code: clean(unit.code)
        }] : [];
      })
    }))
  };
}

function validateDecision(entry, question, evidenceIds) {
  const issues = [];
  const questionId = clean(entry?.questionId);
  const decision = textValue(entry?.decision, 'invalid-decision');
  const answer = textValue(entry?.answer, 'invalid-answer');
  const rationale = textValue(entry?.rationale, 'invalid-rationale');
  const intentBasis = textValue(entry?.intentBasis, 'invalid-intent-basis');
  const evidence = entry?.evidenceDocUnitIds;
  const confidence = Number(entry?.confidence);

  if (questionId !== clean(question.id)) {
    issues.push(issue(questionId, 'unknown-question', 'Decision targets a question that is not in the review input.'));
    return { issues, valid: false };
  }
  if (!decision.ok || !DECISIONS.has(decision.value)) {
    issues.push(issue(questionId, 'invalid-decision', 'Decision must be accept, correct, irrelevant, or escalate.'));
  }
  if (!intentBasis.ok || !INTENT_BASES.has(intentBasis.value)) {
    issues.push(issue(questionId, 'invalid-intent-basis', 'Intent basis must be explicit-prompt, inferred, or absent.'));
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    issues.push(issue(questionId, 'invalid-confidence', 'Confidence must be a number between 0 and 1.'));
  }
  if (!answer.ok) {
    issues.push(issue(questionId, answer.code, 'Correction answer must be a string.'));
  } else if (decision.ok && decision.value === 'correct' && !answer.value) {
    issues.push(issue(questionId, 'invalid-answer', 'A correction answer is required for correct decisions.'));
  }
  if (!rationale.ok) {
    issues.push(issue(questionId, rationale.code, 'Rationale must be a string.'));
  }
  if (!Array.isArray(evidence)) {
    issues.push(issue(questionId, 'invalid-evidence', 'Evidence must be an array of linked documentation ids.'));
  } else {
    const normalized = [];
    for (const item of evidence) {
      if (typeof item !== 'string') {
        issues.push(issue(questionId, 'invalid-evidence', 'Evidence must be an array of linked documentation ids.'));
        break;
      }
      const cleaned = clean(item);
      if (!evidenceIds.has(cleaned)) {
        issues.push(issue(questionId, 'invalid-evidence', 'Evidence must reference only linked documentation.'));
        break;
      }
      normalized.push(cleaned);
    }
    if (!issues.length) {
      return {
        issues,
        valid: true,
        decision: {
          questionId,
          decision: decision.value,
          answer: answer.value,
          rationale: rationale.value,
          confidence,
          intentBasis: intentBasis.value,
          evidenceDocUnitIds: normalized
        }
      };
    }
  }
  return { issues, valid: false };
}

export function validateReviewContent(content, input) {
  const questions = new Map((input?.questions || []).map(question => [clean(question.id), question]));
  const questionList = [...questions.values()];
  const issues = [];
  let summary = '';

  if (typeof content !== 'string') {
    issues.push(issue('', 'invalid-json', 'Invalid JSON review output.'));
    issueMissingDecisions(questionList, issues);
    return { summary, decisions: [], issues };
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    issues.push(issue('', 'invalid-json', 'Invalid JSON review output.'));
    issueMissingDecisions(questionList, issues);
    return { summary, decisions: [], issues };
  }

  if (!isPlainObject(parsed)) {
    issues.push(issue('', 'invalid-json', 'Invalid JSON review output.'));
    issueMissingDecisions(questionList, issues);
    return { summary, decisions: [], issues };
  }

  const summaryText = textValue(parsed.summary, 'invalid-summary');
  if (summaryText.ok) {
    summary = summaryText.value;
  } else if (summaryText.code === 'oversized-text') {
    issues.push(issue('', 'oversized-text', 'Text fields must not exceed 4000 characters.'));
  } else {
    issues.push(issue('', 'invalid-summary', 'Summary must be a string.'));
  }

  if (!Array.isArray(parsed.decisions)) {
    issues.push(issue('', 'invalid-decisions', 'Decisions must be an array.'));
    issueMissingDecisions(questionList, issues);
    return { summary, decisions: [], issues };
  }

  const grouped = new Map();
  for (const entry of parsed.decisions) {
    const questionId = clean(entry?.questionId);
    const list = grouped.get(questionId) || [];
    list.push(entry);
    grouped.set(questionId, list);
  }

  const retained = new Map();
  for (const [questionId, entries] of grouped) {
    if (entries.length > 1) {
      issues.push(issue(questionId, 'duplicate-question', 'Multiple decisions were returned for this question.'));
      continue;
    }
    const question = questions.get(questionId);
    if (!question) {
      issues.push(issue(questionId, 'unknown-question', 'Decision targets a question that is not in the review input.'));
      continue;
    }
    const evidenceIds = new Set((question.evidence || []).map(item => clean(item.docUnitId)));
    const normalized = validateDecision(entries[0], question, evidenceIds);
    issues.push(...normalized.issues);
    if (normalized.valid) {
      retained.set(questionId, normalized.decision);
    }
  }

  for (const question of questionList) {
    if (!retained.has(clean(question.id))) {
      issues.push(issue(question.id, 'missing-decision', 'No valid decision was returned for this question.'));
    }
  }

  return {
    summary,
    decisions: [...retained.values()],
    issues
  };
}
