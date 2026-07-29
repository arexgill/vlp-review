import { createHash } from 'node:crypto';
import { keywordsFrom } from './analyze-source.mjs';

const SEVERITY_WEIGHT = { high: 3, medium: 2, low: 1 };
const TYPE_PRIORITY = {
  'runtime-diagnostic': 10,
  'method-drift': 9,
  'schema-drift': 8,
  'api-use': 7,
  'wrong-flow': 6,
  'wrong-operation': 6,
  'missing-step': 5,
  'wrong-value': 4,
  'redundant-step': 2,
  underspecified: 1
};
const ERROR_WORDS = /\b(error|errors|invalid|failure|exception)\b/i;
const VAGUE_WORDS = /\b(appropriate|relevant|relevance|reasonable|fast|friendly|secure|proper|clear|best)\b/i;

function splitPrompt(prompt) {
  return (String(prompt).match(/[^.!?\n]+[.!?]?/g) || [])
    .map(statement => statement.replace(/^\s*[-*#]+\s*/, '').trim())
    .filter(Boolean)
    .map(text => ({ text, keywords: keywordsFrom(text) }))
    .filter(statement => statement.keywords.length >= 3);
}

function intersectionSize(left, right) {
  const rightSet = right instanceof Set ? right : new Set(right);
  return left.reduce((total, word) => total + Number(rightSet.has(word)), 0);
}

function makeId(question) {
  const trace = [
    question.type,
    question.promptEvidence,
    question.docUnitIds.join(','),
    question.ask
  ].join('\0');
  return `q-${createHash('sha1').update(trace).digest('hex').slice(0, 12)}`;
}

function finalize(question) {
  return { id: makeId(question), ...question };
}

function bestEvidence(statement, docUnits) {
  return docUnits
    .map(unit => ({ unit, overlap: intersectionSize(statement.keywords, unit.keywords || []) }))
    .sort((a, b) => b.overlap - a.overlap || a.unit.id.localeCompare(b.unit.id));
}

function missingStepQuestions(statements, docUnits) {
  const union = new Set(docUnits.flatMap(unit => unit.keywords || []));
  const questions = [];

  for (const statement of statements) {
    const covered = intersectionSize(statement.keywords, union);
    const coverage = covered / statement.keywords.length;
    if (coverage >= 0.45) continue;

    const missing = statement.keywords.filter(word => !union.has(word));
    const ranked = bestEvidence(statement, docUnits);
    const related = ranked.filter(item => item.overlap > 0).slice(0, 3).map(item => item.unit.id);
    const docUnitIds = related.length > 0 ? related : docUnits.slice(0, 2).map(unit => unit.id);
    const topic = missing.join(', ');
    questions.push(finalize({
      type: 'missing-step',
      severity: /\b(must|required|never)\b/i.test(statement.text) ? 'high' : 'medium',
      title: `Validate missing behavior: ${missing.slice(0, 3).join(', ') || 'prompt obligation'}`,
      ask: `The prompt mentions ${topic}, but the documentation does not strongly represent it. Should the implementation include it?`,
      reason: `The prompt obligation is not strongly represented: only ${Math.round(coverage * 100)}% of its meaningful terms appear in the generated documentation.`,
      promptEvidence: statement.text,
      docUnitIds
    }));
  }

  return questions;
}

function literalValues(code) {
  const values = [];
  for (const match of String(code).matchAll(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g)) {
    if (!['0', '1', '-1'].includes(match[0])) values.push(match[0]);
  }
  for (const match of String(code).matchAll(/(['"`])([^'"`\n]{1,80})\1/g)) {
    values.push(match[2]);
  }
  return [...new Set(values)];
}

function wrongValueQuestions(prompt, docUnits) {
  const questions = [];
  for (const unit of docUnits.filter(item => ['condition', 'call'].includes(item.kind))) {
    for (const value of literalValues(unit.code)) {
      if (String(prompt).toLowerCase().includes(value.toLowerCase())) continue;
      questions.push(finalize({
        type: 'wrong-value',
        severity: 'medium',
        title: `Validate unstated value: ${value}`,
        ask: `Is the value “${value}” in ${unit.symbol} intended?`,
        reason: 'The generated behavior uses a concrete value that is not stated in the prompt.',
        promptEvidence: '',
        docUnitIds: [unit.id]
      }));
    }
  }
  return questions;
}

function errorHandlingQuestion(prompt, docUnits) {
  if (!ERROR_WORDS.test(prompt) || docUnits.some(unit => unit.kind === 'throw' || unit.kind === 'catch')) {
    return [];
  }
  const related = docUnits
    .filter(unit => unit.kind === 'condition' || unit.kind === 'return')
    .slice(0, 3)
    .map(unit => unit.id);
  const evidence = splitPrompt(prompt).find(statement => ERROR_WORDS.test(statement.text))?.text || '';
  return [finalize({
    type: 'api-use',
    severity: 'high',
    title: 'Validate invalid-input behavior',
    ask: 'The prompt mentions invalid or error behavior, but no throw/catch behavior is documented. How should invalid input be surfaced?',
    reason: 'The documented implementation has no explicit exception path.',
    promptEvidence: evidence,
    docUnitIds: related
  })];
}

function underspecifiedQuestions(statements, docUnits) {
  return statements
    .filter(statement => VAGUE_WORDS.test(statement.text) && !/\b\d+(?:\.\d+)?\b/.test(statement.text))
    .slice(0, 2)
    .map(statement => finalize({
      type: 'underspecified',
      severity: 'low',
      title: 'Clarify a subjective requirement',
      ask: `What concrete behavior should “${statement.text.replace(/[.!?]$/, '')}” require?`,
      reason: 'This prompt statement uses a subjective term without a measurable acceptance criterion.',
      promptEvidence: statement.text,
      docUnitIds: bestEvidence(statement, docUnits).slice(0, 2).map(item => item.unit.id)
    }));
}

function redundantStepQuestions(statements, docUnits) {
  const promptUnion = new Set(statements.flatMap(statement => statement.keywords));
  return docUnits
    .filter(unit => ['return', 'call'].includes(unit.kind))
    .filter(unit => intersectionSize(unit.keywords || [], promptUnion) === 0)
    .slice(0, 3)
    .map(unit => finalize({
      type: 'redundant-step',
      severity: 'low',
      title: `Validate unrequested behavior in ${unit.symbol}`,
      ask: `The documentation says “${unit.text}” Is this behavior intended?`,
      reason: 'This documented operation has no meaningful term overlap with the prompt.',
      promptEvidence: '',
      docUnitIds: [unit.id]
    }));
}

function deduplicateQuestions(questions) {
  const selected = new Map();
  for (const question of questions) {
    const normalizedTrace = question.promptEvidence.trim().toLowerCase().replace(/\s+/g, ' ');
    const key = normalizedTrace ? `trace:${normalizedTrace}` : `id:${question.id}`;
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, question);
      continue;
    }
    const priorityDifference = (TYPE_PRIORITY[question.type] || 0) - (TYPE_PRIORITY[existing.type] || 0);
    const severityDifference = SEVERITY_WEIGHT[question.severity] - SEVERITY_WEIGHT[existing.severity];
    if (priorityDifference > 0 || (priorityDifference === 0 && severityDifference > 0)) {
      selected.set(key, question);
    }
  }
  return [...selected.values()];
}

export function detectMismatches({ prompt, docUnits, fastapiQuestions = [] }) {
  const statements = splitPrompt(prompt);
  const questions = [
    ...fastapiQuestions,
    ...missingStepQuestions(statements, docUnits),
    ...wrongValueQuestions(prompt, docUnits),
    ...errorHandlingQuestion(prompt, docUnits),
    ...underspecifiedQuestions(statements, docUnits),
    ...redundantStepQuestions(statements, docUnits)
  ];

  return deduplicateQuestions(questions)
    .sort((left, right) =>
      SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity]
      || left.type.localeCompare(right.type)
      || left.id.localeCompare(right.id))
    .slice(0, 20);
}
