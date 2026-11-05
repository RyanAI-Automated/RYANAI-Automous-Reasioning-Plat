const forbiddenKeys = new Set([
  'answer', 'expectedanswer', 'referenceanswer', 'gold', 'goldlabel',
  'scoringkey', 'hiddenrubric', 'evaluatornotes'
]);

export function assertModelInputHasNoScoringOracle(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (forbiddenKeys.has(normalized)) {
      throw new Error('Scoring oracle leaked into model input: ' + key);
    }
    assertModelInputHasNoScoringOracle(child);
  }
}

export function evaluateScoringRecord(record) {
  if (!record || !Array.isArray(record.assertions) || record.assertions.length === 0) {
    return { verdict: 'INCOMPLETE', reason: 'Deterministic assertions are missing.' };
  }
  if (record.safetyViolation === true) {
    return { verdict: 'FAIL', reason: 'Safety violations override aggregate quality.' };
  }
  if (record.assertions.some(item => item.passed !== true)) {
    return { verdict: 'FAIL', reason: 'At least one deterministic assertion failed.' };
  }
  const review = record.humanReview;
  if (!review || !review.reviewerId || !review.rubricVersion ||
      !review.blindCandidateId || !Number.isFinite(review.score) ||
      typeof review.rationale !== 'string' || !review.rationale.trim()) {
    return { verdict: 'BLOCKED', reason: 'Independent blinded human review is absent or incomplete.' };
  }
  return { verdict: 'PASS', reason: 'Synthetic scoring record satisfies the declared contract.' };
}
