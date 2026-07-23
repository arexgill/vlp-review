export const REVIEW_THRESHOLD = 0.8;

export function applyReviewPolicy(session, providerReview, { threshold = REVIEW_THRESHOLD } = {}) {
  const decisions = new Map((providerReview?.decisions || []).map(item => [item.questionId, item]));
  const issuesByQuestion = new Map();

  for (const item of providerReview?.issues || []) {
    if (!item?.questionId) continue;
    const list = issuesByQuestion.get(item.questionId) || [];
    list.push(item.code);
    issuesByQuestion.set(item.questionId, list);
  }

  return (session?.questions || []).map(question => {
    const proposal = decisions.get(question.id);
    const reasons = [...new Set(issuesByQuestion.get(question.id) || [])];

    if (!proposal) reasons.push('missing-provider-decision');
    if (proposal?.decision === 'escalate') reasons.push('provider-requested-escalation');
    if (proposal && proposal.confidence < threshold) reasons.push('confidence-below-threshold');
    if (proposal && ['accept', 'correct'].includes(proposal.decision) && proposal.intentBasis !== 'explicit-prompt') {
      reasons.push('intent-not-explicit');
    }
    if (proposal?.decision === 'correct' && !String(proposal.answer || '').trim()) {
      reasons.push('empty-correction');
    }

    const escalationReasons = [...new Set(reasons)];
    const approved = Boolean(proposal) && escalationReasons.length === 0;

    return {
      questionId: question.id,
      status: approved ? 'approved' : 'escalated',
      proposedDecision: proposal?.decision || null,
      effectiveDecision: approved ? proposal.decision : null,
      confidence: proposal?.confidence ?? null,
      rationale: proposal?.rationale || '',
      answer: proposal?.answer || '',
      intentBasis: proposal?.intentBasis || null,
      evidenceDocUnitIds: proposal?.evidenceDocUnitIds || [],
      escalationReasons
    };
  });
}
