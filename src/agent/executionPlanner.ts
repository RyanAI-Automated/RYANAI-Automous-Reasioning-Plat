export type ExecutionChange = {
  /** Stable resource identifiers affected by a known change. */
  resourceKeys?: readonly string[];
  /** The change affects shared indexes, routing, or publication metadata. */
  requiresSharedMetadata?: boolean;
  /** The change may affect every resource in the owning subsystem. */
  affectsEntireSubsystem?: boolean;
  /** The desired outcome is removal of the owning resource/subsystem. */
  purge?: boolean;
  /** False when the event type or its semantics are not understood. */
  eventKnown: boolean;
  /** False when the execution snapshot may be older than the triggering event. */
  snapshotFresh: boolean;
};

export type ExecutionPlan =
  | { kind: 'targeted'; resourceKeys: string[]; reason: string }
  | { kind: 'targeted-with-metadata'; resourceKeys: string[]; reason: string }
  | { kind: 'purge'; resourceKeys: []; reason: string }
  | { kind: 'full'; resourceKeys: []; reason: string };

/**
 * Select the smallest execution scope that can be proven safe.
 *
 * Unknown events and stale snapshots deliberately escalate to full execution.
 * Callers must still revalidate authorization and ownership immediately before
 * writes; this planner is a scope classifier, not an authorization mechanism.
 */
export function planExecution(change: ExecutionChange): ExecutionPlan {
  if (!change.eventKnown) {
    return { kind: 'full', resourceKeys: [], reason: 'Unknown change semantics require full reconciliation.' };
  }
  if (!change.snapshotFresh) {
    return { kind: 'full', resourceKeys: [], reason: 'Execution snapshot is stale or unverified.' };
  }
  if (change.affectsEntireSubsystem) {
    return { kind: 'full', resourceKeys: [], reason: 'Change may affect resources throughout the subsystem.' };
  }
  if (change.purge) {
    return { kind: 'purge', resourceKeys: [], reason: 'The verified desired state removes the resource.' };
  }

  const suppliedKeys = change.resourceKeys ?? [];
  if (suppliedKeys.some((key) => !key.trim())) {
    return { kind: 'full', resourceKeys: [], reason: 'Malformed resource identifiers require full reconciliation.' };
  }
  const resourceKeys = [...new Set(suppliedKeys.map((key) => key.trim()))].sort();
  if (resourceKeys.length === 0) {
    return { kind: 'full', resourceKeys: [], reason: 'No bounded resource scope can be proven.' };
  }

  if (change.requiresSharedMetadata) {
    return {
      kind: 'targeted-with-metadata',
      resourceKeys,
      reason: 'Known resources and their shared metadata must be reconciled together.',
    };
  }
  return { kind: 'targeted', resourceKeys, reason: 'Only the identified resources are affected.' };
}

export type KeyedOutput = { key: string; value: string };

/**
 * Compare the exact output owned by a targeted plan with a full-build baseline.
 * Values are compared byte-for-byte as strings. Duplicate keys, missing baseline
 * keys, or writes outside the declared target scope fail equivalence.
 */
export function areOwnedOutputsEquivalent(
  targeted: readonly KeyedOutput[],
  full: readonly KeyedOutput[],
  ownedKeys: readonly string[],
): boolean {
  if (ownedKeys.length === 0) return false;

  const toUniqueMap = (items: readonly KeyedOutput[]): Map<string, string> | null => {
    const result = new Map<string, string>();
    for (const item of items) {
      if (result.has(item.key)) return null;
      result.set(item.key, item.value);
    }
    return result;
  };

  const targetedMap = toUniqueMap(targeted);
  const fullMap = toUniqueMap(full);
  if (!targetedMap || !fullMap) return false;

  const owned = new Set(ownedKeys);
  if (targetedMap.size !== owned.size || [...targetedMap.keys()].some((key) => !owned.has(key))) {
    return false;
  }
  return [...owned].every((key) => fullMap.has(key) && targetedMap.has(key) && targetedMap.get(key) === fullMap.get(key));
}
