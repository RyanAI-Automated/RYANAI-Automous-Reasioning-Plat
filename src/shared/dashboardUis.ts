export const DASHBOARD_UI_OPTIONS = [
  {
    id: 'pa',
    label: 'Personal Assistant',
    description: 'Personal task continuity and authorised agent coordination.',
    access: 'any',
  },
  {
    id: 'cockpit',
    label: 'Command Cockpit',
    description: 'Reasoning activity, provider readiness and system controls.',
    access: 'any',
  },
  {
    id: 'operator',
    label: 'Operator Console',
    description: 'Durable task queues and execution progress.',
    access: 'any',
  },
  {
    id: 'operations',
    label: 'Operations Center',
    description: 'Operational tasks, approvals and execution history.',
    access: 'any',
  },
  {
    id: 'calculator',
    label: 'Calculator',
    description: 'Calculation and analysis workspace.',
    access: 'any',
  },
  {
    id: 'quant',
    label: 'Quant Lab',
    description: 'Historical strategy experiments and risk analytics.',
    access: 'any',
  },
  {
    id: 'trading',
    label: 'Trading Terminal',
    description: 'Virtual paper-trading workspace.',
    access: 'any',
  },
  {
    id: 'workspace',
    label: 'Reasoning Workspace',
    description: 'Conversations, voice and project memory.',
    access: 'any',
  },
  {
    id: 'audiobook',
    label: 'Audiobook Studio',
    description: 'Audio preparation, transcription and narration.',
    access: 'any',
  },
  {
    id: 'studio',
    label: 'RyanAI Studio',
    description: 'Administrative coding and engineering workspace.',
    access: 'admin',
  },
  {
    id: 'admin',
    label: 'Admin Console',
    description: 'Protected approvals, diagnostics and administration.',
    access: 'admin',
  },
  {
    id: 'comms',
    label: 'RyanAI Comms',
    description: 'Owner-authorised communications workspace.',
    access: 'owner',
  },
] as const;

export type DashboardUiId = (typeof DASHBOARD_UI_OPTIONS)[number]['id'];

export function getAvailableDashboardUiOptions(isOwner = false, isAdmin = false) {
  return DASHBOARD_UI_OPTIONS.filter((option) => (
    option.access === 'any'
    || (option.access === 'owner' && isOwner)
    || (option.access === 'admin' && isAdmin)
  ));
}

/**
 * Preferences only control a user's workspace visibility. They never grant
 * admin/owner access. Missing preferences preserve the existing all-enabled
 * experience for every workspace the current identity is authorised to use.
 */
export function getEnabledDashboardUiIds(
  stored: unknown,
  isOwner = false,
  isAdmin = false,
): DashboardUiId[] {
  const available = getAvailableDashboardUiOptions(isOwner, isAdmin);
  if (!Array.isArray(stored)) return available.map((option) => option.id);

  const selected = new Set(stored.filter((value): value is string => typeof value === 'string'));
  return available
    .filter((option) => selected.has(option.id))
    .map((option) => option.id);
}
