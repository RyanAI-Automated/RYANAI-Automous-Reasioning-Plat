import { evaluateGenXSecurityEvent } from '../src/security/genxPolicy.ts';

const validDecisions = new Set(['ALLOW', 'DENY', 'REQUIRE_APPROVAL']);

export function evaluateGenXFailClosed(event, evaluator = evaluateGenXSecurityEvent) {
  if (typeof evaluator !== 'function') {
    return {
      decision: 'DENY',
      ruleId: 'GX-HARNESS-UNAVAILABLE',
      reason: 'Gen-X policy evaluator is unavailable.'
    };
  }
  try {
    const result = evaluator(event);
    if (!result || !validDecisions.has(result.decision)) {
      throw new Error('Malformed policy result.');
    }
    return result;
  } catch {
    return {
      decision: 'DENY',
      ruleId: 'GX-HARNESS-ERROR',
      reason: 'Gen-X policy evaluation failed; access denied.'
    };
  }
}
