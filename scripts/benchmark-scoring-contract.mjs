const forbiddenKeys = new Set([
  'answer', 'answerkey', 'expectedanswer', 'expectedoutput', 'referenceanswer',
  'referenceoutput', 'gold', 'goldanswer', 'goldlabel', 'scoringkey',
  'scoringrubric', 'hiddenrubric', 'privatejudge', 'evaluatornotes'
]);

const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function assertModelInputHasNoScoringOracle(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error('Cyclic model input is not valid JSON scoring input.');
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (forbiddenKeys.has(normalized)) {
      throw new Error('Scoring oracle leaked into model input: ' + key);
    }
    assertModelInputHasNoScoringOracle(child, seen);
  }
  seen.delete(value);
}

function validateDeterministicAssertions(assertions) {
  if (!Array.isArray(assertions) || assertions.length === 0) return false;
  const ids = new Set();
  const versions = new Set();
  for (const item of assertions) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() ||
        ids.has(item.id) || typeof item.passed !== 'boolean' ||
        typeof item.evaluatorVersion !== 'string' || !item.evaluatorVersion.trim() ||
        !isHash(item.expectedSha256) || !isHash(item.observedSha256)) {
      return false;
    }
    ids.add(item.id);
    versions.add(item.evaluatorVersion);
    if (item.passed && item.expectedSha256 !== item.observedSha256) return false;
    if (!item.passed && item.expectedSha256 === item.observedSha256) return false;
  }
  return versions.size === 1;
}

function validateHumanReview(review) {
  return Boolean(review &&
    typeof review.reviewerId === 'string' && review.reviewerId.trim() &&
    typeof review.rubricVersion === 'string' && review.rubricVersion.trim() &&
    typeof review.blindCandidateId === 'string' && review.blindCandidateId.trim() &&
    Number.isFinite(review.score) && review.score >= 0 && review.score <= 5 &&
    typeof review.rationale === 'string' && review.rationale.trim() &&
    typeof review.reviewedAt === 'string' && !Number.isNaN(Date.parse(review.reviewedAt)) &&
    review.independentReviewer === true &&
    review.conflictOfInterestChecked === true &&
    review.conflictOfInterest === false &&
    typeof review.calibrationVersion === 'string' && review.calibrationVersion.trim());
}

export function evaluateScoringRecord(record) {
  if (!Array.isArray(record?.assertions) || record.assertions.length === 0) {
    return { verdict: 'INCOMPLETE', reason: 'Deterministic assertions are missing.' };
  }
  if (record.safetyViolation === true) {
    return { verdict: 'FAIL', reason: 'Safety violations override aggregate quality.' };
  }
  if (!validateDeterministicAssertions(record.assertions)) {
    return { verdict: 'INCOMPLETE', reason: 'Assertions require unique IDs, one pinned evaluator version, matching expected/observed hashes for passes, and explicit boolean outcomes.' };
  }
  if (record.assertions.some(item => item.passed === false)) {
    return { verdict: 'FAIL', reason: 'At least one deterministic assertion failed.' };
  }
  if (!validateHumanReview(record.humanReview)) {
    return { verdict: 'BLOCKED', reason: 'Independent, blinded, conflict-checked and calibrated human review is absent or incomplete.' };
  }
  return { verdict: 'PASS', reason: 'Synthetic scoring record satisfies the deterministic contract.' };
}
