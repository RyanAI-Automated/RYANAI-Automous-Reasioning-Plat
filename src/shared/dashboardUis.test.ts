import { describe, expect, it } from 'vitest';
import { getAvailableDashboardUiOptions, getEnabledDashboardUiIds } from './dashboardUis';

describe('RyanAI dashboard UI preferences', () => {
  it('keeps all regular workspaces enabled until a preference is saved', () => {
    expect(getEnabledDashboardUiIds(undefined)).toEqual([
      'pa',
      'cockpit',
      'operator',
      'operations',
      'calculator',
      'quant',
      'trading',
      'workspace',
      'audiobook',
      'studio',
    ]);
  });

  it('keeps Studio available to regular users while protecting Admin Console and Comms', () => {
    const regular = getAvailableDashboardUiOptions(false, false);
    expect(regular.some(({ id }) => id === 'studio')).toBe(true);
    expect(regular.some(({ id }) => id === 'admin' || id === 'comms')).toBe(false);
    expect(getAvailableDashboardUiOptions(false, true).some(({ id }) => id === 'admin')).toBe(true);
    expect(getAvailableDashboardUiOptions(true, false).some(({ id }) => id === 'comms')).toBe(true);
  });

  it('filters stored preferences against the current authorised workspace set', () => {
    expect(getEnabledDashboardUiIds(['pa', 'admin', 'comms', 'made-up'], false, false)).toEqual(['pa']);
  });

  it('allows a saved empty selection without hiding the permanent dashboard and Settings routes', () => {
    expect(getEnabledDashboardUiIds([], true, true)).toEqual([]);
  });
});
