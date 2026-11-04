export function isEligiblePatchLogEvent(pr) {
  return Boolean(
    pr &&
    pr.merged === true &&
    pr.base?.ref === 'main' &&
    typeof pr.head?.ref === 'string' &&
    !pr.head.ref.startsWith('patch-log/')
  );
}
